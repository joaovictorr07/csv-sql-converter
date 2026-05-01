import { Injectable, computed, inject, signal } from '@angular/core';
import { TableConfig } from '../models/table-config';
import { ColumnMapping } from '../models/column-mapping';
import { SqlOperation } from '../types/sql-operation';
import { LoadingService } from './loading.service';
import { SqlGenerationService } from './sql-generation.service';

@Injectable({
  providedIn: 'root'
})
export class StoreService {
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
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        this.initTable(file.name, text);
      };
      reader.readAsText(file);
    });
  }

  removeTable(id: string) {
    this.tables.update((current) => current.filter((table) => table.id !== id));
  }

  updateTable(id: string, updates: Partial<TableConfig>) {
    this.tables.update((current) =>
      current.map((table) => (table.id === id ? { ...table, ...updates } : table))
    );
  }

  reparseTable(id: string, newDelimiter: string) {
    const table = this.tables().find((entry) => entry.id === id);
    if (!table) return;

    const { headers, data } = this.parseRawData(table.rawContent, newDelimiter);

    const reconcileMappings = (oldMappings: ColumnMapping[], newHeaders: string[]) => {
      return newHeaders.map((header) => {
        const existing = oldMappings.find((mapping) => mapping.original === header);
        return (
          existing || {
            original: header,
            sqlName: header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
            include: true
          }
        );
      });
    };

    const reconcileChildMappings = (oldMappings: ColumnMapping[], newHeaders: string[]) => {
      return newHeaders.map((header) => {
        const existing = oldMappings.find((mapping) => mapping.original === header);
        return (
          existing || {
            original: header,
            sqlName: header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
            include: false
          }
        );
      });
    };

    const newParentMappings = reconcileMappings(table.parentMappings, headers);
    const newChildMappings = reconcileChildMappings(table.childMappings, headers);

    let newPk = table.primaryKey;
    if (newPk && !headers.includes(newPk)) newPk = null;

    this.tables.update((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;

        return {
          ...entry,
          delimiter: newDelimiter,
          columns: headers,
          data,
          parentMappings: newParentMappings,
          childMappings: newChildMappings,
          primaryKey: newPk
        };
      })
    );
  }

  updateParentMapping(tableId: string, originalCol: string, changes: Partial<ColumnMapping>) {
    this.tables.update((current) =>
      current.map((table) => {
        if (table.id !== tableId) return table;

        return {
          ...table,
          parentMappings: table.parentMappings.map((mapping) =>
            mapping.original === originalCol ? { ...mapping, ...changes } : mapping
          )
        };
      })
    );
  }

  updateChildMapping(tableId: string, originalCol: string, changes: Partial<ColumnMapping>) {
    this.tables.update((current) =>
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

  setOperation(operation: SqlOperation) {
    this.sqlOperation.set(operation);
  }

  async generate(): Promise<void> {
    if (this.isGenerating()) return;

    this.isGenerating.set(true);
    this.generationError.set(null);

    try {
      const sql = await this.loading.track(
        {
          context: 'sql-generation',
          title: 'Generating SQL',
          message: 'Processing CSV data in the background.'
        },
        () =>
          this.sqlGeneration.generate({
            tables: this.tables(),
            operation: this.sqlOperation()
          })
      );

      this.generatedSql.set(sql);
    } catch (error) {
      this.generationError.set(
        error instanceof Error ? error.message : 'Failed to generate SQL.'
      );
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

    const mappings: ColumnMapping[] = headers.map((header) => ({
      original: header,
      sqlName: header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      include: true
    }));

    const childMappings: ColumnMapping[] = headers.map((header) => ({
      original: header,
      sqlName: header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      include: false
    }));

    const newTable: TableConfig = {
      id: crypto.randomUUID(),
      name: cleanName,
      rawContent: content,
      delimiter: bestDelimiter,
      booleanMode: 'AS_IS',
      sqlTableName: cleanName.replace(/\s+/g, '_'),
      columns: headers,
      parentMappings: mappings,
      data,
      selected: true,
      primaryKey: headers[0] || null,
      hasChildInSameFile: false,
      childSqlTableName: `${cleanName.replace(/\s+/g, '_')}_child`,
      childMappings,
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
}
