import { Injectable } from '@angular/core';
import {
  SqlGenerationFailure,
  SqlGenerationErrorCode,
  SqlGenerationRequest,
  SqlGenerationResponse
} from '../types/sql-generation';

export class SqlGenerationError extends Error {
  constructor(public readonly code: SqlGenerationErrorCode) {
    super(code);
  }
}

@Injectable({
  providedIn: 'root'
})
export class SqlGenerationService {
  generate(request: SqlGenerationRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/sql-generation.worker.ts', import.meta.url), {
        type: 'module'
      });

      const cleanup = () => {
        worker.terminate();
      };

      worker.onmessage = ({ data }: MessageEvent<SqlGenerationResponse>) => {
        cleanup();

        if (data.ok) {
          resolve(data.sql);
          return;
        }

        const failure = data as SqlGenerationFailure;
        reject(new SqlGenerationError(failure.errorCode));
      };

      worker.onerror = (event) => {
        cleanup();
        console.error(event.message);
        reject(new SqlGenerationError('WORKER_RUNTIME_ERROR'));
      };

      worker.onmessageerror = () => {
        cleanup();
        reject(new SqlGenerationError('WORKER_INVALID_RESPONSE'));
      };

      worker.postMessage(request);
    });
  }
}
