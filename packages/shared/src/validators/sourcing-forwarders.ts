import { z } from "zod";
const fields = z.object({ providerId: z.string().uuid(), enabled: z.boolean().default(true) });
export const createSourcingForwarderSchema = fields.extend({ loginId: z.string().trim().min(1).max(200), password: z.string().min(1).max(1000) }).strict();
export const updateSourcingForwarderSchema = fields.extend({ loginId: z.string().trim().min(1).max(200).optional(), password: z.string().min(1).max(1000).optional() }).strict()
  .refine(value => Boolean(value.loginId) === Boolean(value.password), "계정을 바꾸려면 아이디와 비밀번호를 함께 입력해 주세요.");
export type CreateSourcingForwarder = z.infer<typeof createSourcingForwarderSchema>;
export type UpdateSourcingForwarder = z.infer<typeof updateSourcingForwarderSchema>;
