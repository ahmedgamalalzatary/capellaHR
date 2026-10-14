import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn';
import { controlClassName } from './control-styles';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native select, on the same baseline as `Input`. Native is kept on purpose: on touch tills and
 * phones the platform picker is faster and more reliable than a custom listbox. Long lists that
 * need typing use `Combobox` instead.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(controlClassName, 'h-(--control-h)', className)} {...props} />
));
Select.displayName = 'Select';
