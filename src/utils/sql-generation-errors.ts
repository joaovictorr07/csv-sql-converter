import { ColumnValueType } from '../types/column-value-type';
import { RelationshipFailureDetails, SqlGenerationErrorCode } from '../types/sql-generation';

export interface InvalidTypedValueDetails {
  tableName: string;
  columnOriginal: string;
  columnSqlName: string;
  expectedType: ColumnValueType;
  rawValue: string;
}

export class InvalidTypedValueError extends Error {
  constructor(public readonly details: InvalidTypedValueDetails) {
    super('INVALID_TYPED_VALUE');
  }
}

export class RelationshipSqlGenerationError extends Error {
  constructor(
    public readonly code:
      | 'RELATIONSHIP_PARENT_PK_REQUIRED'
      | 'RELATIONSHIP_AUTO_INCREMENT_REQUIRED'
      | 'RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND'
      | 'RELATIONSHIP_MAPPING_INCOMPLETE'
      | 'RELATIONSHIP_ROW_KEY_INCOMPLETE'
      | 'RELATIONSHIP_PARENT_ROW_NOT_FOUND',
    public readonly details: RelationshipFailureDetails
  ) {
    super(code);
  }
}
