import { Injectable, signal, computed } from '@angular/core';
import { TableConfig } from '../models/table-config';
import { BooleanMode } from '../types/boolean-mode';
import { ColumnMapping } from '../models/column-mapping';





export type SqlOperation = 'INSERT' | 'UPDATE' | 'DELETE';

@Injectable({
  providedIn: 'root'
})
export class StoreService {
  // State
  tables = signal<TableConfig[]>([]);
  generatedSql = signal<string>('');
  sqlOperation = signal<SqlOperation>('INSERT');

  // Computed
  tableOptions = computed(() => {
    return this.tables().map(t => ({ id: t.id, name: t.name }));
  });

  // Actions
  addFiles(files: FileList) {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        this.initTable(file.name, text);
      };
      reader.readAsText(file);
    });
  }

  removeTable(id: string) {
    this.tables.update(current => current.filter(t => t.id !== id));
  }

  updateTable(id: string, updates: Partial<TableConfig>) {
    this.tables.update(current => 
      current.map(t => t.id === id ? { ...t, ...updates } : t)
    );
  }

  reparseTable(id: string, newDelimiter: string) {
    const table = this.tables().find(t => t.id === id);
    if (!table) return;

    const { headers, data } = this.parseRawData(table.rawContent, newDelimiter);

    // Try to preserve existing mappings if columns match by name
    const reconcileMappings = (oldMappings: ColumnMapping[], newHeaders: string[]) => {
      return newHeaders.map(h => {
        const existing = oldMappings.find(m => m.original === h);
        return existing || {
          original: h,
          sqlName: h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
          include: true // Default to true for new columns
        };
      });
    };

    const reconcileChildMappings = (oldMappings: ColumnMapping[], newHeaders: string[]) => {
      return newHeaders.map(h => {
        const existing = oldMappings.find(m => m.original === h);
        return existing || {
          original: h,
          sqlName: h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
          include: false // Default to false for new child columns
        };
      });
    };

    const newParentMappings = reconcileMappings(table.parentMappings, headers);
    const newChildMappings = reconcileChildMappings(table.childMappings, headers);

    // Check if PK is still valid
    let newPk = table.primaryKey;
    if (newPk && !headers.includes(newPk)) newPk = null;

    this.tables.update(current => current.map(t => {
      if (t.id !== id) return t;
      return {
        ...t,
        delimiter: newDelimiter,
        columns: headers,
        data: data,
        parentMappings: newParentMappings,
        childMappings: newChildMappings,
        primaryKey: newPk
      };
    }));
  }

  updateParentMapping(tableId: string, originalCol: string, changes: Partial<ColumnMapping>) {
    this.tables.update(current => 
      current.map(t => {
        if (t.id !== tableId) return t;
        return {
          ...t,
          parentMappings: t.parentMappings.map(m => 
            m.original === originalCol ? { ...m, ...changes } : m
          )
        };
      })
    );
  }

  updateChildMapping(tableId: string, originalCol: string, changes: Partial<ColumnMapping>) {
    this.tables.update(current => 
      current.map(t => {
        if (t.id !== tableId) return t;
        return {
          ...t,
          childMappings: t.childMappings.map(m => 
            m.original === originalCol ? { ...m, ...changes } : m
          )
        };
      })
    );
  }

  setOperation(op: SqlOperation) {
    this.sqlOperation.set(op);
  }

  generate() {
    const operation = this.sqlOperation();
    const tables = this.tables().filter(t => t.selected);
    
    const sortedTables = this.sortTablesByDependency(tables, operation === 'DELETE');
    
    let sql = `-- Generated SQL Script\n-- Operation: ${operation}\n-- Date: ${new Date().toISOString()}\n\n`;

    sortedTables.forEach(table => {
      sql += `-- Source File: ${table.name}\n`;
      
      if (table.hasChildInSameFile) {
        sql += this.generateParentChildSameFile(table, operation);
      } else {
        sql += this.generateSingleTable(table, operation);
      }
      sql += '\n';
    });

    this.generatedSql.set(sql);
  }

  // --- Private Helpers ---

  private initTable(filename: string, content: string) {
    // Detect delimiter logic
    const delimiters = [',', ';', '\t', '|'];
    let bestDelimiter = ',';
    
    // Quick heuristic: check first line (rough split)
    const firstLineEnd = content.indexOf('\n');
    const sample = firstLineEnd > -1 ? content.substring(0, firstLineEnd) : content.substring(0, 1000);
    
    let maxCount = 0;
    for (const d of delimiters) {
      const count = sample.split(d).length - 1;
      if (count > maxCount) {
        maxCount = count;
        bestDelimiter = d;
      }
    }

    const { headers, data } = this.parseRawData(content, bestDelimiter);

    const cleanName = filename.replace(/\.csv$/i, '');
    
    const mappings: ColumnMapping[] = headers.map(h => ({
      original: h,
      sqlName: h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      include: true
    }));

    const childMappings: ColumnMapping[] = headers.map(h => ({
      original: h,
      sqlName: h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      include: false
    }));

    const newTable: TableConfig = {
      id: crypto.randomUUID(),
      name: cleanName,
      rawContent: content,
      delimiter: bestDelimiter,
      booleanMode: 'AS_IS', // Default

      sqlTableName: cleanName.replace(/\s+/g, '_'),
      columns: headers,
      parentMappings: mappings,
      data,
      selected: true,
      primaryKey: headers[0] || null,
      
      hasChildInSameFile: false,
      childSqlTableName: cleanName.replace(/\s+/g, '_') + '_child',
      childMappings: childMappings,
      
      externalParentTableId: null,
      externalForeignKey: null
    };

    this.tables.update(t => [...t, newTable]);
  }

  private parseRawData(content: string, delimiter: string): { headers: string[], data: any[] } {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuote = false;
    
    // Normalize line endings
    const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const len = text.length;
    
    const delim = delimiter === 'TAB' ? '\t' : delimiter;

    for (let i = 0; i < len; i++) {
      const char = text[i];
      
      if (inQuote) {
        if (char === '"') {
          // Handle escaped quotes: "" inside a quoted string becomes "
          if (i + 1 < len && text[i + 1] === '"') {
            currentField += '"';
            i++; 
          } else {
            inQuote = false;
          }
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
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
    }
    // Flush last field/row
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    if (rows.length === 0) return { headers: [], data: [] };

    // Headers logic
    const rawHeaders = rows[0].map(h => h.trim());
    
    // Deduplicate headers
    const headers: string[] = [];
    const headerCounts: Record<string, number> = {};
    rawHeaders.forEach(h => {
        const cleanH = h || `Column`;
        if (headerCounts[cleanH] === undefined) {
            headerCounts[cleanH] = 0;
            headers.push(cleanH);
        } else {
            headerCounts[cleanH]++;
            headers.push(`${cleanH}_${headerCounts[cleanH]}`);
        }
    });

    const data = rows.slice(1).map(values => {
      const row: any = {};
      headers.forEach((h, i) => {
        let val = values[i];
        if (val !== undefined) val = val.trim();
        if (val === 'null') val = null;
        if (val === '') val = null;
        row[h] = val;
      });
      return row;
    });

    return { headers, data };
  }

  private sortTablesByDependency(tables: TableConfig[], reverse: boolean): TableConfig[] {
    const sorted: TableConfig[] = [];
    const visited = new Set<string>();
    
    const visit = (table: TableConfig) => {
      if (visited.has(table.id)) return;
      if (table.externalParentTableId && !table.hasChildInSameFile) {
        const parent = tables.find(t => t.id === table.externalParentTableId);
        if (parent) visit(parent);
      }
      visited.add(table.id);
      sorted.push(table);
    };

    tables.forEach(t => visit(t));
    return reverse ? sorted.reverse() : sorted;
  }

  private escapeSql(val: any, boolMode: BooleanMode): string {
    if (val === null || val === undefined || val === 'null' || val === '') return 'NULL';
    
    const strVal = String(val).trim();

    // Boolean Logic
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

    if (!isNaN(Number(val))) return val.toString();
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  private generateSingleTable(table: TableConfig, op: SqlOperation): string {
    let output = '';
    const tableName = table.sqlTableName;
    const mappings = table.parentMappings.filter(m => m.include);
    
    if (mappings.length === 0) return `-- No columns selected for ${tableName}`;

    table.data.forEach(row => {
      if (op === 'INSERT') {
        const cols = mappings.map(m => m.sqlName).join(', ');
        const vals = mappings.map(m => this.escapeSql(row[m.original], table.booleanMode)).join(', ');
        output += `INSERT INTO ${tableName} (${cols}) VALUES (${vals});\n`;
      } else if (op === 'UPDATE') {
        if (!table.primaryKey) { output += `-- Error: PK required for UPDATE\n`; return; }
        const pkMapping = mappings.find(m => m.original === table.primaryKey);
        if (!pkMapping) { output += `-- Error: PK column not included in mapping\n`; return; }
        
        const pkVal = this.escapeSql(row[table.primaryKey], table.booleanMode);
        const updates = mappings
          .filter(m => m.original !== table.primaryKey)
          .map(m => `${m.sqlName} = ${this.escapeSql(row[m.original], table.booleanMode)}`)
          .join(', ');
        output += `UPDATE ${tableName} SET ${updates} WHERE ${pkMapping.sqlName} = ${pkVal};\n`;
      } else if (op === 'DELETE') {
         if (!table.primaryKey) { output += `-- Error: PK required for DELETE\n`; return; }
         const pkMapping = table.parentMappings.find(m => m.original === table.primaryKey);
         const pkName = pkMapping ? pkMapping.sqlName : table.primaryKey;
         const pkVal = this.escapeSql(row[table.primaryKey], table.booleanMode);
         output += `DELETE FROM ${tableName} WHERE ${pkName} = ${pkVal};\n`;
      }
    });
    return output;
  }

  private generateParentChildSameFile(table: TableConfig, op: SqlOperation): string {
    if (!table.primaryKey) return `-- Error: Primary Key (Grouping Key) required for Parent-Child generation in ${table.name}`;

    let output = '';
    const parentTable = table.sqlTableName;
    const childTable = table.childSqlTableName;
    
    const parentCols = table.parentMappings.filter(m => m.include);
    const childCols = table.childMappings.filter(m => m.include);

    // Sort data by PK to ensure grouping
    const sortedData = [...table.data].sort((a, b) => {
      const valA = a[table.primaryKey!] || '';
      const valB = b[table.primaryKey!] || '';
      return valA > valB ? 1 : valA < valB ? -1 : 0;
    });

    let lastPkValue: any = null;

    sortedData.forEach(row => {
      const currentPkValue = row[table.primaryKey!];

      // Handle Parent
      if (currentPkValue !== lastPkValue) {
        if (op === 'INSERT') {
          const cols = parentCols.map(m => m.sqlName).join(', ');
          const vals = parentCols.map(m => this.escapeSql(row[m.original], table.booleanMode)).join(', ');
          output += `INSERT INTO ${parentTable} (${cols}) VALUES (${vals});\n`;
        } 
        else if (op === 'DELETE') {
           const pkMapping = parentCols.find(m => m.original === table.primaryKey);
           if (pkMapping) {
             output += `DELETE FROM ${parentTable} WHERE ${pkMapping.sqlName} = ${this.escapeSql(currentPkValue, table.booleanMode)};\n`;
           }
        }
        lastPkValue = currentPkValue;
      }

      // Handle Child
      if (childCols.length > 0) {
        if (op === 'INSERT') {
          const cols = childCols.map(m => m.sqlName).join(', ');
          const vals = childCols.map(m => this.escapeSql(row[m.original], table.booleanMode)).join(', ');
          output += `INSERT INTO ${childTable} (${cols}) VALUES (${vals});\n`;
        }
      }
    });

    return output;
  }
}