import { z } from "zod";

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(500),
  newPassword: z.string().min(1).max(500),      // 實際 policy 交 PasswordPolicyService 驗
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
