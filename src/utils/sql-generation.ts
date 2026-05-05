import { TableConfig } from '../models/table-config';
import { BooleanMode } from '../types/boolean-mode';
import { translate } from '../i18n/catalog';
import { Locale } from '../types/locale';
import { SqlOperation } from '../types/sql-operation';

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

function escapeSql(val: unknown, boolMode: BooleanMode): string {
  if (val === null || val === undefined || val === 'null' || val === '') return 'NULL';

  const strVal = String(val).trim();

  if (strVal === '0') {
    if (boolMode === 'TRUE_FALSE') return 'FALSE';
    if (boolMode === 'BIT') return '0';
    if (boolMode === 'STRING') return "'0'";
  }

  if (strVal === '1') {
    if (boolMode === 'TRUE_FALSE') return 'TRUE';
    if (boolMode === 'BIT') return '1';
    if (boolMode === 'STRING') return "'1'";
  }

  if (!isNaN(Number(val))) return String(val);

  return `'${String(val).replace(/'/g, "''")}'`;
}

function generateSingleTable(table: TableConfig, operation: SqlOperation, locale: Locale): string {
  let output = '';
  const tableName = table.sqlTableName;
  const mappings = table.parentMappings.filter((mapping) => mapping.include);

  if (mappings.length === 0) {
    return `-- ${translate(locale, 'sql.noColumnsSelected', { tableName })}`;
  }

  table.data.forEach((row) => {
    if (operation === 'INSERT') {
      const cols = mappings.map((mapping) => mapping.sqlName).join(', ');
      const vals = mappings
        .map((mapping) => escapeSql(row[mapping.original], table.booleanMode))
        .join(', ');
      output += `INSERT INTO ${tableName} (${cols}) VALUES (${vals});\n`;
      return;
    }

    if (operation === 'UPDATE') {
      if (!table.primaryKey) {
        output += `-- ${translate(locale, 'sql.pkRequiredUpdate')}\n`;
        return;
      }

      const pkMapping = mappings.find((mapping) => mapping.original === table.primaryKey);
      if (!pkMapping) {
        output += `-- ${translate(locale, 'sql.pkColumnNotIncluded')}\n`;
        return;
      }

      const pkVal = escapeSql(row[table.primaryKey], table.booleanMode);
      const updates = mappings
        .filter((mapping) => mapping.original !== table.primaryKey)
        .map((mapping) => `${mapping.sqlName} = ${escapeSql(row[mapping.original], table.booleanMode)}`)
        .join(', ');
      output += `UPDATE ${tableName} SET ${updates} WHERE ${pkMapping.sqlName} = ${pkVal};\n`;
      return;
    }

    if (!table.primaryKey) {
      output += `-- ${translate(locale, 'sql.pkRequiredDelete')}\n`;
      return;
    }

    const pkMapping = table.parentMappings.find((mapping) => mapping.original === table.primaryKey);
    const pkName = pkMapping ? pkMapping.sqlName : table.primaryKey;
    const pkVal = escapeSql(row[table.primaryKey], table.booleanMode);
    output += `DELETE FROM ${tableName} WHERE ${pkName} = ${pkVal};\n`;
  });

  return output;
}

function generateParentChildSameFile(
  table: TableConfig,
  operation: SqlOperation,
  locale: Locale
): string {
  if (!table.primaryKey) {
    return `-- ${translate(locale, 'sql.pkGroupingRequiredParentChild', { tableName: table.name })}`;
  }

  let output = '';
  const parentTable = table.sqlTableName;
  const childTable = table.childSqlTableName;

  const parentCols = table.parentMappings.filter((mapping) => mapping.include);
  const childCols = table.childMappings.filter((mapping) => mapping.include);

  const sortedData = [...table.data].sort((rowA, rowB) => {
    const valA = rowA[table.primaryKey!] || '';
    const valB = rowB[table.primaryKey!] || '';
    return valA > valB ? 1 : valA < valB ? -1 : 0;
  });

  let lastPkValue: unknown = null;

  sortedData.forEach((row) => {
    const currentPkValue = row[table.primaryKey!];

    if (currentPkValue !== lastPkValue) {
      if (operation === 'INSERT') {
        const cols = parentCols.map((mapping) => mapping.sqlName).join(', ');
        const vals = parentCols
          .map((mapping) => escapeSql(row[mapping.original], table.booleanMode))
          .join(', ');
        output += `INSERT INTO ${parentTable} (${cols}) VALUES (${vals});\n`;
      } else if (operation === 'DELETE') {
        const pkMapping = parentCols.find((mapping) => mapping.original === table.primaryKey);
        if (pkMapping) {
          output += `DELETE FROM ${parentTable} WHERE ${pkMapping.sqlName} = ${escapeSql(currentPkValue, table.booleanMode)};\n`;
        }
      }

      lastPkValue = currentPkValue;
    }

    if (childCols.length > 0 && operation === 'INSERT') {
      const cols = childCols.map((mapping) => mapping.sqlName).join(', ');
      const vals = childCols
        .map((mapping) => escapeSql(row[mapping.original], table.booleanMode))
        .join(', ');
      output += `INSERT INTO ${childTable} (${cols}) VALUES (${vals});\n`;
    }
  });

  return output;
}
