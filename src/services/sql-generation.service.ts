import { Injectable } from '@angular/core';
import { SqlGenerationRequest, SqlGenerationResponse } from '../types/sql-generation';

export type SqlGenerationServiceErrorCode =
  | 'UNEXPECTED_GENERATION_ERROR'
  | 'WORKER_RUNTIME_ERROR'
  | 'WORKER_INVALID_RESPONSE';

export class SqlGenerationServiceError extends Error {
  constructor(public readonly code: SqlGenerationServiceErrorCode) {
    super(code);
  }
}

@Injectable({
  providedIn: 'root'
})
export class SqlGenerationService {
  generate(request: SqlGenerationRequest): Promise<SqlGenerationResponse> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/sql-generation.worker.ts', import.meta.url), {
        type: 'module'
      });

      const cleanup = () => {
        worker.terminate();
      };

      worker.onmessage = ({ data }: MessageEvent<SqlGenerationResponse>) => {
        cleanup();
        resolve(data);
      };

      worker.onerror = (event) => {
        cleanup();
        console.error(event.message);
        reject(new SqlGenerationServiceError('WORKER_RUNTIME_ERROR'));
      };

      worker.onmessageerror = () => {
        cleanup();
        reject(new SqlGenerationServiceError('WORKER_INVALID_RESPONSE'));
      };

      worker.postMessage(request);
    });
  }
}
