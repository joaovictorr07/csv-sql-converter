import { Injectable } from '@angular/core';
import { SqlGenerationRequest, SqlGenerationResponse } from '../types/sql-generation';

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

        reject(new Error('error' in data ? data.error : 'SQL generation worker failed.'));
      };

      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || 'SQL generation worker failed.'));
      };

      worker.onmessageerror = () => {
        cleanup();
        reject(new Error('SQL generation worker returned an invalid response.'));
      };

      worker.postMessage(request);
    });
  }
}
