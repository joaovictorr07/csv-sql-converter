import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ColumnMapping } from '../models/column-mapping';
import { TableConfig } from '../models/table-config';
import { I18nService } from '../services/i18n.service';
import { StoreService } from '../services/store.service';
import { BooleanMode } from '../types/boolean-mode';

@Component({
  selector: 'app-table-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-sm transition-all sm:p-4">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-center gap-3">
          <input
            type="checkbox"
            [checked]="config().selected"
            (change)="toggleSelection($event)"
            class="h-5 w-5 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
          >
          <div class="flex flex-col">
             <h3 class="text-lg font-semibold text-white">{{ config().name }}</h3>
             <div class="flex items-center gap-2">
               <span class="text-xs text-slate-500">{{ i18n.t('tableConfig.rows', { count: config().data.length }) }}</span>
               <span class="rounded bg-slate-700 px-1 text-xs text-slate-400">{{ i18n.t('tableConfig.columns', { count: config().columns.length }) }}</span>
             </div>
          </div>
        </div>
        <button (click)="remove.emit(config().id)" class="self-end text-sm text-red-400 hover:text-red-300 sm:self-auto">
          {{ i18n.t('tableConfig.remove') }}
        </button>
      </div>

      <div class="mb-4 rounded border border-slate-700/50 bg-slate-900/50 p-3">
        <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{{ i18n.t('tableConfig.parsingSettings') }}</h4>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs text-slate-500">{{ i18n.t('tableConfig.delimiter') }}</label>
            <select
              [ngModel]="config().delimiter"
              (ngModelChange)="updateDelimiter($event)"
              class="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
            >
              <option value=",">{{ i18n.t('tableConfig.delimiters.comma') }}</option>
              <option value=";">{{ i18n.t('tableConfig.delimiters.semicolon') }}</option>
              <option value="|">{{ i18n.t('tableConfig.delimiters.pipe') }}</option>
              <option value="TAB">{{ i18n.t('tableConfig.delimiters.tab') }}</option>
            </select>
            <p class="mt-1 text-[10px] text-slate-600">{{ i18n.t('tableConfig.delimiterReparseHint') }}</p>
          </div>
          <div>
            <label class="mb-1 block text-xs text-slate-500">{{ i18n.t('tableConfig.booleanHandling') }}</label>
            <select
              [ngModel]="config().booleanMode"
              (ngModelChange)="updateBoolMode($event)"
              class="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
            >
              <option value="AS_IS">{{ i18n.t('tableConfig.booleanOptions.AS_IS') }}</option>
              <option value="TRUE_FALSE">{{ i18n.t('tableConfig.booleanOptions.TRUE_FALSE') }}</option>
              <option value="BIT">{{ i18n.t('tableConfig.booleanOptions.BIT') }}</option>
              <option value="STRING">{{ i18n.t('tableConfig.booleanOptions.STRING') }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.sqlTableName') }}</label>
          <input
            type="text"
            [ngModel]="config().sqlTableName"
            (ngModelChange)="updateSqlName($event)"
            class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
          >
        </div>

        <div>
          <label class="mb-1 block text-xs text-slate-400">
            {{ config().hasChildInSameFile ? i18n.t('tableConfig.primaryKeyGrouping') : i18n.t('tableConfig.primaryKeyPk') }}
          </label>
          <select
            [ngModel]="config().primaryKey"
            (ngModelChange)="updatePk($event)"
            class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
          >
            <option [value]="null">{{ i18n.t('tableConfig.selectColumn') }}</option>
            @for (col of config().columns; track col) {
              <option [value]="col">{{ col }}</option>
            }
          </select>
        </div>
      </div>

      <div class="mb-4 overflow-hidden rounded-lg border border-slate-700">
        <button
          class="flex w-full items-center justify-between bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
          (click)="toggleParentCols()"
        >
          <span>{{ i18n.t('tableConfig.parentColumnMapping') }}</span>
          <span class="text-xs">{{ i18n.t('tableConfig.columnMappingSelected', { count: countIncluded(config().parentMappings) }) }}</span>
        </button>

        @if (showParentCols()) {
          <div class="custom-scrollbar max-h-60 overflow-x-auto overflow-y-auto bg-slate-900/50 p-3 sm:max-h-72">
            <div class="mb-2 grid min-w-[540px] grid-cols-12 gap-2 px-1 text-xs text-slate-500">
              <div class="col-span-1 text-center">{{ i18n.t('tableConfig.include') }}</div>
              <div class="col-span-5">{{ i18n.t('tableConfig.csvHeader') }}</div>
              <div class="col-span-6">{{ i18n.t('tableConfig.sqlColumn') }}</div>
            </div>
            @for (map of config().parentMappings; track map.original) {
              <div class="mb-2 grid min-w-[540px] grid-cols-12 items-center gap-2">
                <div class="col-span-1 flex justify-center">
                  <input
                    type="checkbox"
                    [checked]="map.include"
                    (change)="updateParentMap(map.original, { include: $any($event.target).checked })"
                    class="rounded border-slate-600 bg-slate-800 text-blue-500"
                  >
                </div>
                <div class="col-span-5 truncate font-mono text-xs text-slate-300" title="{{ map.original }}">
                  {{ map.original }}
                </div>
                <div class="col-span-6">
                  <input
                    type="text"
                    [ngModel]="map.sqlName"
                    (change)="updateParentMap(map.original, { sqlName: $any($event.target).value })"
                    class="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                  >
                </div>
              </div>
            }
          </div>
        }
      </div>

      <div class="mb-4">
         <label class="flex cursor-pointer items-center gap-2">
           <input
             type="checkbox"
             [checked]="config().hasChildInSameFile"
             (change)="updateHasChild($event)"
             class="rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
           >
           <span class="text-sm font-medium text-slate-300">{{ i18n.t('tableConfig.hasChildInSameFile') }}</span>
         </label>
      </div>

      @if (config().hasChildInSameFile) {
        <div class="animate-in slide-in-from-top-2 mt-3 border-l-2 border-purple-500/30 pl-3 fade-in sm:ml-4 sm:pl-4">
           <h4 class="mb-3 text-sm font-semibold text-purple-300">{{ i18n.t('tableConfig.childTableSettings') }}</h4>

           <div class="mb-4">
            <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.childSqlTableName') }}</label>
            <input
              type="text"
              [ngModel]="config().childSqlTableName"
              (ngModelChange)="updateChildName($event)"
              class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-purple-500"
            >
           </div>

            <div class="overflow-hidden rounded-lg border border-slate-700">
              <button
                class="flex w-full items-center justify-between bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
                (click)="toggleChildCols()"
              >
                <span>{{ i18n.t('tableConfig.childColumnMapping') }}</span>
                <span class="text-xs">{{ i18n.t('tableConfig.columnMappingSelected', { count: countIncluded(config().childMappings) }) }}</span>
              </button>

              @if (showChildCols()) {
                <div class="custom-scrollbar max-h-60 overflow-x-auto overflow-y-auto bg-slate-900/50 p-3 sm:max-h-72">
                  <div class="mb-2 grid min-w-[540px] grid-cols-12 gap-2 px-1 text-xs text-slate-500">
                    <div class="col-span-1 text-center">{{ i18n.t('tableConfig.include') }}</div>
                    <div class="col-span-5">{{ i18n.t('tableConfig.csvHeader') }}</div>
                    <div class="col-span-6">{{ i18n.t('tableConfig.sqlColumn') }}</div>
                  </div>
                  @for (map of config().childMappings; track map.original) {
                    <div class="mb-2 grid min-w-[540px] grid-cols-12 items-center gap-2">
                      <div class="col-span-1 flex justify-center">
                        <input
                          type="checkbox"
                          [checked]="map.include"
                          (change)="updateChildMap(map.original, { include: $any($event.target).checked })"
                          class="rounded border-slate-600 bg-slate-800 text-purple-500"
                        >
                      </div>
                      <div class="col-span-5 truncate font-mono text-xs text-slate-300" title="{{ map.original }}">
                        {{ map.original }}
                      </div>
                      <div class="col-span-6">
                        <input
                          type="text"
                          [ngModel]="map.sqlName"
                          (change)="updateChildMap(map.original, { sqlName: $any($event.target).value })"
                          class="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                        >
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
        </div>
      } @else {
        <div class="mt-4 grid grid-cols-1 gap-4 border-t border-slate-700/50 pt-4 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.parentTableDifferentFile') }}</label>
            <select
              [ngModel]="config().externalParentTableId"
              (ngModelChange)="updateExternalParent($event)"
              class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
            >
              <option [value]="null">{{ i18n.t('tableConfig.noExternalParent') }}</option>
              @for (opt of tableOptions(); track opt.id) {
                @if (opt.id !== config().id) {
                  <option [value]="opt.id">{{ opt.name }}</option>
                }
              }
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.foreignKeyThisFile') }}</label>
            <select
              [ngModel]="config().externalForeignKey"
              (ngModelChange)="updateExternalFk($event)"
              [disabled]="!config().externalParentTableId"
              class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option [value]="null">{{ i18n.t('tableConfig.selectForeignKey') }}</option>
              @for (col of config().columns; track col) {
                <option [value]="col">{{ col }}</option>
              }
            </select>
          </div>
        </div>
      }
    </div>
  `
})
export class TableConfigComponent {
  config = input.required<TableConfig>();
  tableOptions = input.required<{ id: string; name: string }[]>();

  remove = output<string>();

  i18n = inject(I18nService);
  store = inject(StoreService);

  showParentCols = signal(false);
  showChildCols = signal(false);

  toggleParentCols() {
    this.showParentCols.update((value) => !value);
  }

  toggleChildCols() {
    this.showChildCols.update((value) => !value);
  }

  toggleSelection(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.store.updateTable(this.config().id, { selected: checked });
  }

  updateDelimiter(value: string) {
    this.store.reparseTable(this.config().id, value);
  }

  updateBoolMode(value: BooleanMode) {
    this.store.updateTable(this.config().id, { booleanMode: value });
  }

  updateSqlName(value: string) {
    this.store.updateTable(this.config().id, { sqlTableName: value });
  }

  updatePk(value: string | null) {
    this.store.updateTable(this.config().id, { primaryKey: value });
  }

  updateHasChild(event: Event) {
    this.store.updateTable(this.config().id, {
      hasChildInSameFile: (event.target as HTMLInputElement).checked
    });
  }

  updateChildName(value: string) {
    this.store.updateTable(this.config().id, { childSqlTableName: value });
  }

  updateExternalParent(value: string | null) {
    this.store.updateTable(this.config().id, { externalParentTableId: value });
  }

  updateExternalFk(value: string | null) {
    this.store.updateTable(this.config().id, { externalForeignKey: value });
  }

  updateParentMap(original: string, changes: Partial<ColumnMapping>) {
    this.store.updateParentMapping(this.config().id, original, changes);
  }

  updateChildMap(original: string, changes: Partial<ColumnMapping>) {
    this.store.updateChildMapping(this.config().id, original, changes);
  }

  countIncluded(mappings: ColumnMapping[]) {
    return mappings.filter((mapping) => mapping.include).length;
  }
}
