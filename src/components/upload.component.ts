import { Component, inject, output } from '@angular/core';
import { I18nService } from '../services/i18n.service';

@Component({
  selector: 'app-upload',
  standalone: true,
  template: `
    <div
      class="cursor-pointer rounded-xl border-2 border-dashed border-slate-600 p-5 text-center transition-colors hover:border-blue-500 hover:bg-slate-800/50 sm:p-8"
      (click)="fileInput.click()"
      (drop)="onDrop($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
    >
      <input
        #fileInput
        type="file"
        multiple
        accept=".csv"
        class="hidden"
        (change)="onFileSelected($event)"
      >
      <div class="flex flex-col items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-9 w-9 text-slate-400 sm:h-10 sm:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p class="text-sm font-medium text-slate-300 sm:text-base">{{ i18n.t('upload.prompt') }}</p>
        <p class="text-xs text-slate-500">{{ i18n.t('upload.support') }}</p>
      </div>
    </div>
  `
})
export class UploadComponent {
  i18n = inject(I18nService);
  filesUploaded = output<FileList>();

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.filesUploaded.emit(input.files);
      input.value = '';
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.filesUploaded.emit(event.dataTransfer.files);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }
}
