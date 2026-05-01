import { Component, inject } from '@angular/core';
import { LoadingService } from '../services/loading.service';

@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  template: `
    @if (loading.state().active) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="mx-4 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 px-6 py-5 shadow-2xl">
          <div class="flex items-start gap-4">
            <div
              class="mt-0.5 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500"
              aria-hidden="true"
            ></div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-white">{{ loading.state().title }}</p>
              <p class="mt-1 text-sm text-slate-400">{{ loading.state().message }}</p>
            </div>
          </div>
        </div>
      </div>
    }
  `
})
export class AppLoadingOverlayComponent {
  loading = inject(LoadingService);
}
