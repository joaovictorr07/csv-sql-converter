import { Injectable, computed, inject, signal } from '@angular/core';
import { ColumnMapping } from '../models/column-mapping';
import {
  AutoIncrementIdConfig,
  ExternalRelationshipSourceMapping,
  ForeignKeySqlColumnConfig,
  RelationshipTargetMode,
  TableConfig
} from '../models/table-config';
import {
  SqlGenerationResponse,
  ValidationIssue,
  ValidationIssueCode,
  ValidationIssueSeverity
} from '../types/sql-generation';
import { SqlOperation } from '../types/sql-operation';
import { decodeCsvFile } from '../utils/csv-text-decoder';
import { normalizeSqlIdentifier } from '../utils/sql-identifiers';
import {
  normalizeTablesForGeneration,
  splitValidationIssues,
  validateSelectedTablesPreflight
} from '../utils/sql-validation';
import { I18nService } from './i18n.service';
import { LoadingService } from './loading.service';
import { SqlGenerationService, SqlGenerationServiceError } from './sql-generation.service';

type GenerationReportSource = 'preflight' | 'worker' | 'runtime';

export interface GenerationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  runtimeMessage: string | null;
  source: GenerationReportSource;
  keptPreviousSql: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class StoreService {
  private i18n = inject(I18nService);
  private loading = inject(LoadingService);
  private sqlGeneration = inject(SqlGenerationService);

  tables = signal<TableConfig[]>([]);
  generatedSql = signal<string>('');
  generationReport = signal<GenerationReport | null>(null);
  isGenerating = signal(false);
  sqlOperation = signal<SqlOperation>('INSERT');

  tableOptions = computed(() => {
    return this.tables().map((table) => ({ id: table.id, name: table.name }));
  });

  generationErrors = computed(() => {
    return this.generationReport()?.errors.map((issue) => this.formatValidationIssue(issue)) ?? [];
  });

  generationWarnings = computed(() => {
    return this.generationReport()?.warnings.map((issue) => this.formatValidationIssue(issue)) ?? [];
  });

  runtimeGenerationError = computed(() => this.generationReport()?.runtimeMessage ?? null);

  addFiles(files: FileList) {
    this.generationReport.set(null);

    Array.from(files).forEach(async (file) => {
      try {
        const text = await decodeCsvFile(file);
        this.initTable(file.name, text);
      } catch (error) {
        console.error(error);
        this.generationReport.set({
          errors: [],
          warnings: [],
          runtimeMessage: this.i18n.t('errors.fileRead.FILE_DECODING_ERROR', { fileName: file.name }),
          source: 'runtime',
          keptPreviousSql: Boolean(this.generatedSql())
        });
      }
    });
  }

  removeTable(id: string) {
    this.applyTableUpdates((current) => current.filter((table) => table.id !== id));
  }

  updateTable(id: string, updates: Partial<TableConfig>) {
    this.applyTableUpdates((current) =>
      current.map((table) => (table.id === id ? { ...table, ...updates } : table))
    );
  }

  updateSqlTableName(id: string, value: string) {
    this.updateTable(id, { sqlTableName: value });
  }

  updateChildSqlTableName(id: string, value: string) {
    this.updateTable(id, { childSqlTableName: value });
  }

  updateAutoIncrementId(id: string, changes: Partial<AutoIncrementIdConfig>) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== id) return table;

        return {
          ...table,
          autoIncrementId: {
            ...table.autoIncrementId,
            ...changes
          }
        };
      })
    );
  }

  updateRelationshipTargetMode(id: string, mode: RelationshipTargetMode) {
    this.updateTable(id, { relationshipTargetMode: mode });
  }

  updateSameFileForeignKeyColumnName(id: string, value: string) {
    this.updateTable(id, { sameFileForeignKeyColumnName: value });
  }

  updateExternalForeignKeyColumnName(id: string, value: string) {
    this.updateTable(id, { externalForeignKeyColumnName: value });
  }

  updateSameFileSelectedPkForeignKey(id: string, parentColumn: string, fkColumnName: string) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== id) return table;

        return {
          ...table,
          sameFileSelectedPkForeignKeys: table.sameFileSelectedPkForeignKeys.map((entry) =>
            entry.parentColumn === parentColumn ? { ...entry, fkColumnName } : entry
          )
        };
      })
    );
  }

  updateExternalSourceMapping(id: string, parentColumn: string, childColumn: string | null) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== id) return table;

        return {
          ...table,
          externalRelationshipSourceMappings: table.externalRelationshipSourceMappings.map((entry) =>
            entry.parentColumn === parentColumn ? { ...entry, childColumn } : entry
          )
        };
      })
    );
  }

  updateExternalSelectedPkForeignKey(id: string, parentColumn: string, fkColumnName: string) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== id) return table;

        return {
          ...table,
          externalSelectedPkForeignKeys: table.externalSelectedPkForeignKeys.map((entry) =>
            entry.parentColumn === parentColumn ? { ...entry, fkColumnName } : entry
          )
        };
      })
    );
  }

  updatePrimaryKeyColumns(id: string, columns: string[]) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== id) return table;

        const primaryKeyColumns = this.normalizePrimaryKeyColumns(table.columns, columns);
        const primaryKeySet = new Set(primaryKeyColumns);
        const parentMappings = table.parentMappings.map((mapping) =>
          primaryKeySet.has(mapping.original) ? { ...mapping, include: true } : mapping
        );

        return {
          ...table,
          primaryKeyColumns,
          parentMappings
        };
      })
    );
  }

  reparseTable(id: string, newDelimiter: string) {
    const table = this.tables().find((entry) => entry.id === id);
    if (!table) return;

    const { headers, data } = this.parseRawData(table.rawContent, newDelimiter);

    const reconcileMappings = (oldMappings: ColumnMapping[], newHeaders: string[], includeByDefault: boolean) => {
      return newHeaders.map((header) => {
        const existing = oldMappings.find((mapping) => mapping.original === header);
        return existing ? { ...existing } : this.createColumnMapping(header, includeByDefault);
      });
    };

    const newParentMappings = reconcileMappings(table.parentMappings, headers, true);
    const newChildMappings = reconcileMappings(table.childMappings, headers, false);

    const newPrimaryKeyColumns = this.normalizePrimaryKeyColumns(headers, table.primaryKeyColumns);
    const primaryKeySet = new Set(newPrimaryKeyColumns);
    const ensuredParentMappings = newParentMappings.map((mapping) =>
      primaryKeySet.has(mapping.original) ? { ...mapping, include: true } : mapping
    );

    this.applyTableUpdates((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;

        return {
          ...entry,
          delimiter: newDelimiter,
          columns: headers,
          data,
          parentMappings: ensuredParentMappings,
          childMappings: newChildMappings,
          primaryKeyColumns: newPrimaryKeyColumns
        };
      })
    );
  }

  updateParentMapping(tableId: string, originalCol: string, changes: Partial<ColumnMapping>) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== tableId) return table;

        return {
          ...table,
          parentMappings: table.parentMappings.map((mapping) =>
            mapping.original === originalCol
              ? { ...mapping, ...this.enforcePrimaryKeyInclusion(table, mapping.original, changes) }
              : mapping
          )
        };
      })
    );
  }

  updateParentMappingSqlName(tableId: string, originalCol: string, value: string) {
    this.updateParentMapping(tableId, originalCol, { sqlName: value });
  }

  updateChildMapping(tableId: string, originalCol: string, changes: Partial<ColumnMapping>) {
    this.applyTableUpdates((current) =>
      current.map((table) => {
        if (table.id !== tableId) return table;

        return {
          ...table,
          childMappings: table.childMappings.map((mapping) =>
            mapping.original === originalCol ? { ...mapping, ...changes } : mapping
          )
        };
      })
    );
  }

  updateChildMappingSqlName(tableId: string, originalCol: string, value: string) {
    this.updateChildMapping(tableId, originalCol, { sqlName: value });
  }

  setOperation(operation: SqlOperation) {
    this.sqlOperation.set(operation);
  }

  async generate(): Promise<void> {
    if (this.isGenerating()) return;

    this.generationReport.set(null);

    const preflightIssues = validateSelectedTablesPreflight(this.tables(), this.sqlOperation());
    const preflightSplit = splitValidationIssues(preflightIssues);
    if (preflightSplit.errors.length > 0) {
      this.generationReport.set({
        errors: preflightSplit.errors,
        warnings: preflightSplit.warnings,
        runtimeMessage: null,
        source: 'preflight',
        keptPreviousSql: Boolean(this.generatedSql())
      });
      return;
    }

    this.isGenerating.set(true);

    try {
      const response = await this.loading.track(
        {
          context: 'sql-generation',
          titleKey: 'loading.sqlGeneration.title',
          messageKey: 'loading.sqlGeneration.message'
        },
        () =>
          this.sqlGeneration.generate({
            tables: normalizeTablesForGeneration(this.tables()),
            operation: this.sqlOperation(),
            locale: this.i18n.locale()
          })
      );

      this.consumeGenerationResponse(response);
    } catch (error) {
      this.generationReport.set({
        errors: [],
        warnings: [],
        runtimeMessage: this.buildRuntimeErrorMessage(error),
        source: 'runtime',
        keptPreviousSql: Boolean(this.generatedSql())
      });
    } finally {
      this.isGenerating.set(false);
    }
  }

  private consumeGenerationResponse(response: SqlGenerationResponse) {
    const split = splitValidationIssues(response.issues);

    if (!response.ok) {
      this.generationReport.set({
        errors: split.errors,
        warnings: split.warnings,
        runtimeMessage: null,
        source: 'worker',
        keptPreviousSql: Boolean(this.generatedSql())
      });
      return;
    }

    this.generatedSql.set(response.sql);

    if (split.errors.length === 0 && split.warnings.length === 0) {
      this.generationReport.set(null);
      return;
    }

    this.generationReport.set({
      errors: split.errors,
      warnings: split.warnings,
      runtimeMessage: null,
      source: 'worker',
      keptPreviousSql: false
    });
  }

  private initTable(filename: string, content: string) {
    const delimiters = [',', ';', '\t', '|'];
    let bestDelimiter = ',';

    const firstLineEnd = content.indexOf('\n');
    const sample = firstLineEnd > -1 ? content.substring(0, firstLineEnd) : content.substring(0, 1000);

    let maxCount = 0;
    for (const delimiter of delimiters) {
      const count = sample.split(delimiter).length - 1;
      if (count > maxCount) {
        maxCount = count;
        bestDelimiter = delimiter;
      }
    }

    const { headers, data } = this.parseRawData(content, bestDelimiter);
    const cleanName = filename.replace(/\.csv$/i, '');

    const newTable: TableConfig = {
      id: crypto.randomUUID(),
      name: cleanName,
      rawContent: content,
      delimiter: bestDelimiter,
      booleanMode: 'AS_IS',
      sqlTableName: normalizeSqlIdentifier(cleanName),
      columns: headers,
      parentMappings: headers.map((header) => this.createColumnMapping(header, true)),
      data,
      selected: true,
      primaryKeyColumns: headers[0] ? [headers[0]] : [],
      hasChildInSameFile: false,
      childSqlTableName: normalizeSqlIdentifier(`${cleanName}_child`),
      childMappings: headers.map((header) => this.createColumnMapping(header, false)),
      relationshipTargetMode: 'auto-increment',
      sameFileForeignKeyColumnName: normalizeSqlIdentifier(`${cleanName}_id`),
      sameFileSelectedPkForeignKeys: this.createForeignKeySqlColumnConfigs(headers[0] ? [headers[0]] : []),
      externalParentTableId: null,
      externalRelationshipSourceMappings: this.createExternalRelationshipSourceMappings(headers[0] ? [headers[0]] : []),
      externalForeignKeyColumnName: normalizeSqlIdentifier(`${cleanName}_id`),
      externalSelectedPkForeignKeys: this.createForeignKeySqlColumnConfigs(headers[0] ? [headers[0]] : []),
      autoIncrementId: {
        enabled: false,
        columnName: 'id',
        startAt: 1
      }
    };

    this.applyTableUpdates((current) => [...current, newTable]);
  }

  private parseRawData(content: string, delimiter: string): { headers: string[]; data: any[] } {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuote = false;

    const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const len = text.length;
    const delim = delimiter === 'TAB' ? '\t' : delimiter;

    for (let i = 0; i < len; i++) {
      const char = text[i];

      if (inQuote) {
        if (char === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            currentField += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          currentField += char;
        }
      } else if (char === '"') {
        inQuote = true;
      } else if (char === delim) {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }

    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    if (rows.length === 0) return { headers: [], data: [] };

    const rawHeaders = rows[0].map((header) => header.trim());
    const headers: string[] = [];
    const headerCounts: Record<string, number> = {};

    rawHeaders.forEach((header) => {
      const cleanHeader = header || 'Column';
      if (headerCounts[cleanHeader] === undefined) {
        headerCounts[cleanHeader] = 0;
        headers.push(cleanHeader);
        return;
      }

      headerCounts[cleanHeader]++;
      headers.push(`${cleanHeader}_${headerCounts[cleanHeader]}`);
    });

    const data = rows.slice(1).map((values) => {
      const row: any = {};

      headers.forEach((header, index) => {
        let value = values[index];
        if (value !== undefined) value = value.trim();
        if (value === 'null') value = null;
        if (value === '') value = null;
        row[header] = value;
      });

      return row;
    });

    return { headers, data };
  }

  private createColumnMapping(header: string, include: boolean): ColumnMapping {
    return {
      original: header,
      sqlName: normalizeSqlIdentifier(header),
      include,
      valueType: 'string'
    };
  }

  private createForeignKeySqlColumnConfigs(
    parentColumns: string[],
    tableName?: string
  ): ForeignKeySqlColumnConfig[] {
    return parentColumns.map((parentColumn) => ({
      parentColumn,
      fkColumnName: this.buildDefaultForeignKeyColumnName(tableName ?? 'parent', parentColumn)
    }));
  }

  private createExternalRelationshipSourceMappings(parentColumns: string[]): ExternalRelationshipSourceMapping[] {
    return parentColumns.map((parentColumn) => ({
      parentColumn,
      childColumn: null
    }));
  }

  private buildDefaultForeignKeyColumnName(tableName: string, columnName: string): string {
    return normalizeSqlIdentifier(`${tableName}_${columnName}`);
  }

  private applyTableUpdates(updater: (current: TableConfig[]) => TableConfig[]) {
    this.tables.update((current) => this.syncRelationshipConfigs(updater(current)));
  }

  private syncRelationshipConfigs(tables: TableConfig[]): TableConfig[] {
    const tableById = new Map(tables.map((table) => [table.id, table]));

    return tables.map((table) => {
      const externalParent = table.externalParentTableId ? tableById.get(table.externalParentTableId) ?? null : null;

      return {
        ...table,
        sameFileSelectedPkForeignKeys: this.syncForeignKeySqlColumnConfigs(
          table.sameFileSelectedPkForeignKeys,
          table.primaryKeyColumns,
          table.sqlTableName
        ),
        externalRelationshipSourceMappings: this.syncExternalRelationshipSourceMappings(
          table.externalRelationshipSourceMappings,
          externalParent?.primaryKeyColumns ?? [],
          table.columns
        ),
        externalSelectedPkForeignKeys: this.syncForeignKeySqlColumnConfigs(
          table.externalSelectedPkForeignKeys,
          externalParent?.primaryKeyColumns ?? [],
          externalParent?.sqlTableName ?? table.sqlTableName
        )
      };
    });
  }

  private syncForeignKeySqlColumnConfigs(
    current: ForeignKeySqlColumnConfig[],
    parentColumns: string[],
    tableName: string
  ): ForeignKeySqlColumnConfig[] {
    const currentByParentColumn = new Map(current.map((entry) => [entry.parentColumn, entry]));

    return parentColumns.map((parentColumn) => {
      const existing = currentByParentColumn.get(parentColumn);
      if (!existing) {
        return {
          parentColumn,
          fkColumnName: this.buildDefaultForeignKeyColumnName(tableName, parentColumn)
        };
      }

      return {
        parentColumn,
        fkColumnName: existing.fkColumnName || this.buildDefaultForeignKeyColumnName(tableName, parentColumn)
      };
    });
  }

  private syncExternalRelationshipSourceMappings(
    current: ExternalRelationshipSourceMapping[],
    parentColumns: string[],
    childHeaders: string[]
  ): ExternalRelationshipSourceMapping[] {
    const currentByParentColumn = new Map(current.map((entry) => [entry.parentColumn, entry]));

    return parentColumns.map((parentColumn) => {
      const existing = currentByParentColumn.get(parentColumn);
      if (!existing) {
        return {
          parentColumn,
          childColumn: childHeaders.includes(parentColumn) ? parentColumn : null
        };
      }

      return {
        parentColumn,
        childColumn: existing.childColumn && childHeaders.includes(existing.childColumn) ? existing.childColumn : null
      };
    });
  }

  private normalizePrimaryKeyColumns(headers: string[], columns: string[] | undefined): string[] {
    if (!columns?.length) return [];

    const requested = new Set(columns.filter((column) => headers.includes(column)));
    return headers.filter((header) => requested.has(header));
  }

  private enforcePrimaryKeyInclusion(
    table: TableConfig,
    originalCol: string,
    changes: Partial<ColumnMapping>
  ): Partial<ColumnMapping> {
    if (changes.include !== false) return changes;
    if (!table.primaryKeyColumns.includes(originalCol)) return changes;

    return {
      ...changes,
      include: true
    };
  }

  private formatValidationIssue(issue: ValidationIssue): string {
    const params = {
      ...issue.params,
      fileName: issue.fileName ?? '',
      tableName: issue.tableName ?? '',
      parentTable: issue.parentTableName ?? '',
      childTable: issue.childTableName ?? '',
      columnOriginal: issue.columnOriginal ?? '',
      columnSqlName: issue.columnSqlName ?? '',
      fkColumn: issue.fkColumnName ?? '',
      csvLineNumber: issue.csvLineNumber ?? '',
      rawValue: issue.rawValue ?? '',
      targetLabel: this.translateValidationTarget(String(issue.params.target ?? 'parent')),
      contextLabel: this.translateValidationContext(String(issue.params.contextKey ?? 'parentColumns')),
      parentType: this.translateValueType(String(issue.params.parentType ?? 'string')),
      childType: this.translateValueType(String(issue.params.childType ?? 'string')),
      expectedType: this.translateValueType(String(issue.params.expectedType ?? 'string'))
    };

    return this.i18n.t(`validationIssues.${issue.code}`, params);
  }

  private translateValidationTarget(target: string): string {
    return this.i18n.t(`validationIssues.targets.${target}`);
  }

  private translateValidationContext(contextKey: string): string {
    return this.i18n.t(`validationIssues.contexts.${contextKey}`);
  }

  private translateValueType(valueType: string): string {
    return this.i18n.t(`tableConfig.valueTypes.${valueType}`);
  }

  private buildRuntimeErrorMessage(error: unknown): string {
    if (error instanceof SqlGenerationServiceError) {
      return this.i18n.t(`errors.sqlGeneration.${error.code}`);
    }

    return this.i18n.t('errors.sqlGeneration.UNEXPECTED_GENERATION_ERROR');
  }
}
