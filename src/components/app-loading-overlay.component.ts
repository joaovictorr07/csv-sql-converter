import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../services/i18n.service';
import { LoadingService } from '../services/loading.service';

@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading.state().active) {
      <div
        class="loading-backdrop"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="loading-panel">
          <div class="flex items-start gap-4">
            <div
              class="mt-0.5 h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600"
              aria-hidden="true"
            ></div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-slate-900">{{ i18n.t(loading.state().titleKey) }}</p>
              <p class="mt-1 text-sm text-slate-600">{{ i18n.t(loading.state().messageKey) }}</p>
            </div>
          </div>
        </div>
      </div>
    }
  `
})
export class AppLoadingOverlayComponent {
  i18n = inject(I18nService);
  loading = inject(LoadingService);
}
