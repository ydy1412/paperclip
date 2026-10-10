import type { PaperclipPluginManifestV1, PluginToolDeclaration } from "@paperclipai/plugin-sdk";

export const draftTools: PluginToolDeclaration[] = [
  {
    name: "get-draft-context", displayName: "Marketing Draft Targets",
    description: "For a blog or SNS writing request, first read available project/profile/channel targets and their concept, tone, audience and rules. A project task is already scoped. In a general conversation use an explicitly selected projectId; ask the user if the project or channel is ambiguous. Never publish.",
    parametersSchema: { type: "object", properties: { projectId: { type: "string", description: "Optional project ID returned by this tool, selected by the user or unambiguous request context." } }, additionalProperties: false },
  },
  {
    name: "upload-draft-media", displayName: "Marketing Draft Media Upload",
    description: "Upload a real image/video from the current task's workspace for a Marketing draft. Use the returned attachmentId, never a fabricated ID or a file path in draft media. Maximum 10 MiB. Does not create media or publish anything.",
    parametersSchema: { type: "object", properties: { path: { type: "string", description: "Relative file path inside the current task workspace." }, contentType: { type: "string", enum: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"] } }, required: ["path", "contentType"], additionalProperties: false },
  },
  {
    name: "submit-draft", displayName: "Submit Marketing Draft",
    description: "After writing a requested blog/SNS post, submit the complete title/body and actual media to Marketing for human review. Ordinary requests such as 'write a post about this topic' include this draft handoff; do not stop at chat text. Read channel rules first. Return the draft ID/link and do not claim publication. Same run/channel submission is idempotent and changed content cannot overwrite operator edits. No approval or SNS posting authority.",
    parametersSchema: { type: "object", properties: {
      projectId: { type: "string" }, channelId: { type: "string" }, topic: { type: "string" },
      content: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, media: { type: "array", items: { type: "object", properties: { attachmentId: { type: "string" }, alt: { type: "string" } }, required: ["attachmentId", "alt"], additionalProperties: false } } }, required: ["title", "body", "media"], additionalProperties: false },
    }, required: ["projectId", "channelId", "topic", "content"], additionalProperties: false },
  },
];

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-marketing-drafts", apiVersion: 1, version: "0.1.0",
  displayName: "Marketing Drafts", description: "Write with agents, submit drafts and media to Marketing, let the operator approve publication.",
  author: "Paperclip", categories: ["connector"],
  capabilities: ["agent.tools.register", "marketing.drafts.read", "marketing.media.upload", "marketing.drafts.create"],
  entrypoints: { worker: "./dist/worker.js" }, tools: draftTools,
};
export default manifest;
