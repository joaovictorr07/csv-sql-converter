import { TableConfig } from '../models/table-config';
import { Locale } from './locale';
import { SqlOperation } from './sql-operation';

export type ValidationIssueSeverity = 'error' | 'warning';
export type ValidationIssuePhase = 'preflight' | 'generation';

export type ValidationIssueCode =
  | 'EMPTY_TABLE_NAME'
  | 'EMPTY_COLUMN_NAME'
  | 'DUPLICATE_SQL_IDENTIFIER'
  | 'AUTO_INCREMENT_ID_COLUMN_REQUIRED'
  | 'AUTO_INCREMENT_ID_START_AT_INVALID'
  | 'INSERT_NO_COLUMNS_SELECTED'
  | 'UPDATE_PRIMARY_KEY_REQUIRED'
  | 'DELETE_PRIMARY_KEY_REQUIRED'
  | 'UPDATE_NO_COLUMNS_TO_UPDATE'
  | 'RELATIONSHIP_PARENT_PK_REQUIRED'
  | 'RELATIONSHIP_AUTO_INCREMENT_REQUIRED'
  | 'RELATIONSHIP_MAPPING_INCOMPLETE'
  | 'RELATIONSHIP_FK_IDENTIFIER_CONFLICT'
  | 'RELATIONSHIP_FK_COLUMN_REQUIRED'
  | 'RELATIONSHIP_EXTERNAL_PARENT_NOT_FOUND'
  | 'RELATIONSHIP_SOURCE_COLUMN_REQUIRED'
  | 'RELATIONSHIP_SOURCE_COLUMN_TYPE_MISMATCH'
  | 'RELATIONSHIP_COLUMN_COUNT_MISMATCH'
  | 'RELATIONSHIP_ROW_KEY_INCOMPLETE'
  | 'RELATIONSHIP_PARENT_ROW_NOT_FOUND'
  | 'INVALID_TYPED_VALUE'
  | 'VALUE_LOSES_LEADING_ZERO'
  | 'VALIDATION_ISSUE_LIMIT_REACHED';

export interface ValidationIssue {
  severity: ValidationIssueSeverity;
  phase: ValidationIssuePhase;
  code: ValidationIssueCode;
  tableId?: string;
  fileName?: string;
  tableName?: string;
  parentTableName?: string;
  childTableName?: string;
  columnOriginal?: string;
  columnSqlName?: string;
  fkColumnName?: string;
  csvLineNumber?: number;
  rawValue?: string;
  params: Record<string, string | number>;
}

export interface SqlGenerationRequest {
  tables: TableConfig[];
  operation: SqlOperation;
  locale: Locale;
}

export interface SqlGenerationSuccess {
  ok: true;
  sql: string;
  issues: ValidationIssue[];
}

export interface SqlGenerationFailure {
  ok: false;
  issues: ValidationIssue[];
}

export type SqlGenerationResponse = SqlGenerationSuccess | SqlGenerationFailure;
