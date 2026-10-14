'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';

import { useMatchMedia, WIDE_QUERY } from '../hooks/use-match-media';
import { cn } from '../lib/cn';
import { useUiLink } from '../lib/link';

export interface ShellNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

export interface ShellNavGroup {
  /** `null` for an unlabelled first group (e.g. the home link). */
  label: string | null;
  items: readonly ShellNavItem[];
}

/** The root link must not stay highlighted on every nested route. */
export const isActiveHref = (href: string, pathname: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

export interface AppShellProps {
  /** e.g. "نقطة البيع" / "الموارد البشرية", shown under the Capella name. */
  product: string;
  /** Public path of the round Capella mark. */
  logoSrc: string;
  navigation: readonly ShellNavGroup[];
  pathname: string;
  /** Top bar, start side: page context or the admin branch switcher. */
  topbarStart?: ReactNode;
  /** Top bar, end side: shift chip, clock, logout. */
  topbarEnd?: ReactNode;
  /** Bottom of the sidebar: account type, version. */
  sidebarFooter?: ReactNode;
  /** Phones only: up to four most-used destinations as a bottom tab bar (cashiers). */
  bottomTabs?: readonly ShellNavItem[];
  /** A running command must not be abandoned by a stray tap on the navigation. */
  locked?: boolean;
  children: ReactNode;
}

export const SHELL_SIDEBAR_ID = 'app-sidebar';
export const SHELL_CONTENT_ID = 'app-content';

function NavLink({ item, active, compact, locked, onNavigate }: {
  item: ShellNavItem;
  active: boolean;
  compact: boolean;
  locked: boolean;
  onNavigate: () => void;
}) {
  const Link = useUiLink();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      {...(active ? { 'aria-current': 'page' as const } : {})}
      {...(compact ? { 'aria-label': item.label, title: item.label } : {})}
      onClick={(event) => {
        if (locked) {
          event.preventDefault();
          return;
        }
        onNavigate();
      }}
      className={cn(
        'group relative flex min-h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors duration-150 pointer-coarse:min-h-11',
        compact && 'justify-center px-0',
        active
          ? 'bg-flap font-semibold text-board-ink'
          : 'text-board-muted hover:bg-board-line/60 hover:text-board-ink',
        locked && 'pointer-events-none opacity-50',
      )}
    >
      {active ? <span aria-hidden className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-brand" /> : null}
      <Icon className="size-[1.125rem] shrink-0" aria-hidden />
      {compact ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/**
 * One shell for both apps, one breakpoint.
 * - Desktop (≥1024px): espresso sidebar with grouped navigation and the Capella mark.
 * - Tablet (768–1023px): the same rail, icons only, so every destination stays one tap away.
 * - Phone: a top bar with a menu button opening the sidebar as a drawer; optional bottom tabs.
 */
export function AppShell({
  product,
  logoSrc,
  navigation,
  pathname,
  topbarStart,
  topbarEnd,
  sidebarFooter,
  bottomTabs,
  locked = false,
  children,
}: AppShellProps) {
  const Link = useUiLink();
  const wide = useMatchMedia(WIDE_QUERY, true);
  const desktop = useMatchMedia('(min-width: 64rem)', true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (wide && drawerOpen) setDrawerOpen(false);
  const compact = wide && !desktop;
  const hasTabs = Boolean(bottomTabs?.length) && !wide;

  // Phone drawer: focus moves in, Tab stays inside, Escape closes, focus returns to the button.
  useEffect(() => {
    if (!drawerOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = document.getElementById(SHELL_SIDEBAR_ID);
    const focusables = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (drawer && (active === null || !drawer.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [drawerOpen]);

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div
      className="min-h-dvh"
      style={{ '--bottom-bar-h': hasTabs ? '4rem' : '0px' } as CSSProperties}
    >
      <a
        href={`#${SHELL_CONTENT_ID}`}
        className="sr-only z-(--z-toast) rounded-control bg-ink px-3 py-2 text-paper focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        الانتقال إلى المحتوى
      </a>

      {drawerOpen ? (
        <div
          data-testid="sidebar-backdrop"
          aria-hidden
          className="fixed inset-0 z-(--z-drawer) animate-fade-in bg-ink/45 md:hidden"
          onClick={closeDrawer}
        />
      ) : null}

      <aside
        id={SHELL_SIDEBAR_ID}
        data-state={drawerOpen ? 'open' : 'closed'}
        aria-label="القائمة الجانبية"
        className={cn(
          'fixed inset-y-0 start-0 z-(--z-drawer) flex w-72 max-w-[85vw] flex-col bg-board text-board-ink',
          'transition-[transform,visibility] duration-200 ease-out',
          'md:visible md:w-[4.5rem] md:translate-x-0 lg:w-64',
          // Visibility, not only transform, keeps the closed drawer out of keyboard and screen-reader order.
          drawerOpen ? 'visible translate-x-0 shadow-panel' : 'invisible translate-x-full',
        )}
      >
        <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-board-line px-4', compact && 'justify-center px-0')}>
          <Link
            href="/"
            {...(compact ? { 'aria-label': `كابيلا — ${product}` } : {})}
            onClick={(event) => {
              if (locked) {
                event.preventDefault();
                return;
              }
              closeDrawer();
            }}
            className={cn('flex min-w-0 items-center gap-3', locked && 'pointer-events-none opacity-50')}
          >
            <img src={logoSrc} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full" />
            {compact ? null : (
              <span className="min-w-0">
                <span className="type-display block text-lg leading-tight font-bold text-champagne">كابيلا</span>
                <span className="block truncate text-[12px] text-board-muted">{product}</span>
              </span>
            )}
          </Link>
          {!wide ? (
            <button
              type="button"
              aria-label="إغلاق القائمة"
              onClick={closeDrawer}
              className="ms-auto inline-flex size-10 items-center justify-center rounded-control text-board-muted hover:bg-board-line/60 hover:text-board-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>

        <nav aria-label="التنقل الرئيسي" className="scroll-thin flex-1 overflow-y-auto px-2.5 py-4 [scrollbar-color:var(--color-board-line)_transparent]">
          {navigation.map((group, groupIndex) => (
            <div
              key={group.label ?? `group-${groupIndex}`}
              {...(group.label ? { role: 'group', 'aria-label': group.label } : {})}
              className="mb-4 last:mb-0"
            >
              {group.label && !compact ? (
                <p className="mb-1 px-3 text-[11px] font-semibold tracking-wide text-board-muted/80">{group.label}</p>
              ) : null}
              {group.label && compact && groupIndex > 0 ? <hr aria-hidden className="mx-3 mb-3 border-board-line" /> : null}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      active={isActiveHref(item.href, pathname)}
                      compact={compact}
                      locked={locked}
                      onNavigate={closeDrawer}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {sidebarFooter && !compact ? (
          <div className="shrink-0 border-t border-board-line p-3 text-[12px] text-board-muted">{sidebarFooter}</div>
        ) : null}
      </aside>

      <div className="flex min-h-dvh flex-col md:ms-[4.5rem] lg:ms-64">
        <header className="sticky top-0 z-(--z-sticky) flex h-14 items-center gap-2 border-b border-line bg-paper/95 px-3 backdrop-blur sm:px-6">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-control text-ink hover:bg-ink/5 md:hidden"
            aria-label={drawerOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={drawerOpen}
            aria-controls={SHELL_SIDEBAR_ID}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          {!wide ? (
            <img src={logoSrc} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full" />
          ) : null}
          <div className="min-w-0 flex-1">{topbarStart}</div>
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">{topbarEnd}</div>
        </header>

        <main
          id={SHELL_CONTENT_ID}
          tabIndex={-1}
          className={cn(
            'mx-auto w-full max-w-7xl flex-1 px-4 py-5 outline-none sm:px-6 sm:py-6',
            // Room for the pinned primary action (and the tab bar) on phones.
            'max-md:pb-[calc(var(--bottom-bar-h)+1.5rem)] max-sm:pb-[calc(var(--bottom-bar-h)+5.5rem)]',
          )}
        >
          {children}
        </main>
      </div>

      {hasTabs ? (
        <nav
          aria-label="الوجهات السريعة"
          className="fixed inset-x-0 bottom-0 z-(--z-sticky) grid border-t border-board-line bg-board pb-[env(safe-area-inset-bottom)] text-board-muted"
          style={{ gridTemplateColumns: `repeat(${bottomTabs!.length}, minmax(0, 1fr))` }}
        >
          {bottomTabs!.map((item) => {
            const active = isActiveHref(item.href, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                onClick={(event) => { if (locked) event.preventDefault(); }}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[11px]',
                  active ? 'font-semibold text-board-ink' : 'hover:text-board-ink',
                  locked && 'pointer-events-none opacity-50',
                )}
              >
                <Icon className={cn('size-5', active && 'text-brand')} aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
