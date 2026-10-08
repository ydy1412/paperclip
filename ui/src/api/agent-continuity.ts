import type { AgentHandoff, AgentMailboxMessage, ContinuityAssessment, SaveHandoff, SendAgentMessage } from "@paperclipai/shared";
import { api } from "./client";
export const agentContinuityApi = {
  assess: (id: string) => api.get<ContinuityAssessment[]>(`/agents/${id}/continuity`),
  handoffs: (id: string) => api.get<AgentHandoff[]>(`/agents/${id}/handoffs`),
  save: (id: string, input: SaveHandoff) => api.post<AgentHandoff>(`/agents/${id}/handoffs`, input),
  mailbox: (id: string, unread = false, threadId?: string) => api.get<AgentMailboxMessage[]>(`/agents/${id}/mailbox?unread=${unread}${threadId ? `&threadId=${encodeURIComponent(threadId)}` : ""}`),
  send: (id: string, input: SendAgentMessage) => api.post<AgentMailboxMessage[]>(`/agents/${id}/mailbox`, input),
  read: (id: string, messageId: string) => api.post<AgentMailboxMessage>(`/agents/${id}/mailbox/${messageId}/read`, {}),
};
