import { z } from "zod";

export const OnboardTenantSchema = z.object({
  tenantName: z.string().trim().min(1).max(100),
  industry: z.string().trim().max(50).optional(),
  adminEmail: z.string().trim().min(3).max(200),
  adminDisplayName: z.string().trim().max(100).optional(),
  // 部門模板 · 未提供則用工廠 default 6 部門 (OQ-TP-9)
  departments: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});
export type OnboardTenantDto = z.infer<typeof OnboardTenantSchema>;

export const ResetPasswordSchema = z.object({
  tenantId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

export const UnlockSchema = ResetPasswordSchema;
