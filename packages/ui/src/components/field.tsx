import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Label } from './label';

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** Form field wrapper: label, control, and Arabic validation message. */
export function Field({ label, htmlFor, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
