---
name: marketing-drafts
description: Write channel-specific Korean blog and SNS marketing drafts with native image/video attachments, then submit them to Paperclip Marketing for operator review. Use for content briefs, blog posts, social copy and publication-ready drafts; not for automatic posting.
---

# Marketing Drafts

Create drafts from your assigned project task or your conversation with the user.
A request to write blog or SNS content normally includes submitting the finished
draft to Marketing. Do not leave the result only in chat. If the user explicitly
asks for a sample, chat-only answer, or no saving, respect that instruction.
In a standard-mode conversation, complete this bounded draft handoff in the
current run. Do not create a separate execution task merely to register the
finished copy. Respect Ask/Plan restrictions and existing tool permissions.
Never approve, queue or
publish posts, operate social accounts, or change browser/security settings.

## Brief And Copy

- Read the task's topic, business objective, product facts, selected channels and
  reference material. Read each channel's concept, tone, audience and writing rules
  using the draft tools below. Follow the task's language; default to Korean.
- Blog: specific title, useful opening, scannable sections, source-backed details,
  and one appropriate call to action. Distinguish facts, examples and opinion.
- SNS: write independently for its platform and audience, not a shortened copy of
  the blog. Keep the hook, core point and call to action coherent. Use hashtags only
  when the brief/channel rules support them. Avoid fabricated results, testimonials,
  personal experience, prices and unsupported superlatives.
- Verify time-sensitive claims with available research tools. Preserve source links
  in the draft. If essential facts are missing, record the specific missing input;
  do not disguise placeholders as publication-ready copy.

## Images And Video

Use project-owned or explicitly licensed/user-provided media, or an available
authorized creation tool. Do not invent attachment IDs, claim a file was generated
when it was not, or silently substitute a description for the requested file.
Use the Marketing Drafts plugin's `upload-draft-media` tool for real output files.
Pass a path relative to the current task workspace and the actual MIME type,
for example `image/png` or `video/mp4`. The limit is 10 MiB per file. Existing
native files returned by `get-draft-context` can be reused without uploading.

Attach the returned native attachment ID in the desired order and write accurate
alt/caption text. A local path or remote image URL is not a Marketing attachment.
For required video/images without available rights or a creation tool, report the
missing capability instead of submitting the draft as fully media-ready.

## Draft Tools And Handoff

Discover the tools of the `Marketing Drafts` Paperclip plugin using
`paperclip_search_plugin_tools` with query `marketing`, then call each returned
exact name with `paperclip_call_plugin_tool`. These tools are available through
the standard Paperclip projects MCP connection. Tool names
may be namespaced by the host. Use assigned-tool search if they are not listed
directly. Authentication and authorship come from the current agent run; never
store or print tokens, invent IDs, or modify your tool permissions.

1. `get-draft-context` returns available project/profile/channel targets, editorial
   rules and real media. An assigned task is bound to its project. In a direct
   conversation, match the user's project and channel by name to returned targets.
   If the target is ambiguous, ask the user before submitting.
2. Write each requested channel independently and upload actual media when needed.
3. `submit-draft` registers the finished copy in Marketing:

```json
{
  "projectId": "selected-native-project-uuid",
  "channelId": "selected-native-channel-uuid",
  "topic": "The brief's topic",
  "content": {
    "title": "Publication title",
    "body": "Complete publication-ready copy with source links",
    "media": [{ "attachmentId": "uploaded-native-attachment-uuid", "alt": "Accurate description" }]
  }
}
```

An identical submission in the same run and channel is idempotent. A later user
request can create a new draft. A changed resubmission must not overwrite
operator edits; use the existing draft's review/edit flow. If the tool is missing
or rejects the task/channel, stop that submission and report the actual error;
do not change application code, bypass authentication or use posting tools.

Report returned draft IDs, channels, actual attachments and any remaining limits
in the conversation or task. Mark done only after each requested draft was submitted successfully
and media requirements are satisfied. The operator reviews drafts in Marketing;
submission never means publication or user approval.
