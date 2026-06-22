import type { z } from "zod";
import type { adminBootstrapSchema, signInSchema } from "../schemas/auth.js";

export type SignInInput = z.infer<typeof signInSchema>;
export type AdminBootstrapInput = z.infer<typeof adminBootstrapSchema>;
