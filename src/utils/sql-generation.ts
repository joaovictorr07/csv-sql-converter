import {
  ExternalRelationshipSourceMapping,
  ForeignKeySqlColumnConfig,
  TableConfig
} from '../models/table-config';
import { ColumnMapping } from '../models/column-mapping';
import { BooleanMode } from '../types/boolean-mode';
import { translate } from '../i18n/catalog';
import { Locale } from '../types/locale';
import { SqlOperation } from '../types/sql-operation';
import { InvalidTypedValueError, RelationshipSqlGenerationError } from './sql-generation-errors';
import { normalizeSqlIdentifier } from './sql-identifiers';

interface ResolvedAutoIncrementIdConfig {
  columnName: string;
  startAt: number;
}

interface ResolvedLogicalKey {
  serialized: string;
  display: string;
}

interface RelationshipParentRegistry {
  parentTableName: string;
  dependentChildTableNames: string[];
  pkMappings: ColumnMapping[] | null;
  generatedIdsByLogicalKey: Map<string, number>;
  pkValuesByLogicalKey: Map<string, Map<string, string>>;
}

interface SqlGenerationContext {
  selectedTablesById: Map<string, TableConfig>;
  parentRegistriesByTableId: Map<string, RelationshipParentRegistry>;
}

interface RelationshipProjection {
  columns: string[];
  values: string[];
}

export function buildSql(tables: TableConfig[], operation: SqlOperation, locale: Locale): string {
  const selectedTables = tables.filter((table) => table.selected);
  const sortedTables = sortTablesByDependency(selectedTables, operation === 'DELETE');
  const context = createSqlGenerationContext(selectedTables);

  let sql = `-- ${translate(locale, 'sql.generatedScript')}\n`;
  sql += `-- ${translate(locale, 'sql.operationLabel')}: ${operation}\n`;
  sql += `-- ${translate(locale, 'sql.dateLabel')}: ${new Date().toISOString()}\n\n`;

  sortedTables.forEach((table) => {
    sql += `-- ${translate(locale, 'sql.sourceFileLabel')}: ${table.name}\n`;

    if (table.hasChildInSameFile) {
      sql += generateParentChildSameFile(table, operation, locale, context);
    } else if (operation === 'INSERT' && table.externalParentTableId) {
      sql += generateExternalChildTable(table, locale, context);
    } else {
      sql += generateSingleTable(table, operation, locale, context);
    }

    sql += '\n';
  });

  return sql;
}

function createSqlGenerationContext(tables: TableConfig[]): SqlGenerationContext {
  const selectedTablesById = new Map(tables.map((table) => [table.id, table]));
  const dependentChildTablesByParentId = new Map<string, string[]>();

  tables.forEach((table) => {
    if (table.hasChildInSameFile) {
      const current = dependentChildTablesByParentId.get(table.id) ?? [];
      current.push(table.childSqlTableName);
      dependentChildTablesByParentId.set(table.id, current);
      return;
    }

    if (!table.externalParentTableId || !selectedTablesById.has(table.externalParentTableId)) {
      return;
    }

    const current = dependentChildTablesByParentId.get(table.externalParentTableId) ?? [];
    current.push(table.sqlTableName);
    dependentChildTablesByParentId.set(table.externalParentTableId, current);
  });

  const parentRegistriesByTableId = new Map<string, RelationshipParentRegistry>();

  dependentChildTablesByParentId.forEach((childTableNames, parentTableId) => {
    const parentTable = selectedTablesById.get(parentTableId);
    if (!parentTable) return;

    const includedParentMappings = parentTable.parentMappings.filter((mapping) => mapping.include);
    parentRegistriesByTableId.set(parentTableId, {
      parentTableName: parentTable.sqlTableName,
      dependentChildTableNames: childTableNames,
      pkMappings: getPrimaryKeyMappings(parentTable, includedParentMappings),
      generatedIdsByLogicalKey: new Map<string, number>(),
      pkValuesByLogicalKey: new Map<string, Map<string, string>>()
    });
  });

  return {
    selectedTablesById,
    parentRegistriesByTableId
  };
}

function sortTablesByDependency(tables: TableConfig[], reverse: boolean): TableConfig[] {
  const sorted: TableConfig[] = [];
  const visited = new Set<string>();

  const visit = (table: TableConfig) => {
    if (visited.has(table.id)) return;

    if (table.externalParentTableId && !table.hasChildInSameFile) {
      const parent = tables.find((candidate) => candidate.id === table.externalParentTableId);
      if (parent) visit(parent);
    }

    visited.add(table.id);
    sorted.push(table);
  };

  tables.forEach((table) => visit(table));

  return reverse ? sorted.reverse() : sorted;
}

function formatSqlValue(table: TableConfig, mapping: ColumnMapping, value: unknown): string {
  if (value === null || value === undefined || value === 'null' || value === '') return 'NULL';

  const rawValue = String(value);
  const trimmedValue = rawValue.trim();

  switch (mapping.valueType) {
    case 'string':
      return `'${rawValue.replace(/'/g, "''")}'`;
    case 'int':
      if (/^[+-]?\d+$/.test(trimmedValue)) return trimmedValue;
      throwInvalidTypedValue(table, mapping, rawValue);
    case 'decimal': {
      if (/^[+-]?\d+(?:[,.]\d+)?$/.test(trimmedValue)) {
        return trimmedValue.replace(',', '.');
      }

      throwInvalidTypedValue(table, mapping, rawValue);
    }
    case 'bool':
      return formatBooleanValue(trimmedValue, table.booleanMode, table, mapping, rawValue);
    default:
      return `'${rawValue.replace(/'/g, "''")}'`;
  }
}

function formatBooleanValue(
  trimmedValue: string,
  boolMode: BooleanMode,
  table: TableConfig,
  mapping: ColumnMapping,
  rawValue: string
): string {
  const normalized = trimmedValue.toLowerCase();

  if (normalized === '1' || normalized === 'v' || normalized === 'true') {
    return renderBoolean(true, boolMode);
  }

  if (normalized === '0' || normalized === 'f' || normalized === 'false') {
    return renderBoolean(false, boolMode);
  }

  throwInvalidTypedValue(table, mapping, rawValue);
}

function renderBoolean(value: boolean, boolMode: BooleanMode): string {
  if (boolMode === 'TRUE_FALSE') return value ? 'TRUE' : 'FALSE';
  if (boolMode === 'STRING') return value ? "'1'" : "'0'";
  return value ? '1' : '0';
}

function throwInvalidTypedValue(table: TableConfig, mapping: ColumnMapping, rawValue: string): never {
  throw new InvalidTypedValueError({
    tableName: table.sqlTableName,
    columnOriginal: mapping.original,
    columnSqlName: mapping.sqlName,
    expectedType: mapping.valueType,
    rawValue
  });
}

function getPrimaryKeyColumns(table: TableConfig): string[] {
  return table.primaryKeyColumns ?? [];
}

function getPrimaryKeyMappings(table: TableConfig, includedMappings: ColumnMapping[]): ColumnMapping[] | null {
  const primaryKeyColumns = getPrimaryKeyColumns(table);
  if (primaryKeyColumns.length === 0) return null;

  const mappingByOriginal = new Map(includedMappings.map((mapping) => [mapping.original, mapping]));
  const resolvedMappings = primaryKeyColumns
    .map((column) => mappingByOriginal.get(column))
    .filter((mapping): mapping is ColumnMapping => Boolean(mapping));

  return resolvedMappings.length === primaryKeyColumns.length ? resolvedMappings : null;
}

function buildPrimaryKeyWhereClause(table: TableConfig, pkMappings: ColumnMapping[], row: Record<string, unknown>): string {
  return pkMappings
    .map((mapping) => `${mapping.sqlName} = ${formatSqlValue(table, mapping, row[mapping.original])}`)
    .join(' AND ');
}

function resolveAutoIncrementIdConfig(table: TableConfig): ResolvedAutoIncrementIdConfig | null {
  if (!table.autoIncrementId.enabled) return null;

  return {
    columnName: normalizeSqlIdentifier(table.autoIncrementId.columnName),
    startAt: table.autoIncrementId.startAt
  };
}

function buildInsertColumns(
  mappings: ColumnMapping[],
  autoIncrementId?: ResolvedAutoIncrementIdConfig | null,
  extraColumns: string[] = []
): string {
  const columns = [...mappings.map((mapping) => mapping.sqlName)];
  if (extraColumns.length > 0) {
    columns.unshift(...extraColumns);
  }
  if (autoIncrementId) {
    columns.unshift(autoIncrementId.columnName);
  }

  return columns.join(', ');
}

function buildInsertValues(
  table: TableConfig,
  mappings: ColumnMapping[],
  row: Record<string, unknown>,
  autoIncrementIdValue?: number,
  extraValues: string[] = []
): string {
  const values = [...mappings.map((mapping) => formatSqlValue(table, mapping, row[mapping.original]))];
  if (extraValues.length > 0) {
    values.unshift(...extraValues);
  }
  if (autoIncrementIdValue !== undefined) {
    values.unshift(String(autoIncrementIdValue));
  }

  return values.join(', ');
}

function generateSingleTable(
  table: TableConfig,
  operation: SqlOperation,
  locale: Locale,
  context: SqlGenerationContext
): string {
  let output = '';
  const tableName = table.sqlTableName;
  const mappings = table.parentMappings.filter((mapping) => mapping.include);
  const autoIncrementId = resolveAutoIncrementIdConfig(table);

  if (mappings.length === 0) {
    return `-- ${translate(locale, 'sql.noColumnsSelected', { tableName })}`;
  }

  const pkMappings = getPrimaryKeyMappings(table, mappings);
  const registry = context.parentRegistriesByTableId.get(table.id) ?? null;

  if (operation === 'UPDATE') {
    if (!pkMappings) {
      return `-- ${translate(locale, 'sql.pkRequiredUpdate')}`;
    }

    const pkColumns = new Set(pkMappings.map((mapping) => mapping.original));
    const updateMappings = mappings.filter((mapping) => !pkColumns.has(mapping.original));

    if (updateMappings.length === 0) {
      return `-- ${translate(locale, 'sql.noColumnsToUpdate', { tableName })}`;
    }

    table.data.forEach((row) => {
      const updates = updateMappings
        .map((mapping) => `${mapping.sqlName} = ${formatSqlValue(table, mapping, row[mapping.original])}`)
        .join(', ');
      const whereClause = buildPrimaryKeyWhereClause(table, pkMappings, row);
      output += `UPDATE ${tableName} SET ${updates} WHERE ${whereClause};\n`;
    });

    return output;
  }

  if (operation === 'DELETE') {
    if (!pkMappings) {
      return `-- ${translate(locale, 'sql.pkRequiredDelete')}`;
    }

    table.data.forEach((row) => {
      const whereClause = buildPrimaryKeyWhereClause(table, pkMappings, row);
      output += `DELETE FROM ${tableName} WHERE ${whereClause};\n`;
    });

    return output;
  }

  const insertColumns = buildInsertColumns(mappings, autoIncrementId);
  const seenLogicalKeys = new Set<string>();
  let nextAutoIncrementId = autoIncrementId?.startAt ?? 0;

  table.data.forEach((row) => {
    const logicalKey = registry ? buildParentLogicalKeyForRow(table, registry, row) : null;
    if (logicalKey && seenLogicalKeys.has(logicalKey.serialized)) {
      return;
    }

    if (logicalKey) {
      seenLogicalKeys.add(logicalKey.serialized);
    }

    const autoIncrementIdValue = autoIncrementId ? nextAutoIncrementId++ : undefined;
    const vals = buildInsertValues(table, mappings, row, autoIncrementIdValue);
    output += `INSERT INTO ${tableName} (${insertColumns}) VALUES (${vals});\n`;

    if (registry && logicalKey) {
      registerParentReference(registry, table, row, logicalKey, autoIncrementIdValue);
    }
  });

  return output;
}

function generateParentChildSameFile(
  table: TableConfig,
  operation: SqlOperation,
  locale: Locale,
  context: SqlGenerationContext
): string {
  const parentCols = table.parentMappings.filter((mapping) => mapping.include);
  const childCols = table.childMappings.filter((mapping) => mapping.include);
  const pkMappings = getPrimaryKeyMappings(table, parentCols);
  const autoIncrementId = resolveAutoIncrementIdConfig(table);

  if (!pkMappings) {
    return `-- ${translate(locale, 'sql.pkGroupingRequiredParentChild', { tableName: table.name })}`;
  }

  let output = '';
  const parentTable = table.sqlTableName;
  const childTable = table.childSqlTableName;
  const registry = context.parentRegistriesByTableId.get(table.id) ?? null;
  const seenParentKeys = new Set<string>();
  const fkColumns = getSameFileForeignKeyColumns(table);
  const parentInsertColumns = buildInsertColumns(parentCols, autoIncrementId);
  const childInsertColumns = buildInsertColumns(childCols, null, fkColumns);
  let nextAutoIncrementId = autoIncrementId?.startAt ?? 0;

  table.data.forEach((row) => {
    const logicalKey = buildLogicalKeyFromMappings(table, pkMappings, row, {
      childTableName: childTable,
      parentTableName: parentTable
    });

    if (!seenParentKeys.has(logicalKey.serialized)) {
      seenParentKeys.add(logicalKey.serialized);

      if (operation === 'INSERT') {
        const autoIncrementIdValue = autoIncrementId ? nextAutoIncrementId++ : undefined;
        const vals = buildInsertValues(table, parentCols, row, autoIncrementIdValue);
        output += `INSERT INTO ${parentTable} (${parentInsertColumns}) VALUES (${vals});\n`;

        if (registry) {
          registerParentReference(registry, table, row, logicalKey, autoIncrementIdValue);
        }
      } else if (operation === 'DELETE') {
        const whereClause = buildPrimaryKeyWhereClause(table, pkMappings, row);
        output += `DELETE FROM ${parentTable} WHERE ${whereClause};\n`;
      }
    }

    if (operation !== 'INSERT' || (childCols.length === 0 && fkColumns.length === 0)) {
      return;
    }

    const projection = resolveSameFileRelationshipProjection(table, row, registry, logicalKey);
    const vals = buildInsertValues(table, childCols, row, undefined, projection.values);
    output += `INSERT INTO ${childTable} (${childInsertColumns}) VALUES (${vals});\n`;
  });

  return output;
}

function generateExternalChildTable(table: TableConfig, locale: Locale, context: SqlGenerationContext): string {
  const parentTable = resolveExternalParentTable(table, context);
  const ownMappings = table.parentMappings.filter((mapping) => mapping.include);
  const ownAutoIncrementId = resolveAutoIncrementIdConfig(table);
  const ownRegistry = context.parentRegistriesByTableId.get(table.id) ?? null;
  const fkColumns = getExternalForeignKeyColumns(table);

  if (ownMappings.length === 0 && fkColumns.length === 0 && !ownAutoIncrementId) {
    return `-- ${translate(locale, 'sql.noColumnsSelected', { tableName: table.sqlTableName })}`;
  }

  const insertColumns = buildInsertColumns(ownMappings, ownAutoIncrementId, fkColumns);
  const seenLogicalKeys = new Set<string>();
  let output = '';
  let nextAutoIncrementId = ownAutoIncrementId?.startAt ?? 0;

  table.data.forEach((row) => {
    const ownLogicalKey = ownRegistry ? buildParentLogicalKeyForRow(table, ownRegistry, row) : null;
    if (ownLogicalKey && seenLogicalKeys.has(ownLogicalKey.serialized)) {
      return;
    }

    if (ownLogicalKey) {
      seenLogicalKeys.add(ownLogicalKey.serialized);
    }

    const projection = resolveExternalRelationshipProjection(table, row, parentTable, context);
    const autoIncrementIdValue = ownAutoIncrementId ? nextAutoIncrementId++ : undefined;
    const vals = buildInsertValues(table, ownMappings, row, autoIncrementIdValue, projection.values);
    output += `INSERT INTO ${table.sqlTableName} (${insertColumns}) VALUES (${vals});\n`;

    if (ownRegistry && ownLogicalKey) {
      registerParentReference(ownRegistry, table, row, ownLogicalKey, autoIncrementIdValue);
    }
  });

  return output;
}

function resolveExternalParentTable(table: TableConfig, context: SqlGenerationContext): TableConfig {
  if (!table.externalParentTableId) {
    throw new RelationshipSqlGenerationError('RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND', {
      childTableName: table.sqlTableName,
      parentTableName: 'unknown'
    });
  }

  const parentTable = context.selectedTablesById.get(table.externalParentTableId);
  if (!parentTable) {
    throw new RelationshipSqlGenerationError('RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND', {
      childTableName: table.sqlTableName,
      parentTableName: table.externalParentTableId
    });
  }

  return parentTable;
}

function buildParentLogicalKeyForRow(
  table: TableConfig,
  registry: RelationshipParentRegistry,
  row: Record<string, unknown>
): ResolvedLogicalKey {
  if (!registry.pkMappings) {
    throw new RelationshipSqlGenerationError('RELATIONSHIP_PARENT_PK_REQUIRED', {
      childTableName: registry.dependentChildTableNames[0] ?? table.sqlTableName,
      parentTableName: table.sqlTableName
    });
  }

  return buildLogicalKeyFromMappings(table, registry.pkMappings, row, {
    childTableName: registry.dependentChildTableNames[0] ?? table.sqlTableName,
    parentTableName: table.sqlTableName
  });
}

function buildLogicalKeyFromMappings(
  sourceTable: TableConfig,
  mappings: ColumnMapping[],
  row: Record<string, unknown>,
  details: { childTableName: string; parentTableName: string }
): ResolvedLogicalKey {
  const parts = mappings.map((mapping) => {
    const value = row[mapping.original];
    if (isRelationshipKeyValueMissing(value)) {
      throw new RelationshipSqlGenerationError('RELATIONSHIP_ROW_KEY_INCOMPLETE', details);
    }

    return formatSqlValue(sourceTable, mapping, value);
  });

  return {
    serialized: JSON.stringify(parts),
    display: parts.join(', ')
  };
}

function buildLogicalKeyFromExternalMappings(
  childTable: TableConfig,
  parentTable: TableConfig,
  parentPkMappings: ColumnMapping[],
  row: Record<string, unknown>,
  sourceMappings: ExternalRelationshipSourceMapping[]
): ResolvedLogicalKey {
  const childColumnByParentColumn = new Map(sourceMappings.map((entry) => [entry.parentColumn, entry.childColumn]));
  const parts = parentPkMappings.map((parentMapping) => {
    const childColumn = childColumnByParentColumn.get(parentMapping.original);
    if (!childColumn) {
      throw new RelationshipSqlGenerationError('RELATIONSHIP_MAPPING_INCOMPLETE', {
        childTableName: childTable.sqlTableName,
        parentTableName: parentTable.sqlTableName
      });
    }

    const value = row[childColumn];
    if (isRelationshipKeyValueMissing(value)) {
      throw new RelationshipSqlGenerationError('RELATIONSHIP_ROW_KEY_INCOMPLETE', {
        childTableName: childTable.sqlTableName,
        parentTableName: parentTable.sqlTableName
      });
    }

    return formatSqlValue(parentTable, parentMapping, value);
  });

  return {
    serialized: JSON.stringify(parts),
    display: parts.join(', ')
  };
}

function isRelationshipKeyValueMissing(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === 'null';
}

function registerParentReference(
  registry: RelationshipParentRegistry,
  table: TableConfig,
  row: Record<string, unknown>,
  logicalKey: ResolvedLogicalKey,
  generatedId?: number
) {
  if (!registry.pkMappings) {
    return;
  }

  if (generatedId !== undefined) {
    registry.generatedIdsByLogicalKey.set(logicalKey.serialized, generatedId);
  }

  const pkValues = new Map<string, string>();
  registry.pkMappings.forEach((mapping) => {
    pkValues.set(mapping.original, formatSqlValue(table, mapping, row[mapping.original]));
  });
  registry.pkValuesByLogicalKey.set(logicalKey.serialized, pkValues);
}

function getSameFileForeignKeyColumns(table: TableConfig): string[] {
  return table.relationshipTargetMode === 'auto-increment'
    ? [normalizeSqlIdentifier(table.sameFileForeignKeyColumnName)]
    : table.sameFileSelectedPkForeignKeys.map((entry) => normalizeSqlIdentifier(entry.fkColumnName));
}

function getExternalForeignKeyColumns(table: TableConfig): string[] {
  return table.relationshipTargetMode === 'auto-increment'
    ? [normalizeSqlIdentifier(table.externalForeignKeyColumnName)]
    : table.externalSelectedPkForeignKeys.map((entry) => normalizeSqlIdentifier(entry.fkColumnName));
}

function resolveSameFileRelationshipProjection(
  table: TableConfig,
  row: Record<string, unknown>,
  registry: RelationshipParentRegistry | null,
  logicalKey: ResolvedLogicalKey
): RelationshipProjection {
  if (!registry) {
    throw new RelationshipSqlGenerationError('RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND', {
      childTableName: table.childSqlTableName,
      parentTableName: table.sqlTableName
    });
  }

  if (table.relationshipTargetMode === 'auto-increment') {
    const generatedId = registry.generatedIdsByLogicalKey.get(logicalKey.serialized);
    if (generatedId === undefined) {
      throw new RelationshipSqlGenerationError('RELATIONSHIP_PARENT_ROW_NOT_FOUND', {
        childTableName: table.childSqlTableName,
        parentTableName: table.sqlTableName,
        logicalKey: logicalKey.display,
        fkColumnName: table.sameFileForeignKeyColumnName
      });
    }

    return {
      columns: [normalizeSqlIdentifier(table.sameFileForeignKeyColumnName)],
      values: [String(generatedId)]
    };
  }

  return resolveProjectedPrimaryKeyValues(
    registry,
    logicalKey,
    table.sameFileSelectedPkForeignKeys,
    table.childSqlTableName,
    table.sqlTableName
  );
}

function resolveExternalRelationshipProjection(
  childTable: TableConfig,
  row: Record<string, unknown>,
  parentTable: TableConfig,
  context: SqlGenerationContext
): RelationshipProjection {
  const parentRegistry = context.parentRegistriesByTableId.get(parentTable.id);
  if (!parentRegistry || !parentRegistry.pkMappings) {
    throw new RelationshipSqlGenerationError('RELATIONSHIP_PARENT_PK_REQUIRED', {
      childTableName: childTable.sqlTableName,
      parentTableName: parentTable.sqlTableName
    });
  }

  const logicalKey = buildLogicalKeyFromExternalMappings(
    childTable,
    parentTable,
    parentRegistry.pkMappings,
    row,
    childTable.externalRelationshipSourceMappings
  );

  if (childTable.relationshipTargetMode === 'auto-increment') {
    const generatedId = parentRegistry.generatedIdsByLogicalKey.get(logicalKey.serialized);
    if (generatedId === undefined) {
      throw new RelationshipSqlGenerationError('RELATIONSHIP_PARENT_ROW_NOT_FOUND', {
        childTableName: childTable.sqlTableName,
        parentTableName: parentTable.sqlTableName,
        logicalKey: logicalKey.display,
        fkColumnName: childTable.externalForeignKeyColumnName
      });
    }

    return {
      columns: [normalizeSqlIdentifier(childTable.externalForeignKeyColumnName)],
      values: [String(generatedId)]
    };
  }

  return resolveProjectedPrimaryKeyValues(
    parentRegistry,
    logicalKey,
    childTable.externalSelectedPkForeignKeys,
    childTable.sqlTableName,
    parentTable.sqlTableName
  );
}

function resolveProjectedPrimaryKeyValues(
  registry: RelationshipParentRegistry,
  logicalKey: ResolvedLogicalKey,
  configs: ForeignKeySqlColumnConfig[],
  childTableName: string,
  parentTableName: string
): RelationshipProjection {
  const resolvedPkValues = registry.pkValuesByLogicalKey.get(logicalKey.serialized);
  if (!resolvedPkValues) {
    throw new RelationshipSqlGenerationError('RELATIONSHIP_PARENT_ROW_NOT_FOUND', {
      childTableName,
      parentTableName,
      logicalKey: logicalKey.display
    });
  }

  const values = configs.map((config) => {
    const value = resolvedPkValues.get(config.parentColumn);
    if (value === undefined) {
      throw new RelationshipSqlGenerationError('RELATIONSHIP_MAPPING_INCOMPLETE', {
        childTableName,
        parentTableName,
        fkColumnName: config.fkColumnName
      });
    }

    return value;
  });

  return {
    columns: configs.map((config) => normalizeSqlIdentifier(config.fkColumnName)),
    values
  };
}
