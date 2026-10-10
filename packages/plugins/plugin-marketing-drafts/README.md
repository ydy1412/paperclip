# Marketing Drafts

Installable Paperclip agent tools, backed by the existing Marketing records and
operator review screen. Requires a host with the capability-gated `ctx.marketing`
bridge. No separate service, credentials or plugin-owned database is needed.

Tools: `get-draft-context`, `upload-draft-media`, `submit-draft`.
Enable the plugin and allow these tools for the desired agents/projects in the
normal tool profile. Keep `marketing-drafts` as the writing guidance. Agents
on the existing Paperclip projects MCP connection use
`paperclip_search_plugin_tools` and `paperclip_call_plugin_tool`; no additional
MCP registration or credentials are needed. This bridge is available in standard
work mode and preserves the gateway's existing policy and audit checks. Agents
read channel rules, write the requested post and submit it, not just chat text.
The updated host's chat directive treats this bounded draft handoff as routine
standard-mode tool use, without creating a separate implementation task.
No tool approves, queues or publishes a post.

The host resolves identity from an authenticated active run. Project tasks cannot
switch projects. General conversations can explicitly select a same-company
project; ambiguous targets need clarification. Ask/Plan modes do not permit
uploads or submission. Media must be a real current-workspace file, at most
10 MiB, with its correct MIME type. Existing native attachments may also be used.
Repeated submission for one run/channel returns the existing draft; changed
content cannot overwrite operator edits. A later conversation run creates a new
draft. Plugin disable removes tools, not stored drafts/media.

From this package: `pnpm typecheck`, `pnpm test`, `pnpm build`.
Install the built package with the normal Paperclip plugin installation workflow.
