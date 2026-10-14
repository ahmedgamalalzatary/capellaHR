import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '../lib/cn';
import { controlClassName } from './control-styles';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line control matching `Input`'s border, radius and disabled treatment. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(controlClassName, 'py-2', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
