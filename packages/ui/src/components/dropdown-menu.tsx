'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

export interface DropdownMenuProps {
  /** Accessible name of the trigger. */
  label: string;
  items: readonly MenuItem[];
  /** Trigger content; defaults to a ⋯ icon. */
  trigger?: ReactNode;
  className?: string;
}

/**
 * A small action menu: opens under its trigger at the inline end, moves focus to the first item,
 * arrows cycle, Escape or Tab closes, and focus returns to the trigger.
 */
export function DropdownMenu({ label, items, trigger, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => enabled[(index + enabled.length) % enabled.length]?.focus();
    if (event.key === 'ArrowDown') { event.preventDefault(); move(current + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(current - 1); }
    else if (event.key === 'Home') { event.preventDefault(); move(0); }
    else if (event.key === 'End') { event.preventDefault(); move(enabled.length - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(false);
  };

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size={trigger ? 'sm' : 'icon'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <MoreHorizontal className="size-4" aria-hidden />}
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute end-0 top-full z-(--z-drawer) mt-1 min-w-44 animate-fade-in rounded-control border border-line bg-paper p-1 shadow-raised"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cn(
                'flex min-h-(--control-h-sm) w-full items-center gap-2 rounded-cell px-2.5 text-start text-sm',
                'outline-none hover:bg-surface focus-visible:bg-surface disabled:opacity-50',
                item.tone === 'danger' ? 'text-danger' : 'text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface RowActionBase {
  label: string;
  onSelect: () => void | Promise<unknown>;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ConfirmSpec {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
}

/** A destructive row action must say how it is confirmed. */
export type RowAction =
  | (RowActionBase & { tone?: 'default'; confirm?: ConfirmSpec })
  | (RowActionBase & { tone: 'danger'; confirm: ConfirmSpec });

export interface RowActionsProps {
  /** Name of the ⋯ menu, e.g. "إجراءات الفاتورة 1024". */
  label: string;
  actions: readonly RowAction[];
  /** How many actions stay visible before the rest move into the menu. */
  maxVisible?: number;
  className?: string;
}

/**
 * Actions on a list row: up to two stay visible, the rest go into a ⋯ menu. Destructive actions
 * always come last and always pass through a confirmation first.
 */
export function RowActions({ label, actions, maxVisible = 2, className }: RowActionsProps) {
  const [confirming, setConfirming] = useState<RowAction | null>(null);
  const [pending, setPending] = useState(false);

  const ordered = [
    ...actions.filter((action) => action.tone !== 'danger'),
    ...actions.filter((action) => action.tone === 'danger'),
  ];
  const fits = ordered.length <= maxVisible;
  const visible = fits ? ordered : ordered.filter((action) => action.tone !== 'danger').slice(0, maxVisible);
  const overflow = fits ? [] : ordered.filter((action) => !visible.includes(action));

  const run = (action: RowAction) => {
    if (action.confirm) setConfirming(action);
    else void action.onSelect();
  };

  const confirm = async () => {
    if (!confirming) return;
    setPending(true);
    try {
      await confirming.onSelect();
    } finally {
      setPending(false);
      setConfirming(null);
    }
  };

  return (
    <div className={cn('flex items-center justify-end gap-1', className)}>
      {visible.map((action) => (
        <Button
          key={action.label}
          variant={action.tone === 'danger' ? 'ghost' : 'secondary'}
          size="sm"
          disabled={action.disabled}
          className={action.tone === 'danger' ? 'text-danger hover:bg-danger-soft' : undefined}
          onClick={() => run(action)}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
      {overflow.length > 0 ? (
        <DropdownMenu
          label={label}
          items={overflow.map((action) => ({
            label: action.label,
            onSelect: () => run(action),
            ...(action.icon ? { icon: action.icon } : {}),
            ...(action.tone ? { tone: action.tone } : {}),
            ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
          }))}
        />
      ) : null}
      {confirming?.confirm ? (
        <ConfirmDialog
          title={confirming.confirm.title}
          description={confirming.confirm.description}
          confirmLabel={confirming.confirm.confirmLabel}
          tone={confirming.tone === 'danger' ? 'danger' : 'default'}
          pending={pending}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
