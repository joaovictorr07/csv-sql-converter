import { TableConfig } from '../models/table-config';
import { SqlOperation } from './sql-operation';

export interface SqlGenerationRequest {
  tables: TableConfig[];
  operation: SqlOperation;
}

export interface SqlGenerationSuccess {
  ok: true;
  sql: string;
}

export interface SqlGenerationFailure {
  ok: false;
  error: string;
}

export type SqlGenerationResponse = SqlGenerationSuccess | SqlGenerationFailure;
