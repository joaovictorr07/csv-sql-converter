/// <reference lib="webworker" />

import { buildSql } from '../utils/sql-generation';
import { SqlGenerationRequest, SqlGenerationResponse } from '../types/sql-generation';

addEventListener('message', ({ data }: MessageEvent<SqlGenerationRequest>) => {
  let response: SqlGenerationResponse;

  try {
    response = {
      ok: true,
      sql: buildSql(data.tables, data.operation, data.locale)
    };
  } catch (error) {
    console.error(error);
    response = {
      ok: false,
      errorCode: 'WORKER_EXECUTION_ERROR'
    };
  }

  postMessage(response);
});
