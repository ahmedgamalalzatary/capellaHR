'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Button, Field, Input, Modal } from '@capella/ui';

import { clearSessionState } from '@/features/auth';

export type ProtectedArea =
  | 'employees'
  | 'attendance-manual'
  | 'attendance-absence'
  | 'reports'
  | 'payroll';

const storageKey = (area: ProtectedArea) => `capella:protected-area:${area}`;

export function isProtectedAreaUnlocked(area: ProtectedArea): boolean {
  return typeof window !== 'undefined' && sessionStorage.getItem(storageKey(area)) === 'unlocked';
}

interface ProtectedAreaUnlockDialogProps {
  area: ProtectedArea;
  title: string;
  onUnlocked: () => void;
  onClose?: (() => void) | undefined;
}

export function ProtectedAreaUnlockDialog({
  area,
  title,
  onUnlocked,
  onClose,
}: ProtectedAreaUnlockDialogProps) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/protected-area-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 401 && body?.error === 'UNAUTHENTICATED') {
          clearSessionState(queryClient);
          return;
        }
        setError(response.status === 401 && body?.error === 'INVALID_PASSWORD'
          ? 'كلمة المرور غير صحيحة.'
          : 'تعذر التحقق من كلمة المرور. حاول مرة أخرى.');
        return;
      }
      sessionStorage.setItem(storageKey(area), 'unlocked');
      onUnlocked();
    } catch {
      setError('تعذر التحقق من كلمة المرور. حاول مرة أخرى.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal title={title} dismissOnBackdrop={Boolean(onClose)} onClose={() => onClose?.()}>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <Field label="كلمة مرور الوصول" htmlFor={`protected-area-password-${area}`} required>
          <Input
            id={`protected-area-password-${area}`}
            aria-label="كلمة مرور الوصول"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          {onClose ? <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>إلغاء</Button> : null}
          <Button type="submit" disabled={!password || pending}>
            {pending ? 'جارٍ التحقق…' : 'فتح القسم'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProtectedAreaGate({
  area,
  children,
}: {
  area: ProtectedArea;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnlocked(isProtectedAreaUnlocked(area));
    setReady(true);
  }, [area]);

  if (!ready) return null;
  if (unlocked) return <>{children}</>;

  return (
    <ProtectedAreaUnlockDialog
      area={area}
      title="هذا القسم محمي"
      onUnlocked={() => setUnlocked(true)}
    />
  );
}
