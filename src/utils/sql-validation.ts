import { ColumnMapping } from '../models/column-mapping';
import { ForeignKeySqlColumnConfig, TableConfig } from '../models/table-config';
import { ValidationIssue } from '../types/sql-generation';
import { SqlOperation } from '../types/sql-operation';
import { normalizeSqlIdentifierOrEmpty } from './sql-identifiers';

type MappingScope = 'parent' | 'child';
type ValidationContextKey = 'parentTable' | 'childTable' | 'parentColumns' | 'childColumns' | 'autoIncrementId';

export function splitValidationIssues(issues: ValidationIssue[]) {
  return {
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning')
  };
}

export function normalizeTablesForGeneration(tables: TableConfig[]): TableConfig[] {
  return tables.map((table) => ({
    ...table,
    sqlTableName: normalizeSqlIdentifierOrEmpty(table.sqlTableName),
    childSqlTableName: normalizeSqlIdentifierOrEmpty(table.childSqlTableName),
    sameFileForeignKeyColumnName: normalizeSqlIdentifierOrEmpty(table.sameFileForeignKeyColumnName),
    externalForeignKeyColumnName: normalizeSqlIdentifierOrEmpty(table.externalForeignKeyColumnName),
    autoIncrementId: {
      ...table.autoIncrementId,
      columnName: normalizeSqlIdentifierOrEmpty(table.autoIncrementId.columnName)
    },
    parentMappings: table.parentMappings.map((mapping) => ({
      ...mapping,
      sqlName: normalizeSqlIdentifierOrEmpty(mapping.sqlName)
    })),
    childMappings: table.childMappings.map((mapping) => ({
      ...mapping,
      sqlName: normalizeSqlIdentifierOrEmpty(mapping.sqlName)
    })),
    sameFileSelectedPkForeignKeys: table.sameFileSelectedPkForeignKeys.map((entry) => ({
      ...entry,
      fkColumnName: normalizeSqlIdentifierOrEmpty(entry.fkColumnName)
    })),
    externalSelectedPkForeignKeys: table.externalSelectedPkForeignKeys.map((entry) => ({
      ...entry,
      fkColumnName: normalizeSqlIdentifierOrEmpty(entry.fkColumnName)
    }))
  }));
}

export function validateSelectedTablesPreflight(tables: TableConfig[], operation: SqlOperation): ValidationIssue[] {
  const selectedTables = tables.filter((table) => table.selected);
  const selectedTableIds = new Set(selectedTables.map((table) => table.id));
  const tableById = new Map(selectedTables.map((table) => [table.id, table]));
  const issues: ValidationIssue[] = [];
  const producedTableNames = new Map<string, { tableId: string; contextKey: ValidationContextKey }>();

  for (const table of selectedTables) {
    validateTableName(table, 'parent', producedTableNames, issues);

    if (table.hasChildInSameFile) {
      validateTableName(table, 'child', producedTableNames, issues);
    }

    validateAutoIncrementId(table, issues);
    validateMappingIdentifiers(table, 'parent', issues);

    if (table.hasChildInSameFile) {
      validateMappingIdentifiers(table, 'child', issues);
    }

    validateOperationRequirements(table, operation, issues);

    if (operation === 'INSERT') {
      if (table.hasChildInSameFile) {
        validateSameFileRelationship(table, issues);
        continue;
      }

      if (table.externalParentTableId) {
        const parentTable = tableById.get(table.externalParentTableId) ?? null;
        validateExternalRelationship(table, parentTable, selectedTableIds, issues);
      }
    }
  }

  return issues;
}

function validateTableName(
  table: TableConfig,
  target: 'parent' | 'child',
  producedTableNames: Map<string, { tableId: string; contextKey: ValidationContextKey }>,
  issues: ValidationIssue[]
) {
  const tableName = target === 'parent' ? table.sqlTableName : table.childSqlTableName;
  const normalizedIdentifier = normalizeSqlIdentifierOrEmpty(tableName);
  if (!normalizedIdentifier) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'EMPTY_TABLE_NAME',
      tableId: table.id,
      fileName: table.name,
      tableName: target === 'parent' ? table.sqlTableName : table.childSqlTableName,
      params: {
        target
      }
    });
    return;
  }

  const contextKey = target === 'parent' ? 'parentTable' : 'childTable';
  const duplicate = producedTableNames.get(normalizedIdentifier);
  if (duplicate) {
    issues.push(
      createDuplicateIdentifierIssue(table, normalizedIdentifier, contextKey, target === 'parent' ? table.sqlTableName : table.childSqlTableName)
    );
    return;
  }

  producedTableNames.set(normalizedIdentifier, { tableId: table.id, contextKey });
}

function validateMappingIdentifiers(table: TableConfig, scope: MappingScope, issues: ValidationIssue[]) {
  const mappings = scope === 'parent' ? table.parentMappings : table.childMappings;
  const seen = new Set<string>();
  const includedMappings = mappings.filter((mapping) => mapping.include);

  for (const mapping of includedMappings) {
    const normalizedIdentifier = normalizeSqlIdentifierOrEmpty(mapping.sqlName);
    if (!normalizedIdentifier) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'EMPTY_COLUMN_NAME',
        tableId: table.id,
        fileName: table.name,
        tableName: scope === 'parent' ? table.sqlTableName : table.childSqlTableName,
        columnOriginal: mapping.original,
        params: {
          scope
        }
      });
      continue;
    }

    if (seen.has(normalizedIdentifier)) {
      issues.push(createDuplicateIdentifierIssue(table, normalizedIdentifier, scope === 'parent' ? 'parentColumns' : 'childColumns', mapping.original));
      continue;
    }

    seen.add(normalizedIdentifier);
  }

  if (scope === 'parent' && table.autoIncrementId.enabled) {
    const normalizedAutoIncrementColumn = normalizeSqlIdentifierOrEmpty(table.autoIncrementId.columnName);
    if (normalizedAutoIncrementColumn && seen.has(normalizedAutoIncrementColumn)) {
      issues.push(createDuplicateIdentifierIssue(table, normalizedAutoIncrementColumn, 'autoIncrementId', table.autoIncrementId.columnName));
    }
  }
}

function createDuplicateIdentifierIssue(
  table: TableConfig,
  identifier: string,
  contextKey: ValidationContextKey,
  tableName: string
): ValidationIssue {
  return {
    severity: 'error',
    phase: 'preflight',
    code: 'DUPLICATE_SQL_IDENTIFIER',
    tableId: table.id,
    fileName: table.name,
    tableName,
    params: {
      identifier,
      contextKey
    }
  };
}

function validateAutoIncrementId(table: TableConfig, issues: ValidationIssue[]) {
  if (!table.autoIncrementId.enabled) return;

  if (!normalizeSqlIdentifierOrEmpty(table.autoIncrementId.columnName)) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'AUTO_INCREMENT_ID_COLUMN_REQUIRED',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      params: {}
    });
  }

  if (!Number.isInteger(table.autoIncrementId.startAt)) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'AUTO_INCREMENT_ID_START_AT_INVALID',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      params: {}
    });
  }
}

function validateOperationRequirements(table: TableConfig, operation: SqlOperation, issues: ValidationIssue[]) {
  const includedParentMappings = table.parentMappings.filter((mapping) => mapping.include);
  const pkMappings = getPrimaryKeyMappings(table, includedParentMappings);

  if (operation === 'INSERT') {
    if (!table.hasChildInSameFile && !table.externalParentTableId && includedParentMappings.length === 0) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'INSERT_NO_COLUMNS_SELECTED',
        tableId: table.id,
        fileName: table.name,
        tableName: table.sqlTableName,
        params: {}
      });
    }

    return;
  }

  if (!pkMappings) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: operation === 'UPDATE' ? 'UPDATE_PRIMARY_KEY_REQUIRED' : 'DELETE_PRIMARY_KEY_REQUIRED',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      params: {}
    });
    return;
  }

  if (operation === 'UPDATE') {
    const pkColumns = new Set(pkMappings.map((mapping) => mapping.original));
    const updateMappings = includedParentMappings.filter((mapping) => !pkColumns.has(mapping.original));
    if (updateMappings.length === 0) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'UPDATE_NO_COLUMNS_TO_UPDATE',
        tableId: table.id,
        fileName: table.name,
        tableName: table.sqlTableName,
        params: {}
      });
    }
  }
}

function validateSameFileRelationship(table: TableConfig, issues: ValidationIssue[]) {
  if (!table.hasChildInSameFile) return;

  if (table.primaryKeyColumns.length === 0) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_PARENT_PK_REQUIRED',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      parentTableName: table.sqlTableName,
      childTableName: table.childSqlTableName,
      params: {}
    });
    return;
  }

  if (table.relationshipTargetMode === 'auto-increment') {
    if (!table.autoIncrementId.enabled) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_AUTO_INCREMENT_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        tableName: table.sqlTableName,
        parentTableName: table.sqlTableName,
        childTableName: table.childSqlTableName,
        params: {}
      });
    }

    if (!normalizeSqlIdentifierOrEmpty(table.sameFileForeignKeyColumnName)) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_FK_COLUMN_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        childTableName: table.childSqlTableName,
        params: {}
      });
      return;
    }

    const foreignKeyOutputIssue = validateForeignKeyOutputIdentifiers(
      table,
      table.childSqlTableName,
      table.childMappings.filter((mapping) => mapping.include).map((mapping) => mapping.sqlName),
      [table.sameFileForeignKeyColumnName]
    );
    if (foreignKeyOutputIssue) {
      issues.push(foreignKeyOutputIssue);
    }
    return;
  }

  if (table.sameFileSelectedPkForeignKeys.length !== table.primaryKeyColumns.length) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_COLUMN_COUNT_MISMATCH',
      tableId: table.id,
      fileName: table.name,
      parentTableName: table.sqlTableName,
      childTableName: table.childSqlTableName,
      params: {
        parentColumnCount: table.primaryKeyColumns.length,
        childColumnCount: table.sameFileSelectedPkForeignKeys.length
      }
    });
  }

  if (!relationshipCoversAllParentColumns(table.sameFileSelectedPkForeignKeys, table.primaryKeyColumns)) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_MAPPING_INCOMPLETE',
      tableId: table.id,
      fileName: table.name,
      parentTableName: table.sqlTableName,
      childTableName: table.childSqlTableName,
      params: {}
    });
  }

  const foreignKeyOutputIssue = validateForeignKeyOutputIdentifiers(
    table,
    table.childSqlTableName,
    table.childMappings.filter((mapping) => mapping.include).map((mapping) => mapping.sqlName),
    table.sameFileSelectedPkForeignKeys.map((entry) => entry.fkColumnName)
  );
  if (foreignKeyOutputIssue) {
    issues.push(foreignKeyOutputIssue);
  }
}

function validateExternalRelationship(
  table: TableConfig,
  parentTable: TableConfig | null,
  selectedTableIds: Set<string>,
  issues: ValidationIssue[]
) {
  if (!table.externalParentTableId) return;

  if (!selectedTableIds.has(table.externalParentTableId) || !parentTable) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      parentTableName: table.externalParentTableId,
      childTableName: table.sqlTableName,
      params: {}
    });
    return;
  }

  if (parentTable.primaryKeyColumns.length === 0) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_PARENT_PK_REQUIRED',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      parentTableName: parentTable.sqlTableName,
      childTableName: table.sqlTableName,
      params: {}
    });
    return;
  }

  if (table.externalRelationshipSourceMappings.length !== parentTable.primaryKeyColumns.length) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_COLUMN_COUNT_MISMATCH',
      tableId: table.id,
      fileName: table.name,
      parentTableName: parentTable.sqlTableName,
      childTableName: table.sqlTableName,
      params: {
        parentColumnCount: parentTable.primaryKeyColumns.length,
        childColumnCount: table.externalRelationshipSourceMappings.length
      }
    });
  }

  const parentPkMappings = getPrimaryKeyMappings(parentTable, parentTable.parentMappings.filter((mapping) => mapping.include));
  if (!parentPkMappings) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_PARENT_PK_REQUIRED',
      tableId: table.id,
      fileName: table.name,
      tableName: table.sqlTableName,
      parentTableName: parentTable.sqlTableName,
      childTableName: table.sqlTableName,
      params: {}
    });
    return;
  }

  const sourceMappingByParentColumn = new Map(
    table.externalRelationshipSourceMappings.map((entry) => [entry.parentColumn, entry])
  );
  const childMappingsByOriginal = new Map(table.parentMappings.map((mapping) => [mapping.original, mapping]));

  for (const parentMapping of parentPkMappings) {
    const entry = sourceMappingByParentColumn.get(parentMapping.original);
    if (!entry) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_MAPPING_INCOMPLETE',
        tableId: table.id,
        fileName: table.name,
        parentTableName: parentTable.sqlTableName,
        childTableName: table.sqlTableName,
        params: {}
      });
      continue;
    }

    if (!entry.childColumn) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_SOURCE_COLUMN_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        parentTableName: parentTable.sqlTableName,
        childTableName: table.sqlTableName,
        columnOriginal: parentMapping.original,
        params: {}
      });
      continue;
    }

    const childMapping = childMappingsByOriginal.get(entry.childColumn);
    if (!childMapping) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_SOURCE_COLUMN_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        parentTableName: parentTable.sqlTableName,
        childTableName: table.sqlTableName,
        columnOriginal: parentMapping.original,
        params: {
          childColumn: entry.childColumn
        }
      });
      continue;
    }

    if (childMapping.valueType !== parentMapping.valueType) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_SOURCE_COLUMN_TYPE_MISMATCH',
        tableId: table.id,
        fileName: table.name,
        parentTableName: parentTable.sqlTableName,
        childTableName: table.sqlTableName,
        columnOriginal: entry.childColumn,
        params: {
          parentColumn: parentMapping.original,
          childColumn: entry.childColumn,
          parentType: parentMapping.valueType,
          childType: childMapping.valueType
        }
      });
    }
  }

  if (table.relationshipTargetMode === 'auto-increment') {
    if (!parentTable.autoIncrementId.enabled) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_AUTO_INCREMENT_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        tableName: table.sqlTableName,
        parentTableName: parentTable.sqlTableName,
        childTableName: table.sqlTableName,
        params: {}
      });
    }

    if (!normalizeSqlIdentifierOrEmpty(table.externalForeignKeyColumnName)) {
      issues.push({
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_FK_COLUMN_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        childTableName: table.sqlTableName,
        params: {}
      });
      return;
    }

    const foreignKeyOutputIssue = validateForeignKeyOutputIdentifiers(
      table,
      table.sqlTableName,
      getExternalRelationshipBaseSqlColumns(table),
      [table.externalForeignKeyColumnName]
    );
    if (foreignKeyOutputIssue) {
      issues.push(foreignKeyOutputIssue);
    }
    return;
  }

  if (table.externalSelectedPkForeignKeys.length !== parentTable.primaryKeyColumns.length) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_COLUMN_COUNT_MISMATCH',
      tableId: table.id,
      fileName: table.name,
      parentTableName: parentTable.sqlTableName,
      childTableName: table.sqlTableName,
      params: {
        parentColumnCount: parentTable.primaryKeyColumns.length,
        childColumnCount: table.externalSelectedPkForeignKeys.length
      }
    });
  }

  if (!relationshipCoversAllParentColumns(table.externalSelectedPkForeignKeys, parentTable.primaryKeyColumns)) {
    issues.push({
      severity: 'error',
      phase: 'preflight',
      code: 'RELATIONSHIP_MAPPING_INCOMPLETE',
      tableId: table.id,
      fileName: table.name,
      parentTableName: parentTable.sqlTableName,
      childTableName: table.sqlTableName,
      params: {}
    });
  }

  const foreignKeyOutputIssue = validateForeignKeyOutputIdentifiers(
    table,
    table.sqlTableName,
    getExternalRelationshipBaseSqlColumns(table),
    table.externalSelectedPkForeignKeys.map((entry) => entry.fkColumnName)
  );
  if (foreignKeyOutputIssue) {
    issues.push(foreignKeyOutputIssue);
  }
}

function getExternalRelationshipBaseSqlColumns(table: TableConfig): string[] {
  const baseColumns = table.parentMappings.filter((mapping) => mapping.include).map((mapping) => mapping.sqlName);
  if (table.autoIncrementId.enabled) {
    baseColumns.push(table.autoIncrementId.columnName);
  }

  return baseColumns;
}

function validateForeignKeyOutputIdentifiers(
  table: TableConfig,
  childTableName: string,
  existingColumns: string[],
  foreignKeyColumns: string[]
): ValidationIssue | null {
  const seen = new Set(existingColumns.map((column) => normalizeSqlIdentifierOrEmpty(column)).filter(Boolean));

  for (const column of foreignKeyColumns) {
    const normalizedIdentifier = normalizeSqlIdentifierOrEmpty(column);
    if (!normalizedIdentifier) {
      return {
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_FK_COLUMN_REQUIRED',
        tableId: table.id,
        fileName: table.name,
        childTableName,
        params: {}
      };
    }

    if (seen.has(normalizedIdentifier)) {
      return {
        severity: 'error',
        phase: 'preflight',
        code: 'RELATIONSHIP_FK_IDENTIFIER_CONFLICT',
        tableId: table.id,
        fileName: table.name,
        childTableName,
        fkColumnName: normalizedIdentifier,
        params: {}
      };
    }

    seen.add(normalizedIdentifier);
  }

  return null;
}

function relationshipCoversAllParentColumns(
  entries: ForeignKeySqlColumnConfig[],
  parentColumns: string[]
): boolean {
  const configuredParentColumns = new Set(entries.map((entry) => entry.parentColumn));
  return parentColumns.every((parentColumn) => configuredParentColumns.has(parentColumn));
}

function getPrimaryKeyMappings(table: TableConfig, includedMappings: ColumnMapping[]): ColumnMapping[] | null {
  if (table.primaryKeyColumns.length === 0) return null;

  const mappingByOriginal = new Map(includedMappings.map((mapping) => [mapping.original, mapping]));
  const resolvedMappings = table.primaryKeyColumns
    .map((column) => mappingByOriginal.get(column))
    .filter((mapping): mapping is ColumnMapping => Boolean(mapping));

  return resolvedMappings.length === table.primaryKeyColumns.length ? resolvedMappings : null;
}
