import { Injectable, computed, inject, signal } from '@angular/core';
import { ColumnMapping } from '../models/column-mapping';
import { TableConfig } from '../models/table-config';
import { SqlOperation } from '../types/sql-operation';
import { decodeCsvFile } from '../utils/csv-text-decoder';
import { normalizeSqlIdentifier } from '../utils/sql-identifiers';
import { I18nService } from './i18n.service';
import { LoadingService } from './loading.service';
import { SqlGenerationError, SqlGenerationService } from './sql-generation.service';

type MappingScope = 'parent' | 'child';

@Injectable({
  providedIn: 'root'
})
export class StoreService {
  private i18n = inject(I18nService);
  private loading = inject(LoadingService);
  private sqlGeneration = inject(SqlGenerationService);

  tables = signal<TableConfig[]>([]);
  generatedSql = signal<string>('');
  generationError = signal<string | null>(null);
  isGenerating = signal(false);
  sqlOperation = signal<SqlOperation>('INSERT');

  tableOptions = computed(() => {
    return this.tables().map((table) => ({ id: table.id, name: table.name }));
  });

  addFiles(files: FileList) {
    this.generationError.set(null);

    Array.from(files).forEach(async (file) => {
      try {
        const text = await decodeCsvFile(file);
        this.initTable(file.name, text);
      } catch (error) {
        console.error(error);
        this.generationError.set(this.i18n.t('errors.fileRead.FILE_DECODING_ERROR', { fileName: file.name }));
      }
    });
  }

  removeTable(id: string) {
    this.tables.update((current) => current.filter((table) => table.id !== id));
  }

  updateTable(id: string, updates: Partial<TableConfig>) {
    const sanitizedUpdates = this.sanitizeTableUpdates(updates);

    this.tables.update((current) =>
      current.map((table) => (table.id === id ? { ...table, ...sanitizedUpdates } : table))
    );
  }

  updateSqlTableName(id: string, value: string) {
    this.updateTable(id, { sqlTableName: value });
  }

  updateChildSqlTableName(id: string, value: string) {
    this.updateTable(id, { childSqlTableName: value });
  }

  updatePrimaryKeyColumns(id: string, columns: string[]) {
    this.tables.update((current) =>
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
        return existing
          ? { ...existing, sqlName: normalizeSqlIdentifier(existing.sqlName) }
          : this.createColumnMapping(header, includeByDefault);
      });
    };

    const newParentMappings = reconcileMappings(table.parentMappings, headers, true);
    const newChildMappings = reconcileMappings(table.childMappings, headers, false);

    const newPrimaryKeyColumns = this.normalizePrimaryKeyColumns(headers, table.primaryKeyColumns);
    const primaryKeySet = new Set(newPrimaryKeyColumns);
    const ensuredParentMappings = newParentMappings.map((mapping) =>
      primaryKeySet.has(mapping.original) ? { ...mapping, include: true } : mapping
    );

    this.tables.update((current) =>
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
    const sanitizedChanges = this.sanitizeMappingChanges(changes);

    this.tables.update((current) =>
      current.map((table) => {
        if (table.id !== tableId) return table;

        return {
          ...table,
          parentMappings: table.parentMappings.map((mapping) =>
            mapping.original === originalCol
              ? { ...mapping, ...this.enforcePrimaryKeyInclusion(table, mapping.original, sanitizedChanges) }
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
    const sanitizedChanges = this.sanitizeMappingChanges(changes);

    this.tables.update((current) =>
      current.map((table) => {
        if (table.id !== tableId) return table;

        return {
          ...table,
          childMappings: table.childMappings.map((mapping) =>
            mapping.original === originalCol ? { ...mapping, ...sanitizedChanges } : mapping
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

    this.generationError.set(null);

    const validationError = this.validateSelectedTables();
    if (validationError) {
      this.generationError.set(validationError);
      return;
    }

    this.isGenerating.set(true);

    try {
      const sql = await this.loading.track(
        {
          context: 'sql-generation',
          titleKey: 'loading.sqlGeneration.title',
          messageKey: 'loading.sqlGeneration.message'
        },
        () =>
          this.sqlGeneration.generate({
            tables: this.tables(),
            operation: this.sqlOperation(),
            locale: this.i18n.locale()
          })
      );

      this.generatedSql.set(sql);
    } catch (error) {
      this.generationError.set(this.buildGenerationErrorMessage(error));
    } finally {
      this.isGenerating.set(false);
    }
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
      externalParentTableId: null,
      externalForeignKey: null
    };

    this.tables.update((current) => [...current, newTable]);
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

  private sanitizeTableUpdates(updates: Partial<TableConfig>): Partial<TableConfig> {
    const sanitizedUpdates = { ...updates };

    if (sanitizedUpdates.sqlTableName !== undefined) {
      sanitizedUpdates.sqlTableName = normalizeSqlIdentifier(sanitizedUpdates.sqlTableName);
    }

    if (sanitizedUpdates.childSqlTableName !== undefined) {
      sanitizedUpdates.childSqlTableName = normalizeSqlIdentifier(sanitizedUpdates.childSqlTableName);
    }

    return sanitizedUpdates;
  }

  private normalizePrimaryKeyColumns(headers: string[], columns: string[] | undefined): string[] {
    if (!columns?.length) return [];

    const requested = new Set(columns.filter((column) => headers.includes(column)));
    return headers.filter((header) => requested.has(header));
  }

  private sanitizeMappingChanges(changes: Partial<ColumnMapping>): Partial<ColumnMapping> {
    const sanitizedChanges = { ...changes };

    if (sanitizedChanges.sqlName !== undefined) {
      sanitizedChanges.sqlName = normalizeSqlIdentifier(sanitizedChanges.sqlName);
    }

    return sanitizedChanges;
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

  private validateSelectedTables(): string | null {
    const selectedTables = this.tables().filter((table) => table.selected);
    const producedTableNames = new Set<string>();

    for (const table of selectedTables) {
      const tableNames = [
        {
          identifier: table.sqlTableName,
          context: this.i18n.t('errors.validation.contexts.parentTable', { fileName: table.name })
        }
      ];

      if (table.hasChildInSameFile) {
        tableNames.push({
          identifier: table.childSqlTableName,
          context: this.i18n.t('errors.validation.contexts.childTable', { fileName: table.name })
        });
      }

      for (const entry of tableNames) {
        const normalizedIdentifier = normalizeSqlIdentifier(entry.identifier);
        if (producedTableNames.has(normalizedIdentifier)) {
          return this.buildDuplicateIdentifierError(normalizedIdentifier, entry.context);
        }

        producedTableNames.add(normalizedIdentifier);
      }

      const parentColumnsError = this.validateMappingIdentifiers(table, 'parent');
      if (parentColumnsError) {
        return parentColumnsError;
      }

      if (table.hasChildInSameFile) {
        const childColumnsError = this.validateMappingIdentifiers(table, 'child');
        if (childColumnsError) {
          return childColumnsError;
        }
      }
    }

    return null;
  }

  private validateMappingIdentifiers(table: TableConfig, scope: MappingScope): string | null {
    const mappings = scope === 'parent' ? table.parentMappings : table.childMappings;
    const seen = new Set<string>();
    const includedMappings = mappings.filter((mapping) => mapping.include);

    for (const mapping of includedMappings) {
      const normalizedIdentifier = normalizeSqlIdentifier(mapping.sqlName);
      if (seen.has(normalizedIdentifier)) {
        const contextKey =
          scope === 'parent' ? 'errors.validation.contexts.parentColumns' : 'errors.validation.contexts.childColumns';

        return this.buildDuplicateIdentifierError(
          normalizedIdentifier,
          this.i18n.t(contextKey, { fileName: table.name })
        );
      }

      seen.add(normalizedIdentifier);
    }

    return null;
  }

  private buildDuplicateIdentifierError(identifier: string, context: string): string {
    return this.i18n.t('errors.validation.DUPLICATE_SQL_IDENTIFIER', { identifier, context });
  }

  private buildGenerationErrorMessage(error: unknown): string {
    if (!(error instanceof SqlGenerationError)) {
      return this.i18n.t('errors.sqlGeneration.UNEXPECTED_GENERATION_ERROR');
    }

    if (error.code !== 'INVALID_TYPED_VALUE' || !error.details) {
      return this.i18n.t(`errors.sqlGeneration.${error.code}`);
    }

    return this.i18n.t('errors.sqlGeneration.INVALID_TYPED_VALUE', {
      tableName: error.details.tableName,
      columnOriginal: error.details.columnOriginal,
      columnSqlName: error.details.columnSqlName,
      expectedType: this.i18n.t(`tableConfig.valueTypes.${error.details.expectedType}`),
      rawValue: error.details.rawValue
    });
  }
}
