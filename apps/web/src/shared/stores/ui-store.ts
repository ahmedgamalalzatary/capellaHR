import { create } from "zustand";

/**
 * Client-only UI state. Server data lives in TanStack Query, not here — keep
 * this store limited to things like layout chrome and view preferences.
 */
type UiState = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open })
}));
