import { ColumnValueType } from '../types/column-value-type';

export interface ColumnMapping {
  original: string;
  sqlName: string;
  include: boolean;
  valueType: ColumnValueType;
}
