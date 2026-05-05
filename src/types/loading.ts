export type LoadingContext = 'sql-generation';

export interface LoadingConfig {
  context: LoadingContext;
  titleKey: string;
  messageKey: string;
}

export interface LoadingState {
  active: boolean;
  context: LoadingContext | null;
  titleKey: string;
  messageKey: string;
}
