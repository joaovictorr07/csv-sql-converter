/// <reference lib="webworker" />

import { buildSql } from '../utils/sql-generation';
import { SqlGenerationRequest, SqlGenerationResponse } from '../types/sql-generation';

addEventListener('message', ({ data }: MessageEvent<SqlGenerationRequest>) => {
  let response: SqlGenerationResponse;

  try {
    response = {
      ok: true,
      sql: buildSql(data.tables, data.operation)
    };
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected SQL generation error.'
    };
  }

  postMessage(response);
});
