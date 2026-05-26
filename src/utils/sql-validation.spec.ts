import { describe, expect, it } from 'vitest';
import { createMappingFixture, createTableFixture } from '../testing/table-fixtures';
import { validateSelectedTablesPreflight } from './sql-validation';

describe('validateSelectedTablesPreflight', () => {
  it('blocks auto increment without an id column name', () => {
    const table = createTableFixture({
      sqlTableName: 'notas',
      autoIncrementId: {
        enabled: true,
        columnName: '',
        startAt: 1
      }
    });

    const issues = validateSelectedTablesPreflight([table], 'INSERT');

    expect(issues.some((issue) => issue.code === 'AUTO_INCREMENT_ID_COLUMN_REQUIRED')).toBe(true);
  });

  it('blocks same-file child generation without a configured fk column', () => {
    const table = createTableFixture({
      sqlTableName: 'dirbi',
      hasChildInSameFile: true,
      childSqlTableName: 'dirbi_itens',
      relationshipTargetMode: 'auto-increment',
      autoIncrementId: {
        enabled: true,
        columnName: 'id',
        startAt: 1
      },
      sameFileForeignKeyColumnName: ''
    });

    const issues = validateSelectedTablesPreflight([table], 'INSERT');

    expect(issues.some((issue) => issue.code === 'RELATIONSHIP_FK_COLUMN_REQUIRED')).toBe(true);
  });

  it('blocks external relationships with incompatible source column types', () => {
    const parent = createTableFixture({
      id: 'parent',
      sqlTableName: 'notas',
      columns: ['numero_nota', 'serie_nota'],
      primaryKeyColumns: ['numero_nota', 'serie_nota'],
      parentMappings: [
        createMappingFixture('numero_nota', { valueType: 'int' }),
        createMappingFixture('serie_nota', { valueType: 'int' })
      ]
    });

    const child = createTableFixture({
      id: 'child',
      sqlTableName: 'notas_itens',
      columns: ['numero_nota', 'serie_nota', 'descricao'],
      parentMappings: [
        createMappingFixture('numero_nota', { valueType: 'string' }),
        createMappingFixture('serie_nota', { valueType: 'int' }),
        createMappingFixture('descricao', { valueType: 'string' })
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

    const issues = validateSelectedTablesPreflight([parent, child], 'INSERT');

    expect(issues.some((issue) => issue.code === 'RELATIONSHIP_SOURCE_COLUMN_TYPE_MISMATCH')).toBe(true);
  });
});
