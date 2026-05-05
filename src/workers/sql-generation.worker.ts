/// <reference lib="webworker" />

import { buildSql } from '../utils/sql-generation';
import { SqlGenerationRequest, SqlGenerationResponse } from '../types/sql-generation';
import { InvalidTypedValueError, RelationshipSqlGenerationError } from '../utils/sql-generation-errors';

addEventListener('message', ({ data }: MessageEvent<SqlGenerationRequest>) => {
  let response: SqlGenerationResponse;

  try {
    response = {
      ok: true,
      sql: buildSql(data.tables, data.operation, data.locale)
    };
  } catch (error) {
    console.error(error);

    if (error instanceof InvalidTypedValueError) {
      response = {
        ok: false,
        errorCode: 'INVALID_TYPED_VALUE',
        details: error.details
      };
      postMessage(response);
      return;
    }

    if (error instanceof RelationshipSqlGenerationError) {
      response = {
        ok: false,
        errorCode: error.code,
        details: error.details
      };
      postMessage(response);
      return;
    }

    response = {
      ok: false,
      errorCode: 'WORKER_EXECUTION_ERROR'
    };
  }

  postMessage(response);
});
