import { createHash } from 'node:crypto';

/**
 * Arabic diacritics (تشكيل) and the Quranic annotation marks that sit in the
 * same role. They change how a word is read, never which item it names.
 */
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/**
 * Cross-branch spelling papered over: the alef was written with or without a
 * hamza, a taa marbuta was typed as a haa, or an alef maqsura as a yaa.
 */
const LETTER_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[أإآ]/g, 'ا'],
  [/ة/g, 'ه'],
  [/ى/g, 'ي'],
];

/**
 * The name two branches compare to decide they hold the same item.
 *
 * This is deliberately NOT the in-branch duplicate rule (`normalizeCatalogName`):
 * that one must keep "Hair Oil" and "Hair  Oil" apart, so existing names need no
 * renaming. Between branches the goal is the opposite — the same oil typed two
 * ways has to find itself — so case, spacing, diacritics and those letter
 * variants are all folded away.
 */
export const normalizeMatchName = (name: string) => {
  let normalized = name.trim().toLowerCase().replace(ARABIC_MARKS, '');
  for (const [pattern, replacement] of LETTER_FOLDS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, ' ').trim();
};

/**
 * Stored rather than computed on the fly: a transfer finds and locks the
 * receiving product by this key, and setup compares whole branches. It is a
 * plain sha256 so the index compares fixed-width values.
 */
export const matchKeyFor = (name: string) => (
  createHash('sha256').update(normalizeMatchName(name)).digest('hex')
);
