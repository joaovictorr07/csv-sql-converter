import { Component, input, output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableConfig, StoreService, ColumnMapping, BooleanMode } from '../services/store.service';

@Component({
  selector: 'app-table-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-slate-800 rounded-lg border border-slate-700 p-4 shadow-sm mb-4 transition-all">
      <!-- Header / Top Bar -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <input 
            type="checkbox" 
            [checked]="config().selected"
            (change)="toggleSelection($event)"
            class="w-5 h-5 rounded border-slate-600 text-blue-500 focus:ring-blue-500 bg-slate-700"
          >
          <div class="flex flex-col">
             <h3 class="text-lg font-semibold text-white">{{ config().name }}</h3>
             <div class="flex items-center gap-2">
               <span class="text-xs text-slate-500">{{ config().data.length }} rows</span>
               <span class="text-xs bg-slate-700 text-slate-400 px-1 rounded">{{ config().columns.length }} columns</span>
             </div>
          </div>
        </div>
        <button (click)="remove.emit(config().id)" class="text-red-400 hover:text-red-300 text-sm">
          Remove
        </button>
      </div>

      <!-- Parsing Settings (New) -->
      <div class="bg-slate-900/50 p-3 rounded mb-4 border border-slate-700/50">
        <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">CSV Parsing & Value Settings</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-slate-500 mb-1">Delimiter</label>
            <select 
              [ngModel]="config().delimiter" 
              (ngModelChange)="updateDelimiter($event)"
              class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:border-blue-500 outline-none">
              <option value=",">Comma (,)</option>
              <option value=";">Semicolon (;)</option>
              <option value="|">Pipe (|)</option>
              <option value="TAB">Tab (\\t)</option>
            </select>
            <p class="text-[10px] text-slate-600 mt-1">Changing this re-parses the file.</p>
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">Boolean (0/1) Handling</label>
            <select 
              [ngModel]="config().booleanMode" 
              (ngModelChange)="updateBoolMode($event)"
              class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:border-blue-500 outline-none">
              <option value="AS_IS">As Is (0 or 1)</option>
              <option value="TRUE_FALSE">SQL Boolean (FALSE/TRUE)</option>
              <option value="BIT">Numeric (0/1)</option>
              <option value="STRING">String ('0'/'1')</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Main Config Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <!-- SQL Table Name -->
        <div>
          <label class="block text-xs text-slate-400 mb-1">SQL Table Name</label>
          <input 
            type="text" 
            [ngModel]="config().sqlTableName"
            (ngModelChange)="updateSqlName($event)"
            class="w-full bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none"
          >
        </div>

        <!-- Primary Key (Grouping Key) -->
        <div>
          <label class="block text-xs text-slate-400 mb-1">
            Primary Key ({{ config().hasChildInSameFile ? 'Grouping Key' : 'PK' }})
          </label>
          <select 
            [ngModel]="config().primaryKey"
            (ngModelChange)="updatePk($event)"
            class="w-full bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none">
            <option [value]="null">-- Select Column --</option>
            @for (col of config().columns; track col) {
              <option [value]="col">{{ col }}</option>
            }
          </select>
        </div>
      </div>

      <!-- Column Mapping Panel (Parent) -->
      <div class="border border-slate-700 rounded-lg overflow-hidden mb-4">
        <button 
          class="w-full px-4 py-2 bg-slate-700/50 hover:bg-slate-700 flex items-center justify-between text-sm font-medium text-slate-300"
          (click)="toggleParentCols()"
        >
          <span>Column Mapping (Parent)</span>
          <span class="text-xs">{{ countIncluded(config().parentMappings) }} selected</span>
        </button>
        
        @if (showParentCols()) {
          <div class="p-3 bg-slate-900/50 max-h-60 overflow-y-auto custom-scrollbar">
            <div class="grid grid-cols-12 gap-2 text-xs text-slate-500 mb-2 px-1">
              <div class="col-span-1 text-center">Inc.</div>
              <div class="col-span-5">CSV Header</div>
              <div class="col-span-6">SQL Column</div>
            </div>
            @for (map of config().parentMappings; track map.original) {
              <div class="grid grid-cols-12 gap-2 items-center mb-2">
                <div class="col-span-1 flex justify-center">
                  <input 
                    type="checkbox" 
                    [checked]="map.include" 
                    (change)="updateParentMap(map.original, { include: $any($event.target).checked })"
                    class="rounded bg-slate-800 border-slate-600 text-blue-500"
                  >
                </div>
                <div class="col-span-5 truncate text-slate-300 font-mono text-xs" title="{{map.original}}">
                  {{ map.original }}
                </div>
                <div class="col-span-6">
                  <input 
                    type="text" 
                    [ngModel]="map.sqlName"
                    (change)="updateParentMap(map.original, { sqlName: $any($event.target).value })"
                    class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 outline-none"
                  >
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Advanced: Has Children in Same File -->
      <div class="mb-4">
         <label class="flex items-center gap-2 cursor-pointer">
           <input 
             type="checkbox" 
             [checked]="config().hasChildInSameFile"
             (change)="updateHasChild($event)"
             class="rounded bg-slate-700 border-slate-600 text-purple-500 focus:ring-purple-500"
           >
           <span class="text-sm font-medium text-slate-300">Has Child Table in Same File?</span>
         </label>
      </div>

      @if (config().hasChildInSameFile) {
        <div class="ml-4 border-l-2 border-purple-500/30 pl-4 animate-in fade-in slide-in-from-top-2">
           <h4 class="text-sm text-purple-300 font-semibold mb-3">Child Table Settings</h4>
           
           <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Child SQL Table Name</label>
            <input 
              type="text" 
              [ngModel]="config().childSqlTableName"
              (ngModelChange)="updateChildName($event)"
              class="w-full bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200 focus:border-purple-500 outline-none"
            >
           </div>

           <!-- Child Column Mapping Panel -->
            <div class="border border-slate-700 rounded-lg overflow-hidden">
              <button 
                class="w-full px-4 py-2 bg-slate-700/50 hover:bg-slate-700 flex items-center justify-between text-sm font-medium text-slate-300"
                (click)="toggleChildCols()"
              >
                <span>Column Mapping (Child)</span>
                <span class="text-xs">{{ countIncluded(config().childMappings) }} selected</span>
              </button>
              
              @if (showChildCols()) {
                <div class="p-3 bg-slate-900/50 max-h-60 overflow-y-auto custom-scrollbar">
                  <div class="grid grid-cols-12 gap-2 text-xs text-slate-500 mb-2 px-1">
                    <div class="col-span-1 text-center">Inc.</div>
                    <div class="col-span-5">CSV Header</div>
                    <div class="col-span-6">SQL Column</div>
                  </div>
                  @for (map of config().childMappings; track map.original) {
                    <div class="grid grid-cols-12 gap-2 items-center mb-2">
                      <div class="col-span-1 flex justify-center">
                        <input 
                          type="checkbox" 
                          [checked]="map.include" 
                          (change)="updateChildMap(map.original, { include: $any($event.target).checked })"
                          class="rounded bg-slate-800 border-slate-600 text-purple-500"
                        >
                      </div>
                      <div class="col-span-5 truncate text-slate-300 font-mono text-xs" title="{{map.original}}">
                        {{ map.original }}
                      </div>
                      <div class="col-span-6">
                        <input 
                          type="text" 
                          [ngModel]="map.sqlName"
                          (change)="updateChildMap(map.original, { sqlName: $any($event.target).value })"
                          class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-purple-500 outline-none"
                        >
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
        </div>
      } @else {
        <!-- External Relationship Config (Only if NO child in same file) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700/50">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Parent Table (Different File)</label>
            <select 
              [ngModel]="config().externalParentTableId"
              (ngModelChange)="updateExternalParent($event)"
              class="w-full bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none">
              <option [value]="null">-- No External Parent --</option>
              @for (opt of tableOptions(); track opt.id) {
                @if (opt.id !== config().id) {
                  <option [value]="opt.id">{{ opt.name }}</option>
                }
              }
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Foreign Key (In this file)</label>
            <select 
              [ngModel]="config().externalForeignKey"
              (ngModelChange)="updateExternalFk($event)"
              [disabled]="!config().externalParentTableId"
              class="w-full bg-slate-900 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50">
              <option [value]="null">-- Select FK --</option>
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
  tableOptions = input.required<{id: string, name: string}[]>();
  
  remove = output<string>();
  
  store = inject(StoreService);

  showParentCols = signal(false);
  showChildCols = signal(false);

  toggleParentCols() {
    this.showParentCols.update(v => !v);
  }

  toggleChildCols() {
    this.showChildCols.update(v => !v);
  }

  toggleSelection(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this.store.updateTable(this.config().id, { selected: checked });
  }

  updateDelimiter(val: string) {
    this.store.reparseTable(this.config().id, val);
  }

  updateBoolMode(val: BooleanMode) {
    this.store.updateTable(this.config().id, { booleanMode: val });
  }

  updateSqlName(val: string) {
    this.store.updateTable(this.config().id, { sqlTableName: val });
  }

  updatePk(val: string) {
    this.store.updateTable(this.config().id, { primaryKey: val });
  }

  updateHasChild(e: Event) {
    this.store.updateTable(this.config().id, { hasChildInSameFile: (e.target as HTMLInputElement).checked });
  }

  updateChildName(val: string) {
    this.store.updateTable(this.config().id, { childSqlTableName: val });
  }

  updateExternalParent(val: string) {
    this.store.updateTable(this.config().id, { externalParentTableId: val });
  }

  updateExternalFk(val: string) {
    this.store.updateTable(this.config().id, { externalForeignKey: val });
  }

  updateParentMap(original: string, changes: Partial<ColumnMapping>) {
    this.store.updateParentMapping(this.config().id, original, changes);
  }

  updateChildMap(original: string, changes: Partial<ColumnMapping>) {
    this.store.updateChildMapping(this.config().id, original, changes);
  }

  countIncluded(mappings: ColumnMapping[]) {
    return mappings.filter(m => m.include).length;
  }
}