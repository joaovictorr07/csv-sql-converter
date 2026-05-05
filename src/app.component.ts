import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AppLoadingOverlayComponent } from './components/app-loading-overlay.component';
import { TableConfigComponent } from './components/table-config.component';
import { UploadComponent } from './components/upload.component';
import { I18nService } from './services/i18n.service';
import { StoreService } from './services/store.service';
import { Locale } from './types/locale';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, UploadComponent, TableConfigComponent, AppLoadingOverlayComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  i18n = inject(I18nService);
  store = inject(StoreService);
  copied = signal(false);
  locales: Locale[] = [...this.i18n.supportedLocales];

  onFiles(files: FileList) {
    this.store.addFiles(files);
  }

  async onGenerate() {
    await this.store.generate();
  }

  copyToClipboard() {
    if (this.store.isGenerating()) return;

    const sql = this.store.generatedSql();
    navigator.clipboard.writeText(sql).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  setLocale(locale: Locale) {
    this.i18n.setLocale(locale);
  }

  languageLabel(locale: Locale) {
    return this.i18n.t(`languages.${locale}`);
  }
}
