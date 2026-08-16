import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useFormDraft } from '../src/lib/form-draft';

function SupplierForm({
  storageKey = 'supplier:1',
  /** Mirrors a branch that is only known a moment after the screen mounts. */
  resolveKeyLate = false,
}: {
  storageKey?: string;
  resolveKeyLate?: boolean;
}) {
  const [resolved, setResolved] = useState(!resolveKeyLate);
  const [name, setName] = useState('');
  const draft = useFormDraft(
    resolved ? storageKey : 'supplier:own',
    { name },
    name.trim() !== '',
  );

  return (
    <div>
      {draft.pending ? (
        <div>
          <p>لديك مسودة غير محفوظة</p>
          <button onClick={() => setName(draft.restore()?.name ?? '')}>استعادة</button>
          <button onClick={draft.discard}>تجاهل</button>
        </div>
      ) : null}
      <input aria-label="اسم المورد" value={name} onChange={(event) => setName(event.target.value)} />
      <button onClick={() => { setName(''); draft.clear(); }}>حفظ</button>
      <button onClick={() => setResolved(true)}>حدد الفرع</button>
    </div>
  );
}

const type = (value: string) => act(() => {
  const input = screen.getByLabelText('اسم المورد') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

const click = (name: string) => act(() => {
  screen.getByText(name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

describe('form draft memory', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it('keeps what was typed when the screen is left and reopened', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    cleanup();

    render(<SupplierForm />);

    expect(screen.getByText('لديك مسودة غير محفوظة')).toBeDefined();
    click('استعادة');
    expect((screen.getByLabelText('اسم المورد') as HTMLInputElement).value).toBe('مورد جديد');
  });

  it('survives a branch that resolves a moment after the screen mounts', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    cleanup();

    // The screen comes back branch-less, then the branch snaps to the same one.
    render(<SupplierForm resolveKeyLate />);
    click('حدد الفرع');

    expect(screen.getByText('لديك مسودة غير محفوظة')).toBeDefined();
    click('استعادة');
    expect((screen.getByLabelText('اسم المورد') as HTMLInputElement).value).toBe('مورد جديد');
  });

  it('offers the draft rather than applying it, so nothing is refilled unasked', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    cleanup();

    render(<SupplierForm />);

    expect((screen.getByLabelText('اسم المورد') as HTMLInputElement).value).toBe('');
  });

  it('forgets a draft the user discards', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    cleanup();

    render(<SupplierForm />);
    click('تجاهل');
    cleanup();
    render(<SupplierForm />);

    expect(screen.queryByText('لديك مسودة غير محفوظة')).toBeNull();
  });

  it('forgets the draft once the form is saved', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    click('حفظ');
    cleanup();

    render(<SupplierForm />);

    expect(screen.queryByText('لديك مسودة غير محفوظة')).toBeNull();
  });

  it('forgets the draft when the user empties the form by hand', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    type('');
    cleanup();

    render(<SupplierForm />);

    expect(screen.queryByText('لديك مسودة غير محفوظة')).toBeNull();
  });

  it('lets fresh typing replace the offered draft without a second prompt', () => {
    render(<SupplierForm />);
    type('مورد جديد');
    cleanup();

    render(<SupplierForm />);
    type('مورد آخر');

    expect(screen.queryByText('لديك مسودة غير محفوظة')).toBeNull();
    cleanup();
    render(<SupplierForm />);
    click('استعادة');
    expect((screen.getByLabelText('اسم المورد') as HTMLInputElement).value).toBe('مورد آخر');
  });

  it('keeps each branch workspace under its own key', () => {
    render(<SupplierForm storageKey="supplier:1" />);
    type('مورد جديد');
    cleanup();

    render(<SupplierForm storageKey="supplier:3" />);

    expect(screen.queryByText('لديك مسودة غير محفوظة')).toBeNull();
  });

  it('leaves another branch draft untouched while working branch-less', () => {
    render(<SupplierForm storageKey="supplier:1" />);
    type('مورد جديد');
    cleanup();

    render(<SupplierForm storageKey="supplier:3" />);
    cleanup();

    expect(sessionStorage.getItem('capella:form-draft:supplier:1')).not.toBeNull();
  });
});
