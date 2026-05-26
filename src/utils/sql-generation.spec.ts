import { describe, expect, it } from 'vitest';
import { createMappingFixture, createTableFixture } from '../testing/table-fixtures';
import { generateSqlResponse } from './sql-generation';

describe('generateSqlResponse', () => {
  it('keeps generating SQL for a valid simple csv', () => {
    const table = createTableFixture({
      sqlTableName: 'clientes',
      columns: ['id', 'nome'],
      parentMappings: [
        createMappingFixture('id', { valueType: 'int' }),
        createMappingFixture('nome', { valueType: 'string' })
      ],
      data: [{ id: '1', nome: 'Ana' }]
    });

    const response = generateSqlResponse([table], 'INSERT', 'pt-BR');

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.sql).toContain('INSERT INTO clientes');
      expect(response.issues).toHaveLength(0);
    }
  });

  it('blocks invalid typed values with row and column context', () => {
    const table = createTableFixture({
      sqlTableName: 'pedidos',
      columns: ['id', 'valor_total_item'],
      parentMappings: [
        createMappingFixture('id', { valueType: 'int' }),
        createMappingFixture('valor_total_item', { valueType: 'decimal' })
      ],
      data: [{ id: '1', valor_total_item: 'ABC' }]
    });

    const response = generateSqlResponse([table], 'INSERT', 'pt-BR');

    expect(response.ok).toBe(false);
    expect(response.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_TYPED_VALUE',
          csvLineNumber: 2,
          columnOriginal: 'valor_total_item',
          rawValue: 'ABC'
        })
      ])
    );
  });

  it('generates SQL for valid composite keys across files', () => {
    const parent = createTableFixture({
      id: 'parent',
      sqlTableName: 'notas',
      columns: ['numero_nota', 'serie_nota', 'cliente'],
      primaryKeyColumns: ['numero_nota', 'serie_nota'],
      parentMappings: [
        createMappingFixture('numero_nota', { valueType: 'int' }),
        createMappingFixture('serie_nota', { valueType: 'int' }),
        createMappingFixture('cliente', { valueType: 'string' })
      ],
      data: [
        { numero_nota: '234241', serie_nota: '4', cliente: 'ACME' }
      ]
    });

    const child = createTableFixture({
      id: 'child',
      sqlTableName: 'notas_itens',
      columns: ['numero_nota', 'serie_nota', 'descricao'],
      parentMappings: [
        createMappingFixture('numero_nota', { valueType: 'int' }),
        createMappingFixture('serie_nota', { valueType: 'int' }),
        createMappingFixture('descricao', { valueType: 'string' })
      ],
      data: [
        { numero_nota: '234241', serie_nota: '4', descricao: 'Item A' }
      ],
      externalParentTableId: 'parent',
      relationshipTargetMode: 'selected-pk',
      externalRelationshipSourceMappings: [
        { parentColumn: 'numero_nota', childColumn: 'numero_nota' },
        { parentColumn: 'serie_nota', childColumn: 'serie_nota' }
      ],
      externalSelectedPkForeignKeys: [
        { parentColumn: 'numero_nota', fkColumnName: 'numero_nota_fk' },
        { parentColumn: 'serie_nota', fkColumnName: 'serie_nota_fk' }
      ]
    });

    const response = generateSqlResponse([parent, child], 'INSERT', 'pt-BR');

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.sql).toContain('INSERT INTO notas ');
      expect(response.sql).toContain('INSERT INTO notas_itens ');
      expect(response.issues).toHaveLength(0);
    }
  });

  it('blocks external relationships when the parent key cannot be resolved', () => {
    const parent = createTableFixture({
      id: 'parent',
      sqlTableName: 'notas',
      columns: ['numero_nota', 'serie_nota'],
      primaryKeyColumns: ['numero_nota', 'serie_nota'],
      parentMappings: [
        createMappingFixture('numero_nota', { valueType: 'int' }),
        createMappingFixture('serie_nota', { valueType: 'int' })
      ],
      data: [{ numero_nota: '1', serie_nota: '1' }]
    });

    const child = createTableFixture({
      id: 'child',
      sqlTableName: 'notas_itens',
      columns: ['numero_nota', 'serie_nota', 'descricao'],
      parentMappings: [
        createMappingFixture('numero_nota', { valueType: 'int' }),
        createMappingFixture('serie_nota', { valueType: 'int' }),
        createMappingFixture('descricao', { valueType: 'string' })
      ],
      data: [{ numero_nota: '234241', serie_nota: '4', descricao: 'Item perdido' }],
      externalParentTableId: 'parent',
      relationshipTargetMode: 'selected-pk',
      externalRelationshipSourceMappings: [
        { parentColumn: 'numero_nota', childColumn: 'numero_nota' },
        { parentColumn: 'serie_nota', childColumn: 'serie_nota' }
      ],
      externalSelectedPkForeignKeys: [
        { parentColumn: 'numero_nota', fkColumnName: 'numero_nota_fk' },
        { parentColumn: 'serie_nota', fkColumnName: 'serie_nota_fk' }
      ]
    });

    const response = generateSqlResponse([parent, child], 'INSERT', 'pt-BR');

    expect(response.ok).toBe(false);
    expect(response.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RELATIONSHIP_PARENT_ROW_NOT_FOUND',
          csvLineNumber: 2
        })
      ])
    );
  });

  it('emits a warning when an int column loses a leading zero', () => {
    const table = createTableFixture({
      sqlTableName: 'produtos',
      columns: ['codigo_ncm'],
      primaryKeyColumns: ['codigo_ncm'],
      parentMappings: [
        createMappingFixture('codigo_ncm', { valueType: 'int' })
      ],
      data: [{ codigo_ncm: '0123' }]
    });

    const response = generateSqlResponse([table], 'INSERT', 'pt-BR');

    expect(response.ok).toBe(true);
    expect(response.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VALUE_LOSES_LEADING_ZERO',
          columnOriginal: 'codigo_ncm',
          csvLineNumber: 2
        })
      ])
    );
  });
});
