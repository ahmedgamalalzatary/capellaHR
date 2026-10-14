/** Shared look of every text-like control, so Input, Select, Textarea and Combobox line up. */
export const controlClassName = [
  'w-full rounded-control border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted',
  'transition-colors duration-150 hover:border-ink/25',
  'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
  'disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70',
  'aria-invalid:border-danger',
].join(' ');
