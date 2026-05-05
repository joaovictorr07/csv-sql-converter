import { ColumnValueType } from '../types/column-value-type';

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
