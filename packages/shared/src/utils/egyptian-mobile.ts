/**
 * Normalized Egyptian mobile format (locked spec): exactly 11 Western
 * digits, no separators, starting with 010, 011, 012, or 015.
 */

// Canonical stored/API form: an allowed Egyptian mobile prefix followed by Western digits only.
const NORMALIZED_PATTERN = /^01[0125]\d{8}$/;

export function containsArabicIndicDigits(value: string): boolean {
  return /[\u0660-\u0669]/u.test(value);
}

export function isNormalizedEgyptianMobile(value: string): boolean {
  return NORMALIZED_PATTERN.test(value);
}

/**
 * Best-effort normalization of Western-digit input (spaces, dashes, and a
 * +20 country code). Arabic-Indic digits are rejected rather than converted.
 * Returns null when the input cannot become a valid normalized number.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  if (containsArabicIndicDigits(input)) return null;

  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+20')) {
    digits = `0${digits.slice(3)}`;
  }

  return isNormalizedEgyptianMobile(digits) ? digits : null;
}
