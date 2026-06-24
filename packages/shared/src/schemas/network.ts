import { z } from "zod";

export const networkWhoamiResponseSchema = z.object({
  ip: z.string()
});
