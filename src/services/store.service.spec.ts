import '@angular/compiler';
import { DOCUMENT } from '@angular/common';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMappingFixture, createTableFixture } from '../testing/table-fixtures';
import { I18nService } from './i18n.service';
import { LoadingService } from './loading.service';
import { SqlGenerationService } from './sql-generation.service';
import { StoreService } from './store.service';

describe('StoreService.generate', () => {
  const sqlGenerationMock = {
    generate: vi.fn()
  };
  const loadingMock = {
    track: vi.fn(async (_config: unknown, task: () => Promise<unknown>) => task())
  };
  const i18nMock = {
    locale: () => 'pt-BR',
    t: (key: string) => key
  };

  beforeEach(() => {
    sqlGenerationMock.generate.mockReset();
    loadingMock.track.mockClear();
  });

  it('keeps the previous sql when generation fails in the worker response', async () => {
    const injector = Injector.create({
      providers: [
        StoreService,
        {
          provide: LoadingService,
          useValue: loadingMock
        },
        {
          provide: I18nService,
          useValue: i18nMock
        },
        {
          provide: SqlGenerationService,
          useValue: sqlGenerationMock
        },
        {
          provide: DOCUMENT,
          useValue: document
        }
      ]
    });

    const store = injector.get(StoreService);
    const table = createTableFixture({
      sqlTableName: 'pedidos',
      columns: ['id', 'valor_total_item'],
      parentMappings: [
        createMappingFixture('id', { valueType: 'int' }),
        createMappingFixture('valor_total_item', { valueType: 'decimal' })
      ],
      data: [{ id: '1', valor_total_item: 'ABC' }]
    });

    store.tables.set([table]);
    store.generatedSql.set('SELECT 1;');

    sqlGenerationMock.generate.mockResolvedValue({
      ok: false,
      issues: [
        {
          severity: 'error',
          phase: 'generation',
          code: 'INVALID_TYPED_VALUE',
          tableId: table.id,
          fileName: table.name,
          tableName: table.sqlTableName,
          columnOriginal: 'valor_total_item',
          columnSqlName: 'valor_total_item',
          csvLineNumber: 2,
          rawValue: 'ABC',
          params: {
            expectedType: 'decimal'
          }
        }
      ]
    });

    await store.generate();

    expect(store.generatedSql()).toBe('SELECT 1;');
    expect(store.generationReport()?.errors).toHaveLength(1);
    expect(store.generationReport()?.keptPreviousSql).toBe(true);
  });
});
