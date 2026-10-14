import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { FlapText } from '../../src/components/board';

afterEach(cleanup);

const flipping = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-flap="flip"]')).map((cell) => cell.textContent);

describe('FlapText', () => {
  test('does not flip on first render', () => {
    const { container } = render(<FlapText value="1,250" />);
    expect(flipping(container)).toEqual([]);
    expect(container.querySelector('[aria-hidden]')?.textContent).toBe('1,250');
  });

  test('flips only the characters that changed', () => {
    const { container, rerender } = render(<FlapText value="1,250" />);
    rerender(<FlapText value="1,280" />);
    expect(flipping(container)).toEqual(['8']);
  });

  test('keeps Arabic text whole (letters must stay joined) and flips it as one cell', () => {
    const { container, rerender } = render(<FlapText value="في الانتظار" />);
    expect(container.querySelectorAll('[data-flap]')).toHaveLength(1);
    rerender(<FlapText value="متأخر" />);
    expect(flipping(container)).toEqual(['متأخر']);
  });

  test('reads the whole value once to assistive tech, not character by character', () => {
    const { container } = render(<FlapText value="12:30" />);
    expect(container.querySelector('.sr-only')?.textContent).toBe('12:30');
    expect(container.querySelector('[aria-hidden]')?.querySelectorAll('[data-flap]')).toHaveLength(5);
  });
});
