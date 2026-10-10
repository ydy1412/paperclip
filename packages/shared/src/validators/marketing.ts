import { z } from "zod";

export const marketingPlatformSchema = z.enum([
  "naver_blog", "threads", "x", "linkedin", "instagram", "youtube", "tistory",
]);
export const marketingJobStatusSchema = z.enum([
  "queued", "publishing", "published", "auth_required", "failed", "uncertain", "cancelled",
]);
export const marketingMediaSchema = z.object({
  attachmentId: z.string().uuid(),
  alt: z.string().trim().max(1000).default(""),
}).strict();
export const marketingContentSchema = z.object({
  title: z.string().trim().max(300).default(""),
  body: z.string().max(60000),
  media: z.array(marketingMediaSchema).max(20).default([]),
}).strict().refine(value => value.body.trim().length > 0 || value.media.length > 0, {
  message: "본문 또는 첨부 자료가 필요합니다.",
});
export const createMarketingProfileSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  asideAccountId: z.string().regex(/^u\d{1,6}$/, "명시적인 Aside 계정 ID가 필요합니다."),
  browserProfileName: z.string().trim().min(1).max(120),
}).strict();
export const updateMarketingProfileSchema = createMarketingProfileSchema
  .omit({ projectId: true }).partial().extend({ enabled: z.boolean().optional() }).strict()
  .refine(value => Object.keys(value).length > 0);
export const createMarketingChannelSchema = z.object({
  projectId: z.string().uuid(),
  profileId: z.string().uuid(),
  platform: marketingPlatformSchema,
  name: z.string().trim().min(1).max(120),
  accountId: z.string().trim().min(1).max(200),
  accountUrl: z.string().url().max(2000),
  concept: z.string().trim().min(1).max(4000),
  tone: z.string().trim().max(2000).default(""),
  audience: z.string().trim().max(2000).default(""),
  writingRules: z.string().trim().max(8000).default(""),
}).strict();
export const updateMarketingChannelSchema = createMarketingChannelSchema
  .omit({ projectId: true }).partial().extend({ enabled: z.boolean().optional() }).strict()
  .refine(value => Object.keys(value).length > 0);
export const createMarketingDraftSchema = z.object({
  channelId: z.string().uuid(),
  topic: z.string().trim().min(1).max(4000),
  content: marketingContentSchema,
}).strict();
export const updateMarketingDraftSchema = z.object({
  revision: z.number().int().positive(),
  topic: z.string().trim().min(1).max(4000),
  content: marketingContentSchema,
}).strict();
export const queueMarketingDraftsSchema = z.object({
  drafts: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict())
    .min(1).max(50).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, {
      message: "같은 초안이 중복 선택됐습니다.",
    }),
}).strict();
export const generateMarketingDraftsSchema = z.object({
  channelIds: z.array(z.string().uuid()).min(1).max(20)
    .refine(ids => new Set(ids).size === ids.length),
  topic: z.string().trim().min(1).max(4000),
  agentId: z.string().uuid(),
}).strict();
export const importMarketingDraftsSchema = z.object({ issueId: z.string().uuid() }).strict();
export const marketingGenerationResultSchema = z.object({
  topic: z.string().trim().min(1).max(4000),
  drafts: z.array(z.object({ channelId: z.string().uuid(), content: marketingContentSchema }).strict())
    .min(1).max(20).refine(rows => new Set(rows.map(row => row.channelId)).size === rows.length),
}).strict();

export type MarketingPlatform = z.infer<typeof marketingPlatformSchema>;
export type MarketingContent = z.infer<typeof marketingContentSchema>;
export type MarketingJobStatus = z.infer<typeof marketingJobStatusSchema>;
export type CreateMarketingProfile = z.infer<typeof createMarketingProfileSchema>;
export type UpdateMarketingProfile = z.infer<typeof updateMarketingProfileSchema>;
export type CreateMarketingChannel = z.infer<typeof createMarketingChannelSchema>;
export type UpdateMarketingChannel = z.infer<typeof updateMarketingChannelSchema>;
export type CreateMarketingDraft = z.infer<typeof createMarketingDraftSchema>;
export type UpdateMarketingDraft = z.infer<typeof updateMarketingDraftSchema>;
export type QueueMarketingDrafts = z.infer<typeof queueMarketingDraftsSchema>;
export type GenerateMarketingDrafts = z.infer<typeof generateMarketingDraftsSchema>;
