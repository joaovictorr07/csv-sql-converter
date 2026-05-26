import { ColumnMapping } from '../models/column-mapping';
import { TableConfig } from '../models/table-config';

function createMapping(original: string, include = true, valueType: ColumnMapping['valueType'] = 'string'): ColumnMapping {
  return {
    original,
    sqlName: original,
    include,
    valueType
  };
}

export function createTableFixture(overrides: Partial<TableConfig> = {}): TableConfig {
  const columns = overrides.columns ?? ['id', 'name'];
  const parentMappings =
    overrides.parentMappings ?? columns.map((column, index) => createMapping(column, true, index === 0 ? 'int' : 'string'));
  const childMappings = overrides.childMappings ?? columns.map((column) => createMapping(column, false, 'string'));

  return {
    id: overrides.id ?? `table-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'sample',
    rawContent: overrides.rawContent ?? 'id,name\n1,A',
    delimiter: overrides.delimiter ?? ',',
    booleanMode: overrides.booleanMode ?? 'AS_IS',
    sqlTableName: overrides.sqlTableName ?? 'sample',
    primaryKeyColumns: overrides.primaryKeyColumns ?? (columns[0] ? [columns[0]] : []),
    columns,
    parentMappings,
    data: overrides.data ?? [{ [columns[0]]: '1', [columns[1] ?? 'name']: 'A' }],
    selected: overrides.selected ?? true,
    hasChildInSameFile: overrides.hasChildInSameFile ?? false,
    childSqlTableName: overrides.childSqlTableName ?? 'sample_child',
    childMappings,
    relationshipTargetMode: overrides.relationshipTargetMode ?? 'auto-increment',
    sameFileForeignKeyColumnName: overrides.sameFileForeignKeyColumnName ?? 'sample_id',
    sameFileSelectedPkForeignKeys: overrides.sameFileSelectedPkForeignKeys ?? [
      {
        parentColumn: overrides.primaryKeyColumns?.[0] ?? columns[0] ?? 'id',
        fkColumnName: 'sample_id'
      }
    ],
    externalParentTableId: overrides.externalParentTableId ?? null,
    externalRelationshipSourceMappings: overrides.externalRelationshipSourceMappings ?? [
      {
        parentColumn: overrides.primaryKeyColumns?.[0] ?? columns[0] ?? 'id',
        childColumn: columns[0] ?? 'id'
      }
    ],
    externalForeignKeyColumnName: overrides.externalForeignKeyColumnName ?? 'parent_id',
    externalSelectedPkForeignKeys: overrides.externalSelectedPkForeignKeys ?? [
      {
        parentColumn: overrides.primaryKeyColumns?.[0] ?? columns[0] ?? 'id',
        fkColumnName: 'parent_id'
      }
    ],
    autoIncrementId: overrides.autoIncrementId ?? {
      enabled: false,
      columnName: 'id_auto',
      startAt: 1
    }
  };
}

export function createMappingFixture(
  original: string,
  overrides: Partial<ColumnMapping> = {}
): ColumnMapping {
  return {
    original,
    sqlName: original,
    include: true,
    valueType: 'string',
    ...overrides
  };
}
