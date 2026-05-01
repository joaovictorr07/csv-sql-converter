export type LoadingContext = 'sql-generation';

export interface LoadingConfig {
  context: LoadingContext;
  title: string;
  message: string;
}

export interface LoadingState {
  active: boolean;
  context: LoadingContext | null;
  title: string;
  message: string;
}
