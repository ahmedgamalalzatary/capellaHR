import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Label } from './label';

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  /** Short help under the control (give the control `aria-describedby={`${htmlFor}-hint`}`). */
  hint?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
  className?: string;
}

/** Form field wrapper: label, control, optional hint, and the Arabic validation message. */
export function Field({ label, htmlFor, error, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      {children}
      {hint && !error ? <p id={`${htmlFor}-hint`} className="text-[12px] text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
