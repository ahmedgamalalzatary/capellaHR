import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn';
import { controlClassName } from './control-styles';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlClassName, 'h-(--control-h)', className)} {...props} />
));
Input.displayName = 'Input';
