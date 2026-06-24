import type { z } from "zod";
import type { networkWhoamiResponseSchema } from "../schemas/network";

export type NetworkWhoamiResponse = z.infer<typeof networkWhoamiResponseSchema>;
