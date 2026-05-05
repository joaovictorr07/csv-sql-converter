import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ColumnMapping } from '../models/column-mapping';
import {
  AutoIncrementIdConfig,
  ExternalRelationshipSourceMapping,
  ForeignKeySqlColumnConfig,
  RelationshipTargetMode,
  TableConfig
} from '../models/table-config';
import { I18nService } from '../services/i18n.service';
import { StoreService } from '../services/store.service';
import { BooleanMode } from '../types/boolean-mode';
import { ColumnValueType } from '../types/column-value-type';

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
          <div class="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
            <p class="mb-2 text-xs text-slate-500">{{ i18n.t('tableConfig.primaryKeyHint') }}</p>
            <div class="custom-scrollbar max-h-40 space-y-2 overflow-y-auto pr-1">
              @for (col of config().columns; track col) {
                <label class="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    [checked]="isPrimaryKeySelected(col)"
                    (change)="togglePk(col, $any($event.target).checked)"
                    class="rounded border-slate-600 bg-slate-800 text-blue-500"
                  >
                  <span class="truncate">{{ col }}</span>
                </label>
              }
            </div>
          </div>
        </div>
      </div>

      <div class="mb-4 rounded border border-slate-700/50 bg-slate-900/50 p-3">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {{ i18n.t('tableConfig.autoIncrementId.title') }}
            </h4>
            <p class="mt-1 text-[10px] text-slate-500">{{ i18n.t('tableConfig.autoIncrementId.hint') }}</p>
          </div>
          <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              [checked]="config().autoIncrementId.enabled"
              (change)="updateAutoIncrementEnabled($event)"
              class="rounded border-slate-600 bg-slate-800 text-blue-500"
            >
            <span>{{ i18n.t('tableConfig.autoIncrementId.enabled') }}</span>
          </label>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.autoIncrementId.columnName') }}</label>
            <input
              type="text"
              [ngModel]="config().autoIncrementId.columnName"
              (ngModelChange)="updateAutoIncrementColumnName($event)"
              [disabled]="!config().autoIncrementId.enabled"
              class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
          </div>

          <div>
            <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.autoIncrementId.startAt') }}</label>
            <input
              type="number"
              step="1"
              [ngModel]="config().autoIncrementId.startAt"
              (change)="updateAutoIncrementStartAt($event)"
              [disabled]="!config().autoIncrementId.enabled"
              class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
          </div>
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
            <div class="mb-2 grid min-w-[500px] grid-cols-12 gap-2 px-1 text-xs text-slate-500">
              <div class="col-span-1 text-center">{{ i18n.t('tableConfig.include') }}</div>
              <div class="col-span-4">{{ i18n.t('tableConfig.csvHeader') }}</div>
              <div class="col-span-4">{{ i18n.t('tableConfig.sqlColumn') }}</div>
              <div class="col-span-3">{{ i18n.t('tableConfig.valueType') }}</div>
            </div>
            @for (map of config().parentMappings; track map.original) {
              <div class="mb-2 grid min-w-[500px] grid-cols-12 items-center gap-2">
                <div class="col-span-1 flex justify-center">
                  <input
                    type="checkbox"
                    [checked]="map.include"
                    [disabled]="isPrimaryKeySelected(map.original)"
                    (change)="updateParentMap(map.original, { include: $any($event.target).checked })"
                    class="rounded border-slate-600 bg-slate-800 text-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                </div>
                <div class="col-span-4 truncate font-mono text-xs text-slate-300" title="{{ map.original }}">
                  {{ map.original }}
                </div>
                <div class="col-span-4">
                  <input
                    type="text"
                    [ngModel]="map.sqlName"
                    (change)="updateParentMap(map.original, { sqlName: $any($event.target).value })"
                    class="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                  >
                </div>
                <div class="col-span-3">
                  <select
                    [ngModel]="map.valueType"
                    (ngModelChange)="updateParentType(map.original, $event)"
                    class="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                  >
                    @for (valueType of valueTypes; track valueType) {
                      <option [value]="valueType">{{ i18n.t('tableConfig.valueTypes.' + valueType) }}</option>
                    }
                  </select>
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

          <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.childSqlTableName') }}</label>
              <input
                type="text"
                [ngModel]="config().childSqlTableName"
                (ngModelChange)="updateChildName($event)"
                class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-purple-500"
              >
            </div>

            <div>
              <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.relationshipTargetMode') }}</label>
              <select
                [ngModel]="config().relationshipTargetMode"
                (ngModelChange)="updateRelationshipTargetMode($event)"
                class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-purple-500"
              >
                <option value="auto-increment">{{ i18n.t('tableConfig.relationshipTargetModes.auto-increment') }}</option>
                <option value="selected-pk">{{ i18n.t('tableConfig.relationshipTargetModes.selected-pk') }}</option>
              </select>
            </div>
          </div>

          @if (config().relationshipTargetMode === 'auto-increment') {
            <div class="mb-4">
              <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.foreignKeySqlColumn') }}</label>
              <input
                type="text"
                [ngModel]="config().sameFileForeignKeyColumnName"
                (ngModelChange)="updateSameFileForeignKeyColumnName($event)"
                class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-purple-500"
              >
            </div>
          } @else {
            <div class="mb-4 overflow-hidden rounded-lg border border-slate-700">
              <div class="bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-300">
                {{ i18n.t('tableConfig.childForeignKeyColumns') }}
              </div>
              <div class="space-y-2 bg-slate-900/50 p-3">
                @for (fkConfig of config().sameFileSelectedPkForeignKeys; track fkConfig.parentColumn) {
                  <div class="grid gap-2 md:grid-cols-2">
                    <div class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">
                      <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ i18n.t('tableConfig.parentPkColumn') }}</div>
                      <div class="mt-1 font-mono">{{ fkConfig.parentColumn }}</div>
                    </div>
                    <div>
                      <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.foreignKeySqlColumn') }}</label>
                      <input
                        type="text"
                        [ngModel]="fkConfig.fkColumnName"
                        (ngModelChange)="updateSameFileSelectedPkForeignKey(fkConfig.parentColumn, $event)"
                        class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-purple-500"
                      >
                    </div>
                  </div>
                }
              </div>
            </div>
          }

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
                <div class="mb-2 grid min-w-[500px] grid-cols-12 gap-2 px-1 text-xs text-slate-500">
                  <div class="col-span-1 text-center">{{ i18n.t('tableConfig.include') }}</div>
                  <div class="col-span-4">{{ i18n.t('tableConfig.csvHeader') }}</div>
                  <div class="col-span-4">{{ i18n.t('tableConfig.sqlColumn') }}</div>
                  <div class="col-span-3">{{ i18n.t('tableConfig.valueType') }}</div>
                </div>
                @for (map of config().childMappings; track map.original) {
                  <div class="mb-2 grid min-w-[500px] grid-cols-12 items-center gap-2">
                    <div class="col-span-1 flex justify-center">
                      <input
                        type="checkbox"
                        [checked]="map.include"
                        (change)="updateChildMap(map.original, { include: $any($event.target).checked })"
                        class="rounded border-slate-600 bg-slate-800 text-purple-500"
                      >
                    </div>
                    <div class="col-span-4 truncate font-mono text-xs text-slate-300" title="{{ map.original }}">
                      {{ map.original }}
                    </div>
                    <div class="col-span-4">
                      <input
                        type="text"
                        [ngModel]="map.sqlName"
                        (change)="updateChildMap(map.original, { sqlName: $any($event.target).value })"
                        class="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                      >
                    </div>
                    <div class="col-span-3">
                      <select
                        [ngModel]="map.valueType"
                        (ngModelChange)="updateChildType(map.original, $event)"
                        class="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                      >
                        @for (valueType of valueTypes; track valueType) {
                          <option [value]="valueType">{{ i18n.t('tableConfig.valueTypes.' + valueType) }}</option>
                        }
                      </select>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="mt-4 space-y-4 border-t border-slate-700/50 pt-4">
          <div>
            <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.parentTableDifferentFile') }}</label>
            <select
              [ngModel]="config().externalParentTableId"
              (ngModelChange)="updateExternalParent($event)"
              class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
            >
              <option [ngValue]="null">{{ i18n.t('tableConfig.noExternalParent') }}</option>
              @for (opt of tableOptions(); track opt.id) {
                @if (opt.id !== config().id) {
                  <option [ngValue]="opt.id">{{ opt.name }}</option>
                }
              }
            </select>
          </div>

          @if (externalParentTable()) {
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.relationshipTargetMode') }}</label>
                <select
                  [ngModel]="config().relationshipTargetMode"
                  (ngModelChange)="updateRelationshipTargetMode($event)"
                  class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                >
                  <option value="auto-increment">{{ i18n.t('tableConfig.relationshipTargetModes.auto-increment') }}</option>
                  <option value="selected-pk">{{ i18n.t('tableConfig.relationshipTargetModes.selected-pk') }}</option>
                </select>
              </div>
            </div>

            <div class="overflow-hidden rounded-lg border border-slate-700">
              <div class="bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-300">
                {{ i18n.t('tableConfig.externalRelationshipMapping') }}
              </div>
              <div class="space-y-2 bg-slate-900/50 p-3">
                @for (mapping of config().externalRelationshipSourceMappings; track mapping.parentColumn) {
                  <div class="grid gap-2 md:grid-cols-2">
                    <div class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">
                      <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ i18n.t('tableConfig.parentPkColumn') }}</div>
                      <div class="mt-1 font-mono">{{ mapping.parentColumn }}</div>
                    </div>
                    <div>
                      <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.childSourceColumn') }}</label>
                      <select
                        [ngModel]="mapping.childColumn"
                        (ngModelChange)="updateExternalSourceMapping(mapping.parentColumn, $event)"
                        class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                      >
                        <option [ngValue]="null">{{ i18n.t('tableConfig.selectForeignKey') }}</option>
                        @for (col of config().columns; track col) {
                          <option [ngValue]="col">{{ col }}</option>
                        }
                      </select>
                    </div>
                  </div>
                }
              </div>
            </div>

            @if (config().relationshipTargetMode === 'auto-increment') {
              <div>
                <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.foreignKeySqlColumn') }}</label>
                <input
                  type="text"
                  [ngModel]="config().externalForeignKeyColumnName"
                  (ngModelChange)="updateExternalForeignKeyColumnName($event)"
                  class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                >
              </div>
            } @else {
              <div class="overflow-hidden rounded-lg border border-slate-700">
                <div class="bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-300">
                  {{ i18n.t('tableConfig.childForeignKeyColumns') }}
                </div>
                <div class="space-y-2 bg-slate-900/50 p-3">
                  @for (fkConfig of config().externalSelectedPkForeignKeys; track fkConfig.parentColumn) {
                    <div class="grid gap-2 md:grid-cols-2">
                      <div class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">
                        <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ i18n.t('tableConfig.parentPkColumn') }}</div>
                        <div class="mt-1 font-mono">{{ fkConfig.parentColumn }}</div>
                      </div>
                      <div>
                        <label class="mb-1 block text-xs text-slate-400">{{ i18n.t('tableConfig.foreignKeySqlColumn') }}</label>
                        <input
                          type="text"
                          [ngModel]="fkConfig.fkColumnName"
                          (ngModelChange)="updateExternalSelectedPkForeignKey(fkConfig.parentColumn, $event)"
                          class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                        >
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          }
        </div>
      }
    </div>
  `
})
export class TableConfigComponent {
  config = input.required<TableConfig>();
  tableOptions = input.required<{ id: string; name: string }[]>();
  valueTypes: ColumnValueType[] = ['string', 'int', 'decimal', 'bool'];

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
    this.store.updateSqlTableName(this.config().id, value);
  }

  updateAutoIncrementEnabled(event: Event) {
    this.updateAutoIncrementId({
      enabled: (event.target as HTMLInputElement).checked
    });
  }

  updateAutoIncrementColumnName(value: string) {
    this.updateAutoIncrementId({ columnName: value });
  }

  updateAutoIncrementStartAt(event: Event) {
    const rawValue = (event.target as HTMLInputElement).value;
    this.updateAutoIncrementId({ startAt: rawValue === '' ? Number.NaN : Number(rawValue) });
  }

  togglePk(column: string, checked: boolean) {
    const current = this.config().primaryKeyColumns;
    const next = checked ? [...current, column] : current.filter((entry) => entry !== column);
    this.store.updatePrimaryKeyColumns(this.config().id, next);
  }

  isPrimaryKeySelected(column: string) {
    return this.config().primaryKeyColumns.includes(column);
  }

  updateHasChild(event: Event) {
    this.store.updateTable(this.config().id, {
      hasChildInSameFile: (event.target as HTMLInputElement).checked
    });
  }

  updateChildName(value: string) {
    this.store.updateChildSqlTableName(this.config().id, value);
  }

  updateRelationshipTargetMode(value: RelationshipTargetMode) {
    this.store.updateRelationshipTargetMode(this.config().id, value);
  }

  updateSameFileForeignKeyColumnName(value: string) {
    this.store.updateSameFileForeignKeyColumnName(this.config().id, value);
  }

  updateSameFileSelectedPkForeignKey(parentColumn: string, value: string) {
    this.store.updateSameFileSelectedPkForeignKey(this.config().id, parentColumn, value);
  }

  updateExternalParent(value: string | null) {
    this.store.updateTable(this.config().id, { externalParentTableId: value });
  }

  updateExternalSourceMapping(parentColumn: string, childColumn: string | null) {
    this.store.updateExternalSourceMapping(this.config().id, parentColumn, childColumn);
  }

  updateExternalForeignKeyColumnName(value: string) {
    this.store.updateExternalForeignKeyColumnName(this.config().id, value);
  }

  updateExternalSelectedPkForeignKey(parentColumn: string, value: string) {
    this.store.updateExternalSelectedPkForeignKey(this.config().id, parentColumn, value);
  }

  updateParentMap(original: string, changes: Partial<ColumnMapping>) {
    if (changes.sqlName !== undefined && Object.keys(changes).length === 1) {
      this.store.updateParentMappingSqlName(this.config().id, original, changes.sqlName);
      return;
    }

    this.store.updateParentMapping(this.config().id, original, changes);
  }

  updateParentType(original: string, valueType: ColumnValueType) {
    this.store.updateParentMapping(this.config().id, original, { valueType });
  }

  updateChildMap(original: string, changes: Partial<ColumnMapping>) {
    if (changes.sqlName !== undefined && Object.keys(changes).length === 1) {
      this.store.updateChildMappingSqlName(this.config().id, original, changes.sqlName);
      return;
    }

    this.store.updateChildMapping(this.config().id, original, changes);
  }

  updateChildType(original: string, valueType: ColumnValueType) {
    this.store.updateChildMapping(this.config().id, original, { valueType });
  }

  externalParentTable(): TableConfig | null {
    return this.store.tables().find((table) => table.id === this.config().externalParentTableId) ?? null;
  }

  countIncluded(mappings: ColumnMapping[]) {
    return mappings.filter((mapping) => mapping.include).length;
  }

  private updateAutoIncrementId(changes: Partial<AutoIncrementIdConfig>) {
    this.store.updateAutoIncrementId(this.config().id, changes);
  }
}
