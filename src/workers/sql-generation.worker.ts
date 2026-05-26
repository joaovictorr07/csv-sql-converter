/// <reference lib="webworker" />

import { generateSqlResponse } from '../utils/sql-generation';
import { SqlGenerationRequest, SqlGenerationResponse } from '../types/sql-generation';

addEventListener('message', ({ data }: MessageEvent<SqlGenerationRequest>) => {
  const response: SqlGenerationResponse = generateSqlResponse(data.tables, data.operation, data.locale);
  postMessage(response);
});
