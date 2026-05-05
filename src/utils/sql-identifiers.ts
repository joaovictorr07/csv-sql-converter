const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const SQL_IDENTIFIER_SEPARATORS_REGEX = /[\s\-./\\|,:;]+/g;
const SQL_IDENTIFIER_INVALID_CHARS_REGEX = /[^a-z0-9_]/g;
const DUPLICATE_UNDERSCORES_REGEX = /_+/g;
const EDGE_UNDERSCORES_REGEX = /^_+|_+$/g;
const STARTS_WITH_NUMBER_REGEX = /^\d/;

export function normalizeSqlIdentifier(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .toLowerCase()
    .replace(SQL_IDENTIFIER_SEPARATORS_REGEX, '_')
    .replace(SQL_IDENTIFIER_INVALID_CHARS_REGEX, '')
    .replace(DUPLICATE_UNDERSCORES_REGEX, '_')
    .replace(EDGE_UNDERSCORES_REGEX, '');

  if (!normalized) {
    return 'col';
  }

  return STARTS_WITH_NUMBER_REGEX.test(normalized) ? `col_${normalized}` : normalized;
}
