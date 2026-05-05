import { TableConfig } from '../models/table-config';
import { ColumnMapping } from '../models/column-mapping';
import { BooleanMode } from '../types/boolean-mode';
import { translate } from '../i18n/catalog';
import { Locale } from '../types/locale';
import { SqlOperation } from '../types/sql-operation';
import { InvalidTypedValueError } from './sql-generation-errors';

export function buildSql(tables: TableConfig[], operation: SqlOperation, locale: Locale): string {
  const selectedTables = tables.filter((table) => table.selected);
  const sortedTables = sortTablesByDependency(selectedTables, operation === 'DELETE');

  let sql = `-- ${translate(locale, 'sql.generatedScript')}\n`;
  sql += `-- ${translate(locale, 'sql.operationLabel')}: ${operation}\n`;
  sql += `-- ${translate(locale, 'sql.dateLabel')}: ${new Date().toISOString()}\n\n`;

  sortedTables.forEach((table) => {
    sql += `-- ${translate(locale, 'sql.sourceFileLabel')}: ${table.name}\n`;

    if (table.hasChildInSameFile) {
      sql += generateParentChildSameFile(table, operation, locale);
    } else {
      sql += generateSingleTable(table, operation, locale);
    }

    sql += '\n';
  });

  return sql;
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

function findMappingByOriginal(mappings: ColumnMapping[], original: string): ColumnMapping | undefined {
  return mappings.find((mapping) => mapping.original === original);
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

function buildCompositeKey(table: TableConfig, pkMappings: ColumnMapping[], row: Record<string, unknown>): string {
  const parts = pkMappings.map((mapping) => formatSqlValue(table, mapping, row[mapping.original]));
  return JSON.stringify(parts);
}

function generateSingleTable(table: TableConfig, operation: SqlOperation, locale: Locale): string {
  let output = '';
  const tableName = table.sqlTableName;
  const mappings = table.parentMappings.filter((mapping) => mapping.include);

  if (mappings.length === 0) {
    return `-- ${translate(locale, 'sql.noColumnsSelected', { tableName })}`;
  }

  const pkMappings = getPrimaryKeyMappings(table, mappings);

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

  table.data.forEach((row) => {
    if (operation === 'INSERT') {
      const cols = mappings.map((mapping) => mapping.sqlName).join(', ');
      const vals = mappings
        .map((mapping) => formatSqlValue(table, mapping, row[mapping.original]))
        .join(', ');
      output += `INSERT INTO ${tableName} (${cols}) VALUES (${vals});\n`;
      return;
    }
  });

  return output;
}

function generateParentChildSameFile(
  table: TableConfig,
  operation: SqlOperation,
  locale: Locale
): string {
  const parentCols = table.parentMappings.filter((mapping) => mapping.include);
  const childCols = table.childMappings.filter((mapping) => mapping.include);
  const pkMappings = getPrimaryKeyMappings(table, parentCols);

  if (!pkMappings) {
    return `-- ${translate(locale, 'sql.pkGroupingRequiredParentChild', { tableName: table.name })}`;
  }

  let output = '';
  const parentTable = table.sqlTableName;
  const childTable = table.childSqlTableName;

  const seenParentKeys = new Set<string>();

  table.data.forEach((row) => {
    const compositeKey = buildCompositeKey(table, pkMappings, row);

    if (!seenParentKeys.has(compositeKey)) {
      seenParentKeys.add(compositeKey);

      if (operation === 'INSERT') {
        const cols = parentCols.map((mapping) => mapping.sqlName).join(', ');
        const vals = parentCols
          .map((mapping) => formatSqlValue(table, mapping, row[mapping.original]))
          .join(', ');
        output += `INSERT INTO ${parentTable} (${cols}) VALUES (${vals});\n`;
      } else if (operation === 'DELETE') {
        const whereClause = buildPrimaryKeyWhereClause(table, pkMappings, row);
        output += `DELETE FROM ${parentTable} WHERE ${whereClause};\n`;
      }
    }

    if (childCols.length > 0 && operation === 'INSERT') {
      const cols = childCols.map((mapping) => mapping.sqlName).join(', ');
      const vals = childCols
        .map((mapping) => formatSqlValue(table, mapping, row[mapping.original]))
        .join(', ');
      output += `INSERT INTO ${childTable} (${cols}) VALUES (${vals});\n`;
    }
  });

  return output;
}
