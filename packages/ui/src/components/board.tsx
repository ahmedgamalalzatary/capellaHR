'use client';

import { useState, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { useUiLink } from '../lib/link';

/* ------------------------------------------------------------------------------------------------
 * Flap text: the board's signature. When a live value changes, only the changed cells flip.
 * Figures flip per character. Arabic words flip as one cell, because splitting them would break
 * the joined letters. Reduced motion makes the flip instant (tokens.css).
 * --------------------------------------------------------------------------------------------- */

const isJoiningChar = (char: string) => /\p{Script=Arabic}/u.test(char) && !/\p{Nd}/u.test(char);

/** Splits a value into cells: one per figure character, one per run of Arabic text. */
export function splitFlapCells(value: string): string[] {
  const cells: string[] = [];
  let run = '';
  for (const char of Array.from(value)) {
    const joins = isJoiningChar(char) || (run !== '' && char === ' ');
    if (joins) {
      run += char;
      continue;
    }
    if (run) {
      const trimmed = run.trimEnd();
      cells.push(trimmed);
      for (let i = trimmed.length; i < run.length; i += 1) cells.push(' ');
      run = '';
    }
    cells.push(char);
  }
  if (run) cells.push(run);
  return cells;
}

export function FlapText({ value, className }: { value: string; className?: string }) {
  // "Previous value" kept in state (React's pattern for information from earlier renders).
  const [shown, setShown] = useState<{ value: string; before: string | null }>({ value, before: null });
  if (shown.value !== value) setShown({ value, before: shown.value });
  const cells = splitFlapCells(value);
  const before = shown.before === null ? null : splitFlapCells(shown.before);

  return (
    <span className={cn('inline-flex', className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex [perspective:400px]" dir="auto">
        {cells.map((cell, index) => {
          const flip = before !== null && before[index] !== cell;
          return (
            <span
              key={`${index}-${cell}`}
              data-flap={flip ? 'flip' : 'still'}
              className={cn('inline-block whitespace-pre [transform-origin:50%_0]', flip && 'animate-flap')}
            >
              {cell}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Board: the espresso band for what is live now (drawer, today's queue, bookings).
 * --------------------------------------------------------------------------------------------- */

export interface BoardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Accessible name and small heading of the band (e.g. "الوردية الآن"). */
  title: string;
  /** Right-side extras in the heading row: a live clock, a "since 09:12" note. */
  meta?: ReactNode;
}

export function Board({ title, meta, className, children, ...props }: BoardProps) {
  return (
    <section
      aria-label={title}
      className={cn('rounded-card bg-board p-3 text-board-ink sm:p-4', className)}
      {...props}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-wide text-board-muted">{title}</h2>
        {meta ? <div className="text-[12px] text-board-muted">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

export type BoardTone = 'live' | 'late' | 'cancel' | 'done';

const figureTone: Record<BoardTone, string> = {
  live: 'text-board-ink',
  late: 'text-board-late',
  cancel: 'text-board-cancel',
  done: 'text-board-done',
};

export interface BoardFigureProps {
  label: string;
  /** Already formatted (money, count, duration). */
  value: string;
  /** Small line under the figure. */
  hint?: string;
  tone?: BoardTone;
  /** Every board figure links to the rows behind it. */
  href?: string;
  className?: string;
}

/** A large figure in flap cells; a link to its rows when `href` is set. */
export function BoardFigure({ label, value, hint, tone = 'live', href, className }: BoardFigureProps) {
  const Link = useUiLink();
  const body = (
    <>
      <span className="block text-[12px] text-board-muted">{label}</span>
      <FlapText
        value={value}
        className={cn('tabular type-display mt-1 text-2xl font-bold sm:text-3xl', figureTone[tone])}
      />
      {hint ? <span className="mt-1 block text-[12px] text-board-muted">{hint}</span> : null}
    </>
  );
  const cellClassName = cn(
    'block min-w-0 rounded-cell border border-board-line bg-flap px-3 py-2.5',
    href && 'transition-colors duration-150 hover:border-board-muted/60',
    className,
  );
  return href ? (
    <Link href={href} className={cellClassName}>{body}</Link>
  ) : (
    <div className={cellClassName}>{body}</div>
  );
}

/** The figures row of a board: two columns on phones, up to four on wide screens. */
export function BoardFigures({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid grid-cols-2 gap-2 lg:grid-cols-4', className)} {...props} />;
}

export type BoardRowState = 'upcoming' | 'active' | 'late' | 'cancelled' | 'done';

const rowState: Record<BoardRowState, string> = {
  upcoming: 'text-board-ink',
  active: 'text-board-ink border-s-2 border-s-brand',
  late: 'text-board-late',
  cancelled: 'text-board-cancel line-through decoration-1',
  done: 'text-board-done',
};

export interface BoardRowProps {
  /** Time cell, e.g. "14:30" (tabular, flips per digit). */
  time: string;
  /** Main text: client name, invoice number. */
  title: ReactNode;
  /** Second line on phones / middle columns on wide screens (service · employee). */
  detail?: ReactNode;
  /** Status word, flips as one cell when it changes. */
  status: string;
  state?: BoardRowState;
  /** Actions on the row itself (start, done…). */
  actions?: ReactNode;
}

/**
 * One row on the board: time | title | detail | status. Rows rank by time; late rows turn amber
 * and cancelled rows brick, in place.
 */
export function BoardRow({ time, title, detail, status, state = 'upcoming', actions }: BoardRowProps) {
  return (
    <li
      data-state={state}
      className={cn(
        'grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-cell bg-flap px-3 py-2 transition-colors duration-300',
        'sm:grid-cols-[4.5rem_minmax(0,1.2fr)_minmax(0,1fr)_7rem_auto]',
        rowState[state],
      )}
    >
      <FlapText value={time} className="tabular type-display text-lg font-bold" />
      <div className="min-w-0 truncate text-sm font-medium">{title}</div>
      {detail ? <div className="col-start-2 row-start-2 min-w-0 truncate text-[12px] text-board-muted sm:col-start-auto sm:row-start-auto sm:text-[13px]">{detail}</div> : <span className="hidden sm:block" />}
      <FlapText value={status} className="type-display col-start-3 row-start-1 justify-self-end text-[13px] font-semibold sm:col-start-auto sm:row-start-auto sm:justify-self-start" />
      {actions ? <div className="col-span-3 flex flex-wrap gap-1.5 sm:col-span-1 sm:justify-end">{actions}</div> : null}
    </li>
  );
}

/** The rows list of a board, with its own empty line. */
export function BoardRows({ label, empty, children, className }: {
  /** Accessible name of the list (e.g. "مواعيد اليوم"). */
  label: string;
  /** Shown when there are no rows. */
  empty: string;
  children: ReactNode;
  className?: string;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return hasRows ? (
    <ul aria-label={label} className={cn('space-y-1.5', className)}>{children}</ul>
  ) : (
    <p className={cn('rounded-cell bg-flap px-3 py-4 text-center text-sm text-board-muted', className)}>{empty}</p>
  );
}
