/**
 * Normalized Egyptian mobile format (locked spec): exactly 11 Western
 * digits, no separators, starting with 010, 011, 012, or 015.
 */

const NORMALIZED_PATTERN = /^01[0125]\d{8}$/;

const ARABIC_INDIC_ZERO = 0x0660;
const ARABIC_INDIC_NINE = 0x0669;

export function isNormalizedEgyptianMobile(value: string): boolean {
  return NORMALIZED_PATTERN.test(value);
}

/**
 * Best-effort normalization of user input (spaces, dashes, Arabic-Indic
 * digits, +20 country code). Returns null when the input cannot become a
 * valid normalized number.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  const westernized = [...input]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_NINE
        ? String(code - ARABIC_INDIC_ZERO)
        : char;
    })
    .join('');

  let digits = westernized.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+20')) {
    digits = `0${digits.slice(3)}`;
  }

  return isNormalizedEgyptianMobile(digits) ? digits : null;
}
