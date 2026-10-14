'use client';

import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface TabItem<Value extends string = string> {
  value: Value;
  label: string;
  /** Optional figure shown beside the label (e.g. rows in that tab). */
  count?: number;
}

export interface TabsProps<Value extends string = string> {
  /** Prefix for the tab and panel ids; must be unique on the page. */
  idBase: string;
  /** Accessible name of the tab list. */
  label: string;
  items: readonly TabItem<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string;
}

const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
const panelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;

const isRtl = (element: HTMLElement) =>
  (element.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir) !== 'ltr';

/**
 * One tab implementation for both apps. Arrow keys follow the reading direction (in Arabic,
 * ArrowLeft is "next"), selection follows focus, and the list scrolls sideways on phones
 * instead of wrapping.
 */
export function Tabs<Value extends string>({ idBase, label, items, value, onValueChange, className }: TabsProps<Value>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    const wrapped = (index + items.length) % items.length;
    const item = items[wrapped];
    if (!item) return;
    onValueChange(item.value);
    tabRefs.current[wrapped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = isRtl(event.currentTarget) ? 'ArrowLeft' : 'ArrowRight';
    const backward = forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    const target = {
      [forward]: index + 1,
      [backward]: index - 1,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('scroll-thin flex max-w-full gap-1 overflow-x-auto border-b border-line', className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={tabId(idBase, item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idBase, item.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              '-mb-px inline-flex h-(--control-h) shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150',
              selected
                ? 'border-brand font-semibold text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count === undefined ? null : (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-[11px] leading-5',
                  selected ? 'bg-brand-soft text-brand-strong' : 'bg-surface text-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  idBase: string;
  /** The selected tab's value. */
  value: string;
  children: ReactNode;
}

/** The content of the selected tab, named by its tab. */
export function TabPanel({ idBase, value, className, children, ...props }: TabPanelProps) {
  return (
    <div
      id={panelId(idBase, value)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, value)}
      tabIndex={0}
      className={cn('outline-none', className)}
      {...props}
    >
      {children}
    </div>
  );
}
