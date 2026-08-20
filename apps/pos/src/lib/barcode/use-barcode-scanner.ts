'use client';

import { useEffect, useRef } from 'react';

/**
 * The QW2100 is a keyboard wedge: it types the code and presses Enter, with no
 * driver and no permission prompt. A scan is told from human typing by the gap
 * between keystrokes — the scanner delivers a whole code in tens of
 * milliseconds, which no one can type.
 */
const MAX_KEYSTROKE_GAP_MS = 60;
const MIN_CODE_LENGTH = 4;

/** Keystrokes belong to whatever the user is typing in, never to a scan. */
const isTyping = (target: EventTarget | null) => (
  target instanceof HTMLElement
  && (target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement)
);

export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = MIN_CODE_LENGTH,
  maxKeystrokeGapMs = MAX_KEYSTROKE_GAP_MS,
}: {
  onScan: (code: string) => void;
  enabled?: boolean;
  minLength?: number;
  maxKeystrokeGapMs?: number;
}) {
  // Kept in a ref so a re-render mid-scan cannot lose half a code.
  const buffer = useRef('');
  const lastKeyAt = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (event.key === 'Enter') {
        const code = buffer.current;
        buffer.current = '';
        if (gap <= maxKeystrokeGapMs && code.length >= minLength) {
          event.preventDefault();
          handler.current(code);
        }
        return;
      }
      if (event.key.length !== 1) return;
      buffer.current = gap > maxKeystrokeGapMs ? event.key : buffer.current + event.key;
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, minLength, maxKeystrokeGapMs]);
}
