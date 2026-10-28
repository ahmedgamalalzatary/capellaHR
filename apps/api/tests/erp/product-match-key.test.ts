import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { matchKeyFor, normalizeMatchName } from '../../src/modules/erp/catalog/index.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Cross-branch name comparison is deliberately more forgiving than the
 * in-branch duplicate rule: two branches typing the same item with different
 * spelling must find each other. The in-branch rule stays exactly as it was, so
 * this helper is the only place that folds letters and drops diacritics.
 */
describe('cross-branch product name normalization', () => {
  it('trims and lower-cases', () => {
    expect(normalizeMatchName('  SHAmpoo  ')).toBe('shampoo');
  });

  it('collapses repeated spaces into one', () => {
    expect(normalizeMatchName('Hair    Oil')).toBe('hair oil');
    expect(normalizeMatchName('Hair\tOil\n')).toBe('hair oil');
  });

  it('removes Arabic diacritics', () => {
    expect(normalizeMatchName('شَامْبُو')).toBe('شامبو');
    expect(normalizeMatchName('أرْغَان')).toBe('ارغان');
  });

  it('treats the alef forms as one letter', () => {
    expect(normalizeMatchName('أحمد')).toBe('احمد');
    expect(normalizeMatchName('إحمد')).toBe('احمد');
    expect(normalizeMatchName('آحمد')).toBe('احمد');
  });

  it('treats taa marbuta and haa as the same letter', () => {
    expect(normalizeMatchName('دهانة')).toBe('دهانه');
    expect(normalizeMatchName('دهانه')).toBe('دهانه');
  });

  it('treats alef maqsura and yaa as the same letter', () => {
    expect(normalizeMatchName('مصطفى')).toBe('مصطفي');
    expect(normalizeMatchName('مصطفي')).toBe('مصطفي');
  });

  it('matches names that differ only by case, spacing and spelling', () => {
    expect(normalizeMatchName('  الأرْغَان  ')).toBe(normalizeMatchName('الارغان'));
  });

  it('keeps different words different', () => {
    expect(normalizeMatchName('شامبو')).not.toBe(normalizeMatchName('بلسم'));
    expect(normalizeMatchName('hair oil')).not.toBe(normalizeMatchName('hair gel'));
  });

  it('derives a sha256 match key over the normalized name', () => {
    expect(matchKeyFor('  الأرْغَان  ')).toBe(sha256('الارغان'));
    expect(matchKeyFor('  الأرْغَان  ')).toMatch(/^[a-f0-9]{64}$/);
  });
});
