'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { api } from '@/lib/api/client';
import {
  createDisplayFormatters,
  type DisplayFormatters,
  type DisplaySettings,
} from '@/lib/utils/format';

const DisplayFormattersContext = createContext<DisplayFormatters | null>(null);

export function RuntimeConfigProvider({ children }: { children: ReactNode }) {
  const settings = useQuery({
    queryKey: ['runtime-config'],
    queryFn: () => api.get<DisplaySettings>('/config'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const formatters = useMemo(
    () => settings.data ? createDisplayFormatters(settings.data) : null,
    [settings.data],
  );

  return (
    <DisplayFormattersContext.Provider value={formatters}>
      {children}
    </DisplayFormattersContext.Provider>
  );
}

export function useDisplayFormatters(): DisplayFormatters | null {
  return useContext(DisplayFormattersContext);
}
