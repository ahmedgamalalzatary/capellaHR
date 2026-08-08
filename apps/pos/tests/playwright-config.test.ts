import { describe, expect, it } from 'vitest';

import { parseE2ePort } from '../playwright-port';

describe('Playwright POS port configuration', () => {
  it.each([undefined, '', 'abc', '0', '1.5', '65536'])(
    'rejects invalid POS_E2E_PORT value %s',
    (value) => expect(() => parseE2ePort(value)).toThrow(/POS_E2E_PORT/),
  );

  it.each([['1', 1], ['3001', 3001], ['65535', 65535]])(
    'accepts POS_E2E_PORT value %s',
    (value, expected) => expect(parseE2ePort(value)).toBe(expected),
  );
});
