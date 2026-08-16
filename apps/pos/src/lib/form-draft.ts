'use client';

import { useEffect, useRef, useState } from 'react';

const PREFIX = 'capella:form-draft';

/**
 * Keeps a half-filled counter form alive across a tab change.
 *
 * `sessionStorage`, not `localStorage`: the work must survive walking to another
 * screen and back, or a reload, but a till is shared — nobody should inherit the
 * previous cashier's abandoned form after the browser closes. The stored draft is
 * never applied on its own; the caller shows a banner and the user decides, so an
 * old draft can never quietly overwrite what someone is typing now.
 */
export type FormDraft<T> = {
  /** A draft found in storage, waiting for the user to accept or drop it. */
  pending: T | null;
  /** Hands the draft back to the caller so it can refill its own state. */
  restore: () => T | null;
  /** Drops the offered draft and lets the current form be stored instead. */
  discard: () => void;
  /** Called once the form is saved: the draft has served its purpose. */
  clear: () => void;
};

const storageKey = (key: string) => `${PREFIX}:${key}`;

const readDraft = <T,>(key: string): T | null => {
  try {
    const stored = sessionStorage.getItem(storageKey(key));
    return stored === null ? null : (JSON.parse(stored) as T);
  } catch {
    return null;
  }
};

/**
 * `key` is `null` for a form that must never remember — editing a stored row, or
 * correcting one. Such a form neither offers a draft nor writes one.
 */
export function useFormDraft<T>(key: string | null, value: T, dirty: boolean): FormDraft<T> {
  const [pending, setPending] = useState<T | null>(null);
  const readFor = useRef<string | null | undefined>(undefined);
  /** Set once this mount has written under the current key; see the erase rule below. */
  const owns = useRef(false);

  useEffect(() => {
    // The key changes when the branch resolves after mount, so every key is read,
    // not just the first one the screen happened to render with.
    if (readFor.current === key) return;
    readFor.current = key;
    owns.current = false;
    setPending(key === null ? null : readDraft<T>(key));
  }, [key]);

  // Serialized here so a re-rendered object literal does not count as a change.
  const serialized = dirty && key !== null ? JSON.stringify(value) : null;

  useEffect(() => {
    if (key === null || readFor.current !== key) return;
    try {
      if (serialized === null) {
        // An empty form only erases a draft this screen actually wrote. Otherwise
        // a branch arriving late would delete the very draft it is about to offer.
        if (owns.current) {
          owns.current = false;
          sessionStorage.removeItem(storageKey(key));
        }
        return;
      }
      // Typing is an answer to the banner: the fresh work wins over the old draft.
      setPending(null);
      owns.current = true;
      sessionStorage.setItem(storageKey(key), serialized);
    } catch {
      // A full or blocked store only costs the draft, never the form itself.
    }
  }, [key, serialized]);

  const drop = () => {
    setPending(null);
    owns.current = false;
    if (key === null) return;
    try {
      sessionStorage.removeItem(storageKey(key));
    } catch {
      // Nothing to recover from: the draft simply stays until the tab closes.
    }
  };

  return {
    pending,
    restore: () => {
      const draft = pending;
      setPending(null);
      return draft;
    },
    discard: drop,
    clear: drop,
  };
}
