import { setupServer } from "msw/node";

import { handlers } from "@/test/msw/handlers";

/** Shared MSW server for all tests (started/reset/closed in src/test/setup.ts). */
export const server = setupServer(...handlers);
