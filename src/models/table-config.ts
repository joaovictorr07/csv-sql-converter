import { BooleanMode } from '../types/boolean-mode';
import { ColumnMapping } from './column-mapping';

export interface AutoIncrementIdConfig {
  enabled: boolean;
  columnName: string;
  startAt: number;
}

export type RelationshipTargetMode = 'auto-increment' | 'selected-pk';

export interface ForeignKeySqlColumnConfig {
  parentColumn: string;
  fkColumnName: string;
}

export interface ExternalRelationshipSourceMapping {
  parentColumn: string;
  childColumn: string | null;
}

export interface TableConfig {
  id: string;
  name: string; // File name (display only)
  rawContent: string; // Stored for re-parsing
  
  // Parsing Settings
  delimiter: string;
  booleanMode: BooleanMode;
  
  // Parent / Main Table
  sqlTableName: string;
  primaryKeyColumns: string[]; // CSV columns used as PK/Grouping
  columns: string[]; // All original headers
  parentMappings: ColumnMapping[];
  data: any[]; // Array of row objects
  selected: boolean;

  // Single-File Parent/Child Mode
  hasChildInSameFile: boolean;
  childSqlTableName: string;
  childMappings: ColumnMapping[];
  relationshipTargetMode: RelationshipTargetMode;
  sameFileForeignKeyColumnName: string;
  sameFileSelectedPkForeignKeys: ForeignKeySqlColumnConfig[];
  
  // Multi-File Parent/Child Mode (Only used if hasChildInSameFile is false)
  externalParentTableId: string | null;
  externalRelationshipSourceMappings: ExternalRelationshipSourceMapping[];
  externalForeignKeyColumnName: string;
  externalSelectedPkForeignKeys: ForeignKeySqlColumnConfig[];
  autoIncrementId: AutoIncrementIdConfig;
}
