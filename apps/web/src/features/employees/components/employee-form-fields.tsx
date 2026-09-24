'use client';

import Image from 'next/image';
import { type FieldError } from 'react-hook-form';

import { Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import {
  type Employee,
  type EmployeeImageKind,
} from '../api/employees-api';

// Ordered image fields keep create and edit forms synchronized with the multipart contract.
export const IMAGE_FIELDS: { kind: Exclude<EmployeeImageKind, 'personal'>; label: string }[] = [
  { kind: 'idFront', label: 'صورة البطاقة (وجه)' },
  { kind: 'idBack', label: 'صورة البطاقة (ظهر)' },
];

export const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    const fieldMessage = Object.values(error.fieldErrors).find(
      (messages) => messages && messages.length > 0,
    )?.[0];
    return fieldMessage ?? error.message;
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export interface BranchOption {
  id: number;
  name: string;
}

/** register()-compatible props for the shared text fields of both forms. */
export interface EmployeeFieldsApi {
  register: (name: never) => Record<string, unknown>;
  errors: Partial<Record<string, FieldError | undefined>>;
}

export function TextField({
  form,
  name,
  label,
  type = 'text',
}: {
  form: EmployeeFieldsApi;
  name: string;
  label: string;
  type?: string;
}) {
  return (
    <Field label={label} htmlFor={`employee-${name}`} required error={form.errors[name]?.message}>
      <Input
        id={`employee-${name}`}
        type={type}
        {...form.register(name as never)}
      />
    </Field>
  );
}

export function ImageField({
  kind,
  label,
  required,
  error,
  onSelect,
}: {
  kind: EmployeeImageKind;
  label: string;
  required: boolean;
  error: string | undefined;
  onSelect: (file: File | undefined) => void;
}) {
  return (
    <Field label={label} htmlFor={`employee-image-${kind}`} required={required} error={error}>
      <Input
        id={`employee-image-${kind}`}
        type="file"
        accept="image/*"
        onChange={(event) => onSelect(event.target.files?.[0])}
      />
    </Field>
  );
}

export function SavedEmployeeImage({
  employee,
  kind,
  label,
}: {
  employee: Employee;
  kind: Exclude<EmployeeImageKind, 'personal'>;
  label: string;
}) {
  const image = employee.images[kind];
  if (!image) return null;

  const source = `/api/v1/employees/${employee.id}/images/${kind}`;
  return (
    <div className="space-y-2 rounded-control border border-line p-3">
      <p className="text-[13px] font-medium">{label}</p>
      <a href={source} target="_blank" rel="noreferrer">
        <Image
          src={source}
          alt={label}
          width={640}
          height={320}
          unoptimized
          className="h-40 w-full rounded-control border border-line object-contain"
        />
      </a>
      <div className="flex gap-2">
        <a
          href={source}
          target="_blank"
          rel="noreferrer"
          aria-label={`\u0639\u0631\u0636 ${label}`}
          className="inline-flex h-8 items-center justify-center rounded-control border border-line bg-paper px-3 text-[13px] font-medium text-ink hover:bg-surface"
        >
          {'\u0639\u0631\u0636'}
        </a>
        <a
          href={source}
          download={image.originalName}
          aria-label={`\u062a\u0646\u0632\u064a\u0644 ${label}`}
          className="inline-flex h-8 items-center justify-center rounded-control border border-line bg-paper px-3 text-[13px] font-medium text-ink hover:bg-surface"
        >
          {'\u062a\u0646\u0632\u064a\u0644'}
        </a>
      </div>
    </div>
  );
}
