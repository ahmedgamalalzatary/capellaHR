import type { NetworkWhoamiResponse } from "@capella/shared";

import { api } from "@/shared/lib/api-client";

export const networkApi = {
  /** The caller's IP as seen by the API server (used to prefill branch access rules). */
  whoami: () => api.get<NetworkWhoamiResponse>("/network/whoami")
};
