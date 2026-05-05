import { TableConfig } from '../models/table-config';
import { ColumnValueType } from './column-value-type';
import { Locale } from './locale';
import { SqlOperation } from './sql-operation';

export interface SqlGenerationRequest {
  tables: TableConfig[];
  operation: SqlOperation;
  locale: Locale;
}

export interface SqlGenerationSuccess {
  ok: true;
  sql: string;
}

export type SqlGenerationErrorCode =
  | 'INVALID_TYPED_VALUE'
  | 'UNEXPECTED_GENERATION_ERROR'
  | 'WORKER_RUNTIME_ERROR'
  | 'WORKER_INVALID_RESPONSE'
  | 'WORKER_EXECUTION_ERROR';

export interface InvalidTypedValueFailureDetails {
  tableName: string;
  columnOriginal: string;
  columnSqlName: string;
  expectedType: ColumnValueType;
  rawValue: string;
}

export interface SqlGenerationFailure {
  ok: false;
  errorCode: SqlGenerationErrorCode;
  details?: InvalidTypedValueFailureDetails;
}

export type SqlGenerationResponse = SqlGenerationSuccess | SqlGenerationFailure;
