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
  | 'RELATIONSHIP_PARENT_PK_REQUIRED'
  | 'RELATIONSHIP_AUTO_INCREMENT_REQUIRED'
  | 'RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND'
  | 'RELATIONSHIP_MAPPING_INCOMPLETE'
  | 'RELATIONSHIP_ROW_KEY_INCOMPLETE'
  | 'RELATIONSHIP_PARENT_ROW_NOT_FOUND'
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

export interface RelationshipFailureDetails {
  childTableName: string;
  parentTableName: string;
  fkColumnName?: string;
  logicalKey?: string;
}

export interface SqlGenerationFailure {
  ok: false;
  errorCode: SqlGenerationErrorCode;
  details?: InvalidTypedValueFailureDetails | RelationshipFailureDetails;
}

export type SqlGenerationResponse = SqlGenerationSuccess | SqlGenerationFailure;
