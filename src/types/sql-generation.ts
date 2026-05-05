import { TableConfig } from '../models/table-config';
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
  | 'UNEXPECTED_GENERATION_ERROR'
  | 'WORKER_RUNTIME_ERROR'
  | 'WORKER_INVALID_RESPONSE'
  | 'WORKER_EXECUTION_ERROR';

export interface SqlGenerationFailure {
  ok: false;
  errorCode: SqlGenerationErrorCode;
}

export type SqlGenerationResponse = SqlGenerationSuccess | SqlGenerationFailure;
