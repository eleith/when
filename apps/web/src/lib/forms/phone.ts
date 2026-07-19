// Permissive phone validation shared by the server check and the client `pattern`
// attribute so the two can't drift. Requires at least 7 digits and allows only
// digits and common separators (spaces, dashes, parentheses, dots, leading +),
// so common formats like "+1 (555) 123-4567" pass but free text does not.
export const PHONE_PATTERN = '(?=(\\D*\\d){7,})[\\d+().\\-\\s]{7,25}';

export const PHONE_RE = new RegExp(`^(?:${PHONE_PATTERN})$`);
