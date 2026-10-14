import { forwardRef, type LabelHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('block text-sm font-medium text-ink', className)} {...props} />
));
Label.displayName = 'Label';
