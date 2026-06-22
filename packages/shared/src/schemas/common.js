import { z } from "zod";
const egyptianPhonePattern = /^(010|011|012|015)\d{8}$/;
export function normalizeEgyptianPhone(value) {
    const digitsOnly = value.replace(/\D/g, "");
    if (digitsOnly.startsWith("20") && digitsOnly.length === 12) {
        return `0${digitsOnly.slice(2)}`;
    }
    if (digitsOnly.startsWith("201") && digitsOnly.length === 13) {
        return `0${digitsOnly.slice(2)}`;
    }
    return digitsOnly;
}
export const egyptianPhoneSchema = z.string().trim().transform(normalizeEgyptianPhone).refine((value) => egyptianPhonePattern.test(value), "Invalid Egyptian phone number");
export const emailSchema = z.email().trim().toLowerCase();
export const paginationSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20)
});
export const branchSetupStatusSchema = z.enum(["setup_pending", "completed"]);
export const attendanceActionTypeSchema = z.enum(["check_in", "check_out"]);
export const attendanceSessionStatusSchema = z.enum(["open", "completed"]);
