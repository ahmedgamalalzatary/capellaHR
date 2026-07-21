import type { KeyboardEvent } from 'react';

/** Implements roving focus for horizontal RTL tablists. */
export function handleRtlTabKey<T>(
  event: KeyboardEvent<HTMLElement>,
  currentIndex: number,
  values: readonly T[],
  select: (value: T) => void,
) {
  let nextIndex: number | null = null;
  if (event.key === 'ArrowLeft') nextIndex = (currentIndex + 1) % values.length;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex - 1 + values.length) % values.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = values.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  const value = values[nextIndex];
  if (value === undefined) return;
  select(value);
  const tablist = event.currentTarget.closest('[role="tablist"]');
  tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
}
