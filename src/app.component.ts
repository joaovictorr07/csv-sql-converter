import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UploadComponent } from './components/upload.component';
import { TableConfigComponent } from './components/table-config.component';
import { StoreService } from './services/store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, UploadComponent, TableConfigComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  store = inject(StoreService);
  copied = signal(false);

  onFiles(files: FileList) {
    this.store.addFiles(files);
  }

  copyToClipboard() {
    const sql = this.store.generatedSql();
    navigator.clipboard.writeText(sql).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}