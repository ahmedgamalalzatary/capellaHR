import { z } from "zod";
import { egyptianPhoneSchema } from "./common.js";
export const signInSchema = z.object({
    phone: egyptianPhoneSchema,
    password: z.string().min(8)
});
export const adminBootstrapSchema = z.object({
    name: z.string().trim().min(1),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(8)
});
