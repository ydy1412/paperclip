import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, HandoffContent, SaveHandoff } from "@paperclipai/shared";
import { agentContinuityApi } from "../api/agent-continuity";
import { agentsApi } from "../api/agents";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { MarkdownBody } from "./MarkdownBody";

const statusLabels = { resumed: "세션 재개 확인", fresh: "새 세션 준비", fresh_with_handoff: "인수인계 준비", awaiting_decision: "복구 판단 필요", attention_required: "확인 필요", failed: "실행 실패" };
const fields = [["changedFiles", "변경 파일"], ["completed", "완료한 작업"], ["inProgress", "진행 중 작업"], ["acceptanceCriteria", "완료 기준"], ["decisions", "설계 결정"], ["unresolved", "미해결 문제"], ["blockers", "막힌 부분"], ["nextActions", "다음 행동"]] as const;
const lines = (value: string) => value.split("\n").map(line => line.trim()).filter(Boolean);

export function AgentContinuity({ agent }: { agent: Agent }) {
  const cache = useQueryClient();
  const [alias, setAlias] = useState(agent.seatAlias ?? "");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState(true); const [threadId, setThreadId] = useState<string>();
  const [recipients, setRecipients] = useState<string[]>([]); const [body, setBody] = useState(""); const [relatedIssueId, setRelatedIssueId] = useState("");
  const [issueId, setIssueId] = useState(""); const [goal, setGoal] = useState(""); const [notes, setNotes] = useState<Record<string, string>>({});
  const [testCommand, setTestCommand] = useState(""); const [testResult, setTestResult] = useState<"passed" | "failed" | "not_run">("not_run"); const [testDetails, setTestDetails] = useState("");
  const base = ["agent-continuity", agent.id];
  const state = useQuery({ queryKey: [...base, "state"], queryFn: () => agentContinuityApi.assess(agent.id), refetchInterval: 10_000 });
  const handoffs = useQuery({ queryKey: [...base, "handoffs"], queryFn: () => agentContinuityApi.handoffs(agent.id) });
  const mailbox = useQuery({ queryKey: [...base, "mailbox", unread, threadId], queryFn: () => agentContinuityApi.mailbox(agent.id, unread, threadId), refetchInterval: 10_000 });
  const team = useQuery({ queryKey: [...base, "team"], queryFn: () => agentsApi.list(agent.companyId) });
  useEffect(() => setAlias(agent.seatAlias ?? ""), [agent.seatAlias]);
  async function act(operation: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); await cache.invalidateQueries({ queryKey: base }); setNotice(message); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const selected = state.data?.find(row => row.issueId === issueId);
  function save(policy: SaveHandoff["policy"]) {
    if (!selected) return;
    const content: HandoffContent = { goal, changedFiles: lines(notes.changedFiles ?? ""), completed: lines(notes.completed ?? ""), inProgress: lines(notes.inProgress ?? ""), acceptanceCriteria: lines(notes.acceptanceCriteria ?? ""), decisions: lines(notes.decisions ?? ""), unresolved: lines(notes.unresolved ?? ""), blockers: lines(notes.blockers ?? ""), nextActions: lines(notes.nextActions ?? ""), tests: [{ command: testCommand || "No tests run", result: testResult, details: testDetails }] };
    void act(() => agentContinuityApi.save(agent.id, { issueId, expectedSessionId: selected.sessionId, policy, content }), policy === "fresh_with_handoff" ? "인수인계를 저장했습니다. 다음 실행에서 새 세션을 사용합니다." : "체크포인트를 저장했습니다.");
  }
  return <div className="flex flex-col gap-6">
    {error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status" className="text-muted-foreground">{notice}</p>}
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">안정적인 에이전트 별칭</h2>
      <label className="flex flex-col gap-2">별칭<Input value={alias} onChange={event => setAlias(event.target.value)} placeholder="backend@smartfarm" maxLength={120} /></label>
      <p className="text-sm text-muted-foreground">같은 회사에서 중복할 수 없습니다. 별칭을 바꿔도 작업과 세션 기록은 유지됩니다.</p>
      <Button disabled={busy} onClick={() => void act(async () => { await agentsApi.update(agent.id, { seatAlias: alias || null }, agent.companyId); await cache.invalidateQueries({ queryKey: ["agents"] }); }, "별칭을 저장했습니다.")}>별칭 저장</Button>
    </section>
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">세션 복구 상태</h2>
      {state.error && <p role="alert">{state.error.message}</p>}{state.isLoading && <p>확인 중…</p>}{state.data?.length === 0 && <p>저장된 작업 세션이 없습니다.</p>}
      {state.data?.map(row => <div key={row.taskSessionId} className="flex flex-col gap-1"><p>{statusLabels[row.status]} · {row.taskTitle ?? row.issueId}</p>{row.reasons.map(reason => <p key={reason} className="text-sm text-muted-foreground">{reason}</p>)}</div>)}
      <Button variant="outline" disabled={busy} onClick={() => void act(() => state.refetch({ throwOnError: true }), "복구 상태를 갱신했습니다.")}>상태 갱신</Button>
    </section>
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">인수인계와 세션 교체</h2>
      <label className="flex flex-col gap-2">작업<select value={issueId} onChange={event => setIssueId(event.target.value)} className="border-input rounded-md border bg-background p-2"><option value="">저장된 세션의 작업 선택</option>{state.data?.map(row => <option key={row.taskSessionId} value={row.issueId}>{row.taskIdentifier ? `${row.taskIdentifier} · ` : ""}{row.taskTitle ?? row.issueId}</option>)}</select></label>
      <label className="flex flex-col gap-2">현재 목표<Textarea value={goal} onChange={event => setGoal(event.target.value)} maxLength={1500} /></label>
      {fields.map(([key, label]) => <label key={key} className="flex flex-col gap-2">{label} (한 줄에 한 항목)<Textarea value={notes[key] ?? ""} onChange={event => setNotes(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
      <label className="flex flex-col gap-2">실행한 테스트<Input value={testCommand} onChange={event => setTestCommand(event.target.value)} /></label>
      <label className="flex flex-col gap-2">테스트 결과<select value={testResult} onChange={event => setTestResult(event.target.value as typeof testResult)} className="border-input rounded-md border bg-background p-2"><option value="not_run">미실행</option><option value="passed">통과</option><option value="failed">실패</option></select></label>
      <label className="flex flex-col gap-2">테스트 결과 설명<Textarea value={testDetails} onChange={event => setTestDetails(event.target.value)} /></label>
      <p className="text-sm text-muted-foreground">새 세션 교체는 실행이 멈춘 상태에서만 가능합니다. 작업을 실행하거나 담당자·상태를 바꾸지 않습니다.</p>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !selected} onClick={() => save("checkpoint_only")}>체크포인트 저장</Button><Button variant="outline" disabled={busy || !selected} onClick={() => save("resume")}>기존 세션 유지</Button><Button variant="outline" disabled={busy || !selected} onClick={() => save("fresh_with_handoff")}>인수인계 후 새 세션</Button></div>
      {handoffs.error && <p role="alert">{handoffs.error.message}</p>}{handoffs.data?.map(row => <details key={row.id}><summary>인수인계 · {row.packet.createdAt}</summary><MarkdownBody>{row.markdown}</MarkdownBody></details>)}
    </section>
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">에이전트 메시지함</h2><p className="text-sm text-muted-foreground">참고, 질문, 리뷰, 상태 공유용입니다. 수행할 업무는 작업으로 등록하세요.</p>
      <fieldset className="flex flex-col gap-2"><legend>받는 에이전트 (여러 명 선택 가능)</legend>{team.data?.filter(member => member.status !== "terminated").map(member => <label key={member.id} className="flex items-center gap-2"><input type="checkbox" checked={recipients.includes(member.id)} onChange={event => setRecipients(previous => event.target.checked ? [...previous, member.id] : previous.filter(id => id !== member.id))} />{member.seatAlias || member.name}</label>)}</fieldset>
      <label className="flex flex-col gap-2">관련 작업 ID (선택)<Input value={relatedIssueId} onChange={event => setRelatedIssueId(event.target.value)} /></label>
      <label className="flex flex-col gap-2">메시지<Textarea value={body} onChange={event => setBody(event.target.value)} maxLength={8000} /></label>
      <Button disabled={busy || !body.trim() || !recipients.length} onClick={() => void act(async () => { await agentContinuityApi.send(agent.id, { recipientIds: recipients, body, relatedIssueId: relatedIssueId || null, threadId }); setBody(""); }, "메시지를 보냈습니다.")}>{threadId ? "대화에 답장" : "메시지 보내기"}</Button>
      <label className="flex items-center gap-2"><input type="checkbox" checked={unread} onChange={event => setUnread(event.target.checked)} />읽지 않은 메시지만</label>{threadId && <Button variant="outline" onClick={() => { setThreadId(undefined); setRecipients([]); }}>전체 메시지함</Button>}
      {mailbox.error && <p role="alert">{mailbox.error.message}</p>}{mailbox.data?.length === 0 && <p>표시할 메시지가 없습니다.</p>}
      {mailbox.data?.map(message => <article key={message.id} className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">{team.data?.find(member => member.id === message.fromAgentId)?.name ?? message.fromAgentId} · {message.readAt ? "읽음" : "읽지 않음"}</p><p className="whitespace-pre-wrap">{message.body}</p>{message.relatedIssueId && <p className="font-mono text-sm">관련 작업: {message.relatedIssueId}</p>}
        <div className="flex gap-2"><Button variant="outline" onClick={() => { setThreadId(message.threadId); setUnread(false); setRecipients([message.fromAgentId]); }}>대화 보기</Button>{!message.readAt && message.toAgentId === agent.id && <Button variant="outline" disabled={busy} onClick={() => void act(() => agentContinuityApi.read(agent.id, message.id), "읽음으로 표시했습니다.")}>읽음 처리</Button>}</div></article>)}
    </section>
  </div>;
}
