import { Injectable, computed, inject, signal } from '@angular/core';
import { ColumnMapping } from '../models/column-mapping';
import {
  AutoIncrementIdConfig,
  ExternalRelationshipSourceMapping,
  ForeignKeySqlColumnConfig,
  RelationshipTargetMode,
  TableConfig
} from '../models/table-config';
import { SqlOperation } from '../types/sql-operation';
import { decodeCsvFile } from '../utils/csv-text-decoder';
import { normalizeSqlIdentifier } from '../utils/sql-identifiers';
import { I18nService } from './i18n.service';
import { LoadingService } from './loading.service';
import {
  RelationshipGenerationErrorDetails,
  SqlGenerationError,
  SqlGenerationService
} from './sql-generation.service';

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
    this.applyTableUpdates((current) => current.filter((table) => table.id !== id));
  }

  updateTable(id: string, updates: Partial<TableConfig>) {
    const sanitizedUpdates = this.sanitizeTableUpdates(updates);

    this.applyTableUpdates((current) =>
      current.map((table) => (table.id === id ? { ...table, ...sanitizedUpdates } : table))
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
            entry.parentColumn === parentColumn
              ? { ...entry, fkColumnName: normalizeSqlIdentifier(fkColumnName) }
              : entry
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
            entry.parentColumn === parentColumn
              ? { ...entry, fkColumnName: normalizeSqlIdentifier(fkColumnName) }
              : entry
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
    const sanitizedChanges = this.sanitizeMappingChanges(changes);

    this.applyTableUpdates((current) =>
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

    this.applyTableUpdates((current) =>
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
        fkColumnName: normalizeSqlIdentifier(
          existing.fkColumnName || this.buildDefaultForeignKeyColumnName(tableName, parentColumn)
        )
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

  private sanitizeTableUpdates(updates: Partial<TableConfig>): Partial<TableConfig> {
    const sanitizedUpdates = { ...updates };

    if (sanitizedUpdates.sqlTableName !== undefined) {
      sanitizedUpdates.sqlTableName = normalizeSqlIdentifier(sanitizedUpdates.sqlTableName);
    }

    if (sanitizedUpdates.childSqlTableName !== undefined) {
      sanitizedUpdates.childSqlTableName = normalizeSqlIdentifier(sanitizedUpdates.childSqlTableName);
    }

    if (sanitizedUpdates.sameFileForeignKeyColumnName !== undefined) {
      sanitizedUpdates.sameFileForeignKeyColumnName = normalizeSqlIdentifier(sanitizedUpdates.sameFileForeignKeyColumnName);
    }

    if (sanitizedUpdates.externalForeignKeyColumnName !== undefined) {
      sanitizedUpdates.externalForeignKeyColumnName = normalizeSqlIdentifier(sanitizedUpdates.externalForeignKeyColumnName);
    }

    if (sanitizedUpdates.sameFileSelectedPkForeignKeys !== undefined) {
      sanitizedUpdates.sameFileSelectedPkForeignKeys = sanitizedUpdates.sameFileSelectedPkForeignKeys.map((entry) => ({
        ...entry,
        fkColumnName: normalizeSqlIdentifier(entry.fkColumnName)
      }));
    }

    if (sanitizedUpdates.externalSelectedPkForeignKeys !== undefined) {
      sanitizedUpdates.externalSelectedPkForeignKeys = sanitizedUpdates.externalSelectedPkForeignKeys.map((entry) => ({
        ...entry,
        fkColumnName: normalizeSqlIdentifier(entry.fkColumnName)
      }));
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
    const selectedTableIds = new Set(selectedTables.map((table) => table.id));
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

      const autoIncrementIdError = this.validateAutoIncrementId(table);
      if (autoIncrementIdError) {
        return autoIncrementIdError;
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

      if (this.sqlOperation() === 'INSERT') {
        const relationshipError = table.hasChildInSameFile
          ? this.validateSameFileRelationship(table)
          : this.validateExternalRelationship(table, selectedTableIds);

        if (relationshipError) {
          return relationshipError;
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

    if (scope === 'parent' && table.autoIncrementId.enabled) {
      const normalizedIdentifier = normalizeSqlIdentifier(table.autoIncrementId.columnName);
      if (seen.has(normalizedIdentifier)) {
        return this.buildDuplicateIdentifierError(
          normalizedIdentifier,
          this.i18n.t('errors.validation.contexts.autoIncrementId', { fileName: table.name })
        );
      }
    }

    return null;
  }

  private buildDuplicateIdentifierError(identifier: string, context: string): string {
    return this.i18n.t('errors.validation.DUPLICATE_SQL_IDENTIFIER', { identifier, context });
  }

  private validateAutoIncrementId(table: TableConfig): string | null {
    if (!table.autoIncrementId.enabled) return null;

    if (!table.autoIncrementId.columnName.trim()) {
      return this.i18n.t('errors.validation.AUTO_INCREMENT_ID_COLUMN_REQUIRED', { fileName: table.name });
    }

    if (!Number.isInteger(table.autoIncrementId.startAt)) {
      return this.i18n.t('errors.validation.AUTO_INCREMENT_ID_START_AT_INVALID', { fileName: table.name });
    }

    return null;
  }

  private validateSameFileRelationship(table: TableConfig): string | null {
    if (!table.hasChildInSameFile) return null;

    if (table.primaryKeyColumns.length === 0) {
      return this.i18n.t('errors.validation.RELATIONSHIP_PARENT_PK_REQUIRED', {
        childTable: table.childSqlTableName,
        parentTable: table.sqlTableName
      });
    }

    if (table.relationshipTargetMode === 'auto-increment') {
      if (!table.autoIncrementId.enabled) {
        return this.i18n.t('errors.validation.RELATIONSHIP_AUTO_INCREMENT_REQUIRED', {
          parentTable: table.sqlTableName
        });
      }

      if (!table.sameFileForeignKeyColumnName.trim()) {
        return this.i18n.t('errors.validation.RELATIONSHIP_FK_COLUMN_REQUIRED', {
          childTable: table.childSqlTableName
        });
      }

      return this.validateForeignKeyOutputIdentifiers(
        table.childSqlTableName,
        table.childMappings.filter((mapping) => mapping.include).map((mapping) => mapping.sqlName),
        [table.sameFileForeignKeyColumnName]
      );
    }

    if (!this.relationshipCoversAllParentColumns(table.sameFileSelectedPkForeignKeys, table.primaryKeyColumns)) {
      return this.i18n.t('errors.validation.RELATIONSHIP_MAPPING_INCOMPLETE', {
        childTable: table.childSqlTableName,
        parentTable: table.sqlTableName
      });
    }

    return this.validateForeignKeyOutputIdentifiers(
      table.childSqlTableName,
      table.childMappings.filter((mapping) => mapping.include).map((mapping) => mapping.sqlName),
      table.sameFileSelectedPkForeignKeys.map((entry) => entry.fkColumnName)
    );
  }

  private validateExternalRelationship(table: TableConfig, selectedTableIds: Set<string>): string | null {
    if (table.hasChildInSameFile || !table.externalParentTableId) return null;

    if (!selectedTableIds.has(table.externalParentTableId)) {
      return this.i18n.t('errors.validation.RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND', {
        parentTable: table.externalParentTableId,
        childTable: table.sqlTableName
      });
    }

    const parentTable = this.tables().find((entry) => entry.id === table.externalParentTableId);
    if (!parentTable) {
      return this.i18n.t('errors.validation.RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND', {
        parentTable: table.externalParentTableId,
        childTable: table.sqlTableName
      });
    }

    if (parentTable.primaryKeyColumns.length === 0) {
      return this.i18n.t('errors.validation.RELATIONSHIP_PARENT_PK_REQUIRED', {
        childTable: table.sqlTableName,
        parentTable: parentTable.sqlTableName
      });
    }

    if (!this.relationshipSourceMappingsComplete(table.externalRelationshipSourceMappings, parentTable.primaryKeyColumns)) {
      return this.i18n.t('errors.validation.RELATIONSHIP_MAPPING_INCOMPLETE', {
        childTable: table.sqlTableName,
        parentTable: parentTable.sqlTableName
      });
    }

    if (table.relationshipTargetMode === 'auto-increment') {
      if (!parentTable.autoIncrementId.enabled) {
        return this.i18n.t('errors.validation.RELATIONSHIP_AUTO_INCREMENT_REQUIRED', {
          parentTable: parentTable.sqlTableName
        });
      }

      if (!table.externalForeignKeyColumnName.trim()) {
        return this.i18n.t('errors.validation.RELATIONSHIP_FK_COLUMN_REQUIRED', {
          childTable: table.sqlTableName
        });
      }

      return this.validateForeignKeyOutputIdentifiers(
        table.sqlTableName,
        this.getExternalRelationshipBaseSqlColumns(table),
        [table.externalForeignKeyColumnName]
      );
    }

    if (!this.relationshipCoversAllParentColumns(table.externalSelectedPkForeignKeys, parentTable.primaryKeyColumns)) {
      return this.i18n.t('errors.validation.RELATIONSHIP_MAPPING_INCOMPLETE', {
        childTable: table.sqlTableName,
        parentTable: parentTable.sqlTableName
      });
    }

    return this.validateForeignKeyOutputIdentifiers(
      table.sqlTableName,
      this.getExternalRelationshipBaseSqlColumns(table),
      table.externalSelectedPkForeignKeys.map((entry) => entry.fkColumnName)
    );
  }

  private getExternalRelationshipBaseSqlColumns(table: TableConfig): string[] {
    const baseColumns = table.parentMappings.filter((mapping) => mapping.include).map((mapping) => mapping.sqlName);
    if (table.autoIncrementId.enabled) {
      baseColumns.push(table.autoIncrementId.columnName);
    }

    return baseColumns;
  }

  private relationshipCoversAllParentColumns(
    entries: ForeignKeySqlColumnConfig[],
    parentColumns: string[]
  ): boolean {
    const configuredParentColumns = new Set(entries.map((entry) => entry.parentColumn));
    return parentColumns.every((parentColumn) => configuredParentColumns.has(parentColumn));
  }

  private relationshipSourceMappingsComplete(
    entries: ExternalRelationshipSourceMapping[],
    parentColumns: string[]
  ): boolean {
    const configuredEntries = new Map(entries.map((entry) => [entry.parentColumn, entry.childColumn]));
    return parentColumns.every((parentColumn) => {
      const childColumn = configuredEntries.get(parentColumn);
      return typeof childColumn === 'string' && childColumn.length > 0;
    });
  }

  private validateForeignKeyOutputIdentifiers(
    childTableName: string,
    existingColumns: string[],
    foreignKeyColumns: string[]
  ): string | null {
    const seen = new Set(existingColumns.map((column) => normalizeSqlIdentifier(column)));

    for (const column of foreignKeyColumns) {
      const normalized = normalizeSqlIdentifier(column);
      if (!normalized) {
        return this.i18n.t('errors.validation.RELATIONSHIP_FK_COLUMN_REQUIRED', {
          childTable: childTableName
        });
      }

      if (seen.has(normalized)) {
        return this.i18n.t('errors.validation.RELATIONSHIP_FK_IDENTIFIER_CONFLICT', {
          fkColumn: normalized,
          childTable: childTableName
        });
      }

      seen.add(normalized);
    }

    return null;
  }

  private buildGenerationErrorMessage(error: unknown): string {
    if (!(error instanceof SqlGenerationError)) {
      return this.i18n.t('errors.sqlGeneration.UNEXPECTED_GENERATION_ERROR');
    }

    if (error.code === 'INVALID_TYPED_VALUE' && error.details) {
      const details = error.details as {
        tableName: string;
        columnOriginal: string;
        columnSqlName: string;
        expectedType: string;
        rawValue: string;
      };

      return this.i18n.t('errors.sqlGeneration.INVALID_TYPED_VALUE', {
        tableName: details.tableName,
        columnOriginal: details.columnOriginal,
        columnSqlName: details.columnSqlName,
        expectedType: this.i18n.t(`tableConfig.valueTypes.${details.expectedType}`),
        rawValue: details.rawValue
      });
    }

    if (this.isRelationshipErrorDetails(error.details)) {
      return this.buildRelationshipGenerationErrorMessage(error.code, error.details);
    }

    return this.i18n.t(`errors.sqlGeneration.${error.code}`);
  }

  private isRelationshipErrorDetails(details: unknown): details is RelationshipGenerationErrorDetails {
    if (!details || typeof details !== 'object') return false;

    return 'childTableName' in details && 'parentTableName' in details;
  }

  private buildRelationshipGenerationErrorMessage(
    code: SqlGenerationError['code'],
    details: RelationshipGenerationErrorDetails
  ): string {
    switch (code) {
      case 'RELATIONSHIP_PARENT_PK_REQUIRED':
        return this.i18n.t('errors.sqlGeneration.RELATIONSHIP_PARENT_PK_REQUIRED', {
          childTable: details.childTableName,
          parentTable: details.parentTableName
        });
      case 'RELATIONSHIP_AUTO_INCREMENT_REQUIRED':
        return this.i18n.t('errors.sqlGeneration.RELATIONSHIP_AUTO_INCREMENT_REQUIRED', {
          parentTable: details.parentTableName
        });
      case 'RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND':
        return this.i18n.t('errors.sqlGeneration.RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND', {
          parentTable: details.parentTableName,
          childTable: details.childTableName
        });
      case 'RELATIONSHIP_MAPPING_INCOMPLETE':
        return this.i18n.t('errors.sqlGeneration.RELATIONSHIP_MAPPING_INCOMPLETE', {
          childTable: details.childTableName,
          parentTable: details.parentTableName
        });
      case 'RELATIONSHIP_ROW_KEY_INCOMPLETE':
        return this.i18n.t('errors.sqlGeneration.RELATIONSHIP_ROW_KEY_INCOMPLETE', {
          childTable: details.childTableName,
          parentTable: details.parentTableName
        });
      case 'RELATIONSHIP_PARENT_ROW_NOT_FOUND':
        return this.i18n.t('errors.sqlGeneration.RELATIONSHIP_PARENT_ROW_NOT_FOUND', {
          childTable: details.childTableName,
          parentTable: details.parentTableName,
          logicalKey: details.logicalKey ?? ''
        });
      default:
        return this.i18n.t(`errors.sqlGeneration.${code}`);
    }
  }
}
