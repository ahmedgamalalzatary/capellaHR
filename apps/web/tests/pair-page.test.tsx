import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { PairDeviceView } from '../src/features/devices/components/pair-device-view';

afterEach(cleanup);

describe('PairDeviceView', () => {
  test('acknowledges the pairing link and explains that completion is not available yet', () => {
    render(<PairDeviceView token="tok-abc123" />);
    expect(screen.getByText('ربط هذا الهاتف')).toBeDefined();
    expect(screen.getByText(/إتمام الربط غير متاح بعد/)).toBeDefined();
    expect(screen.getByText(/صالح لاستخدام واحد/)).toBeDefined();
  });

  test('never exposes the raw pairing token on the page', () => {
    const { container } = render(<PairDeviceView token="tok-secret-999" />);
    expect(container.textContent).not.toContain('tok-secret-999');
  });
});
