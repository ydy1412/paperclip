import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContextMenu } from "radix-ui";
import { ChevronDown, ChevronRight, File, FilePlus2, Folder, FolderPlus, PanelLeft, RefreshCw, Save, Search, Trash2, Upload, X } from "lucide-react";
import { knowledgeWorkspaceApi as brain, type BrainDocument, type BrainTree, type BrainTreeItem, type BrainTrashItem, type BrainVault } from "../api/knowledgeWorkspace";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable-panels";
import { MarkdownBody } from "./MarkdownBody";
import { clearDraft, DRAFT_DEBOUNCE_MS, loadDraft, saveDraft } from "../lib/composer-draft";
import { cn } from "../lib/utils";

type Mode = "edit" | "preview" | "split";
type Buffer = { content: string; revision: string; dirty: boolean; mode: Mode };
type Action = "folder" | "note" | "rename" | "move" | "trash" | "restore" | "copy" | "latest";
const labels: Record<Action, string> = { folder: "New folder", note: "New file", rename: "Rename", move: "Move", trash: "Move to Trash", restore: "Restore", copy: "Create editable copy", latest: "Review latest source" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "요청을 완료하지 못했습니다. 다시 시도해 주세요.";
const operationId = () => crypto.randomUUID();

export function explorerRows(items: BrainTreeItem[], expanded: Set<string>, query = "") {
  const matches = new Set(items.filter(i => i.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(i => i.id));
  if (query) for (const item of items.filter(i => matches.has(i.id))) {
    let p = item.parentId;
    while (p) { matches.add(p); p = items.find(i => i.id === p)?.parentId ?? null; }
  }
  const result: { item: BrainTreeItem; depth: number }[] = [], visited = new Set<string>();
  function walk(parentId: string | null, depth: number) {
    const children = items.filter(i => i.parentId === parentId && (!query || matches.has(i.id)))
      .sort((a, b) => Number(b.type === "folder") - Number(a.type === "folder") || a.name.localeCompare(b.name, "ko"));
    for (const item of children) {
      if (visited.has(item.id)) continue;
      visited.add(item.id); result.push({ item, depth });
      if (item.type === "folder" && (query || expanded.has(item.id))) walk(item.id, depth + 1);
    }
  }
  walk(null, 0); return result;
}

export function KnowledgeExplorer({ company, vault, documentId, onDocument }: {
  company: string; vault: BrainVault; documentId: string; onDocument: (id: string) => void;
}) {
  const cache = useQueryClient(), key = ["brain-knowledge", company, vault.id];
  const scope = `paperclip:knowledge:${vault.ownerId ?? "read-only"}:${company}:${vault.id}`;
  const [tabs, setTabs] = useState<string[]>(() => { try { const saved = JSON.parse(loadDraft(scope + ":tabs") || "[]"); return Array.isArray(saved) ? saved.filter(id => typeof id === "string").slice(0, 100) : []; } catch { return []; } });
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({}), buffersRef = useRef(buffers);
  const [expanded, setExpanded] = useState(new Set<string>()), [selected, setSelected] = useState("");
  const [query, setQuery] = useState(""), [showTree, setShowTree] = useState(true), [showTrash, setShowTrash] = useState(false);
  const [modal, setModal] = useState<{ action: Action; item?: BrainTreeItem; trash?: BrainTrashItem } | null>(null);
  const [name, setName] = useState(""), [parentId, setParentId] = useState(""), [closing, setClosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null), treeRef = useRef<HTMLDivElement>(null);
  const can = (action: string) => (vault.actions?.includes("knowledge_" + action) && tree.data?.actions?.includes("knowledge_" + action)) ?? false;
  const tree = useQuery({ queryKey: [...key, "tree"], queryFn: ({ signal }) => brain.read<BrainTree>(company, vault.id, "knowledge_tree", {}, signal), retry: false });
  const trash = useQuery({ queryKey: [...key, "trash"], queryFn: ({ signal }) => brain.read<{ items: BrainTrashItem[] }>(company, vault.id, "knowledge_trash", {}, signal), enabled: showTrash, retry: false });
  const detail = useQuery({ queryKey: [...key, "document", documentId], queryFn: ({ signal }) => brain.read<BrainDocument>(company, vault.id, "knowledge_document", { id: documentId }, signal), enabled: !!documentId && !showTrash, retry: false });
  const items = tree.error ? [] : tree.data?.items ?? [], current = items.find(i => i.id === documentId), selectedItem = items.find(i => i.id === selected);
  const folders = items.filter(i => i.type === "folder" && i.canCreate);
  const rows = useMemo(() => explorerRows(items, expanded, query), [items, expanded, query]);
  const buffer = buffers[documentId], doc = tree.error || detail.error ? undefined : detail.data;
  const isText = doc?.contentType === "text/markdown" || doc?.contentType === "text/plain";
  const editable = !!current?.writable && can("save_document") && isText;
  const conflict = !!buffer?.dirty && !!doc && buffer.revision !== doc.revision;

  function putBuffer(id: string, value: Buffer) {
    buffersRef.current = { ...buffersRef.current, [id]: value }; setBuffers(buffersRef.current);
  }
  function persist() {
    for (const [id, value] of Object.entries(buffersRef.current)) if (value.dirty) {
      const serialized = JSON.stringify(value); saveDraft(scope + ":" + id, serialized);
      if (loadDraft(scope + ":" + id) !== serialized) setMessage("임시 입력을 브라우저에 보관할 수 없습니다. 서버에 저장해 주세요.");
    }
  }
  useEffect(() => {
    const timeout = setTimeout(persist, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [buffers, scope]);
  useEffect(() => {
    const flush = () => persist();
    const guard = (event: BeforeUnloadEvent) => { persist(); if (Object.values(buffersRef.current).some(b => b.dirty)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("pagehide", flush); window.addEventListener("beforeunload", guard);
    return () => { persist(); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", guard); };
  }, [scope]);
  useEffect(() => { saveDraft(scope + ":tabs", JSON.stringify(tabs)); }, [tabs, scope]);
  useEffect(() => {
    if (!documentId) return;
    setTabs(previous => previous.includes(documentId) ? previous : [...previous, documentId]);
    setSelected(documentId); setShowTrash(false);
  }, [documentId]);
  useEffect(() => {
    if (!detail.data || detail.error || detail.data.id !== documentId) return;
    const d = detail.data, existing = buffersRef.current[documentId];
    if (existing) {
      if (!existing.dirty && existing.revision !== d.revision) putBuffer(documentId, { ...existing, content: d.content ?? "", revision: d.revision });
      return;
    }
    let restored: Buffer | undefined;
    try {
      const value = vault.ownerId ? JSON.parse(loadDraft(scope + ":" + documentId) || "null") : null;
      if (value && typeof value.content === "string" && typeof value.revision === "string" && value.dirty === true) restored = { ...value, mode: "edit" };
    } catch { /* A corrupt browser draft never replaces a server document. */ }
    putBuffer(documentId, restored ?? { content: d.content ?? "", revision: d.revision, dirty: false, mode: "preview" });
    if (restored) setMessage("브라우저의 임시 입력을 복구했습니다. 서버에는 아직 저장하지 않았습니다.");
  }, [detail.data, detail.error, documentId, scope]);
  useEffect(() => {
    if (!tree.data) return;
    setExpanded(previous => new Set([...previous, ...tree.data.items.filter(i => i.parentId === null).map(i => i.id)]));
  }, [tree.data]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (editable && buffer?.dirty && !busy && !conflict) void save(documentId); }
    }
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  });
  async function refresh() { await cache.invalidateQueries({ queryKey: key }); }
  async function save(id: string) {
    const value = buffersRef.current[id]; if (!value?.dirty || !can("save_document")) return false;
    setBusy(true); setError("");
    try {
      const result = await brain.write<{ revision: string }>(company, vault.id, "knowledge_save_document", { id, content: value.content, expectedRevision: value.revision, operationId: operationId() });
      const now = buffersRef.current[id];
      putBuffer(id, { ...now, revision: result.revision, dirty: now.content !== value.content });
      if (now.content === value.content) clearDraft(scope + ":" + id); else persist();
      setMessage("서버에 저장했습니다."); await refresh(); return true;
    } catch (e) { setError(errorText(e)); await detail.refetch(); return false; }
    finally { setBusy(false); }
  }
  function open(id: string) { setShowTrash(false); onDocument(id); }
  function removeTab(id: string) {
    const next = tabs.filter(x => x !== id); setTabs(next);
    if (documentId === id) onDocument(next.at(-1) ?? "");
    setClosing(null);
  }
  function action(action: Action, item?: BrainTreeItem, trashed?: BrainTrashItem, target?: string) {
    const fallback = ["folder", "note", "copy"].includes(action) && item?.type === "folder" && item.canCreate ? item.id : item?.parentId;
    const restoreParent = trashed && items.find(i => i.type === "folder" && i.path === trashed.path.split("/").slice(0, -1).join("/"));
    setParentId(action === "restore" ? restoreParent?.id ?? "" : target ?? fallback ?? items.find(i => i.path === "Inbox")?.id ?? "");
    setName(action === "folder" ? "" : action === "note" ? "새 문서.md" : action === "copy" ? (doc?.title ?? "수정본") + " 수정본.md" : item?.name ?? trashed?.name ?? "");
    setError(""); setModal({ action, item, trash: trashed });
  }
  async function submit() {
    if (!modal) return;
    if (modal.action === "latest") {
      if (doc) { putBuffer(doc.id, { content: doc.content ?? "", revision: doc.revision, dirty: false, mode: "preview" }); clearDraft(scope + ":" + doc.id); }
      setModal(null); return;
    }
    const { action: kind, item, trash: trashed } = modal;
    const tools = { folder: "create_folder", note: "create_document", copy: "create_document", rename: "move", move: "move", trash: "trash_item", restore: "restore" };
    const args = kind === "folder" || kind === "note" || kind === "copy" ? { parentId, name, ...(kind === "copy" ? { copyFrom: documentId } : {}) }
      : kind === "restore" ? { trashId: trashed!.id, parentId, name }
        : { id: item!.id, expectedVersion: item!.version, ...(kind === "trash" ? {} : { parentId: kind === "rename" ? item!.parentId : parentId, name }) };
    setBusy(true); setError("");
    try {
      const result = await brain.write<{ id: string }>(company, vault.id, "knowledge_" + tools[kind], { ...args, operationId: operationId() });
      setModal(null); setMessage(labels[kind] + " complete");
      if (kind === "trash") {
        const affected = items.filter(x => x.id === item!.id || x.path.startsWith(item!.path + "/")).map(x => x.id);
        setTabs(previous => previous.filter(id => !affected.includes(id)));
        if (affected.includes(documentId)) onDocument("");
      } else if (["note", "copy", "restore"].includes(kind) && result.id) open(result.id);
      if (parentId) setExpanded(previous => new Set([...previous, parentId]));
      await refresh();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError("파일은 25MiB까지 업로드할 수 있습니다."); return; }
    const target = selectedItem?.canCreate ? selectedItem : items.find(i => i.id === selectedItem?.parentId) ?? items.find(i => i.path === "Inbox");
    if (!target?.canCreate) { setError("업로드할 폴더를 선택해 주세요."); return; }
    setBusy(true); setError("");
    try { const result = await brain.upload(company, vault.id, file, target.id, operationId()); await refresh(); open(result.id); setMessage("원본 파일을 저장하고 확인했습니다."); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); if (uploadRef.current) uploadRef.current.value = ""; }
  }
  function treeKey(event: React.KeyboardEvent, item: BrainTreeItem, index: number) {
    const focus = (id?: string) => { if (id) treeRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus(); };
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowDown") focus(rows[index + 1]?.item.id);
    if (event.key === "ArrowUp") focus(rows[index - 1]?.item.id);
    if (event.key === "Home") focus(rows[0]?.item.id);
    if (event.key === "End") focus(rows.at(-1)?.item.id);
    if (event.key === "ArrowRight" && item.type === "folder") {
      if (!expanded.has(item.id)) setExpanded(new Set([...expanded, item.id])); else focus(rows[index + 1]?.item.id);
    }
    if (event.key === "ArrowLeft") { if (expanded.has(item.id)) { const next = new Set(expanded); next.delete(item.id); setExpanded(next); } else focus(item.parentId ?? undefined); }
    if (event.key === "F2" && item.writable && can("move")) { event.preventDefault(); action("rename", item); }
    if (event.key === "Delete" && item.writable && can("trash_item")) { event.preventDefault(); action("trash", item); }
  }
  const treeContent = <aside className="kb-explorer" aria-label="File explorer">
    <div className="kb-explorer-heading"><strong>Explorer</strong><span>Personal Brain</span></div>
    <div className="kb-explorer-actions">
      <Button size="icon" variant="ghost" aria-label="New file" disabled={busy || !can("create_document")} onClick={() => action("note", selectedItem)}><FilePlus2 className="size-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="New folder" disabled={busy || !can("create_folder")} onClick={() => action("folder", selectedItem)}><FolderPlus className="size-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Upload file" disabled={busy || !can("upload")} onClick={() => uploadRef.current?.click()}><Upload className="size-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Refresh explorer" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-4" /></Button>
      <input ref={uploadRef} className="hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx" onChange={e => void upload(e.target.files?.[0])} />
    </div>
    <label className="kb-tree-search"><Search className="size-4" /><Input aria-label="Search folders and files" placeholder="Search folders and files" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {!tree.isLoading && !tree.error && (!vault.actions?.length || !tree.data?.actions?.length) && <p className="kb-readonly-hint">읽기 전용 연결입니다. 파일을 추가하려면 Apps에서 쓰기 권한이 있는 연결을 선택해 주세요.</p>}
    <div ref={treeRef} role="tree" aria-label="Folders and files" className="kb-tree">
      {tree.isLoading && <p role="status" className="p-3 text-sm">폴더 불러오는 중</p>}
      {!tree.isLoading && !tree.error && !rows.length && <p className="p-3 text-sm text-muted-foreground">{query ? "일치하는 폴더·파일이 없습니다." : "아직 자료가 없습니다."}</p>}
      {rows.map(({ item, depth }, index) => <ContextMenu.Root key={item.id}>
        <ContextMenu.Trigger asChild><button role="treeitem" aria-level={depth + 1} aria-selected={selected === item.id} aria-expanded={item.type === "folder" ? expanded.has(item.id) : undefined}
          tabIndex={selected === item.id || (!selected && index === 0) ? 0 : -1} data-tree-id={item.id}
          className={cn("kb-tree-row", selected === item.id && "active")} title={item.path}
          onFocus={() => setSelected(item.id)} onContextMenu={() => setSelected(item.id)} onKeyDown={e => treeKey(e, item, index)}
          onClick={() => { setSelected(item.id); if (item.type === "folder") { const next = new Set(expanded); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); setExpanded(next); } else open(item.id); }}
          draggable={item.writable && can("move")} onDragStart={e => e.dataTransfer.setData("application/x-dovix-knowledge", item.id)}
          onDragOver={e => { if (item.canCreate && can("move")) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const source = items.find(i => i.id === e.dataTransfer.getData("application/x-dovix-knowledge")); if (source?.writable && item.canCreate && can("move")) action("move", source, undefined, item.id); }}>
          {Array.from({ length: depth }, (_, i) => <span className="kb-tree-indent" aria-hidden key={i} />)}
          {item.type === "folder" ? <>{expanded.has(item.id) ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}<Folder className="size-4 shrink-0" /></> : <File className="size-4 shrink-0" />}
          <span className="truncate">{item.name}</span>{item.path.startsWith("Processed/") && <span className="kb-tree-derived">자동</span>}
        </button></ContextMenu.Trigger>
        <ContextMenu.Portal><ContextMenu.Content className="kb-context-menu">
          {item.canCreate && <><ContextMenu.Item disabled={!can("create_document")} onSelect={() => action("note", item)}>New file</ContextMenu.Item><ContextMenu.Item disabled={!can("create_folder")} onSelect={() => action("folder", item)}>New folder</ContextMenu.Item></>}
          <ContextMenu.Item disabled={!item.writable || !can("move")} onSelect={() => action("rename", item)}>Rename</ContextMenu.Item>
          <ContextMenu.Item disabled={!item.writable || !can("move")} onSelect={() => action("move", item)}>Move</ContextMenu.Item>
          <ContextMenu.Item disabled={!item.writable || !can("trash_item")} onSelect={() => action("trash", item)}>Move to Trash</ContextMenu.Item>
        </ContextMenu.Content></ContextMenu.Portal>
      </ContextMenu.Root>)}
    </div>
    <Button variant="ghost" className="kb-trash-button" aria-pressed={showTrash} onClick={() => setShowTrash(!showTrash)}><Trash2 className="size-4" />Trash</Button>
  </aside>;
  const reader = <article className="kb-editor" aria-label="Document workspace">
    <div className="kb-document-tabs" role="tablist" aria-label="Open documents">
      <Button variant="ghost" size="icon" aria-label="Toggle explorer" onClick={() => setShowTree(!showTree)}><PanelLeft className="size-4" /></Button>
      {tabs.map(id => <div key={id} className={cn("kb-document-tab", documentId === id && !showTrash && "active")}>
        <button role="tab" aria-selected={documentId === id && !showTrash} onClick={() => open(id)}>{items.find(i => i.id === id)?.name ?? (id === doc?.id ? doc.title : "문서")}{buffers[id]?.dirty && <span aria-label="미저장"> ●</span>}</button>
        <button aria-label={`${items.find(i => i.id === id)?.name ?? "문서"} Close tab`} disabled={busy} onClick={() => buffers[id]?.dirty ? setClosing(id) : removeTab(id)}><X className="size-3" /></button>
      </div>)}
    </div>
    {showTrash ? <div className="kb-reader-content"><h2>Trash</h2><p className="text-sm text-muted-foreground">파일과 폴더를 원래 위치로 복원할 수 있습니다.</p>{trash.error && <p role="alert">{errorText(trash.error)}</p>}{trash.isLoading && <p role="status">휴지통 불러오는 중</p>}{trash.data?.items.map(t => <div className="kb-trash-row" key={t.id}><div><strong>{t.name}</strong><p>{t.path}</p></div><Button size="sm" variant="outline" disabled={!can("restore") || busy} onClick={() => action("restore", undefined, t)}>Restore</Button></div>)}{trash.data?.items.length === 0 && <p className="text-sm">휴지통이 비어 있습니다.</p>}</div>
      : tree.error || detail.error ? <div role="alert" className="p-5">{errorText(tree.error ?? detail.error)}<Button variant="outline" onClick={() => void refresh()}>Retry</Button></div>
        : !documentId ? <div className="kb-editor-empty"><Folder className="size-8" /><h2>Library</h2><p>왼쪽에서 폴더를 펼치고 파일을 열어 보세요.</p><Button variant="outline" disabled={!can("create_document")} onClick={() => action("note")}>New file</Button></div>
          : detail.isLoading ? <p role="status" className="p-5">문서 불러오는 중</p> : doc && <>
            <div className="kb-editor-toolbar"><span className="truncate" title={doc.path}>{current?.path ?? doc.path}</span><div className="flex flex-wrap items-center gap-1">
              {isText && buffer && ["edit", "preview", "split"].map(mode => <Button key={mode} variant={buffer.mode === mode ? "secondary" : "ghost"} size="sm" disabled={!editable && mode !== "preview"} onClick={() => putBuffer(documentId, { ...buffer, mode: mode as Mode })}>{mode === "edit" ? "Edit" : mode === "preview" ? "Preview" : "Split"}</Button>)}
              {editable && <Button size="sm" disabled={busy || !buffer?.dirty || conflict} onClick={() => void save(documentId)}><Save className="size-3" />Save</Button>}
              {doc.kind === "generated" && <Button size="sm" variant="outline" disabled={!can("create_document") || busy} onClick={() => action("copy")}>Create editable copy</Button>}
            </div></div>
            {conflict && <div role="alert" className="kb-conflict">다른 곳에서 수정되었습니다. 임시 입력은 보관 중입니다.<Button size="sm" variant="outline" onClick={() => action("latest")}>Review latest source</Button></div>}
            <div className={cn("kb-editor-body", editable && buffer?.mode === "split" && "kb-editor-split")}>
              {isText && editable && buffer && buffer.mode !== "preview" && <Textarea aria-label="문서 Markdown 편집" className="kb-source-editor" value={buffer.content} onChange={e => { putBuffer(documentId, { ...buffer, content: e.target.value, dirty: true }); setMessage("브라우저 임시 입력 · 서버 미저장"); }} />}
              {(!editable || buffer?.mode !== "edit") && <div className="kb-reader-content">
                {doc.kind === "generated" && <p className="knowledge-generated-note">자동 정리된 원본입니다. 수정본을 만들어 편집할 수 있습니다.</p>}
                {doc.state === "stale" ? <p role="status">원본이 변경되어 정리 내용을 갱신하고 있습니다.</p> : isText ? <MarkdownBody>{editable && buffer ? buffer.content : doc.content ?? ""}</MarkdownBody>
                  : <>{doc.contentType.startsWith("image/") ? <img className="knowledge-original-image" src={brain.file(company, vault.id, doc)} alt={doc.title} /> : doc.contentType === "application/pdf" ? <iframe className="knowledge-original-pdf" title={doc.title} src={brain.file(company, vault.id, doc)} /> : <p>이 형식은 원본 파일로 확인해 주세요.</p>}<Button variant="outline" asChild><a href={brain.file(company, vault.id, doc, true)}>Download original</a></Button></>}
                {!!doc.references?.length && <div className="knowledge-inline-sources"><h3>이 지식의 근거</h3>{doc.references.map(ref => <button key={ref.sourceId} className="knowledge-source-card" onClick={() => open(ref.docId)}><strong>{ref.path.split("/").at(-1)}</strong><small>{ref.locator ?? ref.path}</small></button>)}</div>}
              </div>}
            </div>
          </>}
    <div className="kb-editor-status" role="status">{busy ? "처리 중…" : message || (doc?.kind === "generated" ? "자동 정리 · 읽기 전용" : "Personal Brain")}</div>
  </article>;
  return <div className="kb-workspace">
    {error && !modal && <p role="alert" className="knowledge-alert">{error}</p>}
    <ResizablePanelGroup orientation="horizontal" className="kb-panels">
      {showTree && <><ResizablePanel defaultSize="32%" minSize="24%" maxSize="50%" className="kb-tree-panel">{treeContent}</ResizablePanel><ResizableHandle className="kb-resize-handle" /></>}
      <ResizablePanel minSize="40%">{reader}</ResizablePanel>
    </ResizablePanelGroup>
    <Dialog open={!!modal} onOpenChange={open => { if (!open && !busy) setModal(null); }}><DialogContent><DialogHeader><DialogTitle>{modal && labels[modal.action]}</DialogTitle><DialogDescription>{modal?.action === "trash" ? "내용을 보존해 휴지통으로 이동합니다. 하위 폴더와 파일도 함께 이동합니다." : modal?.action === "latest" ? "최신 원문을 확인하고 선택하세요. 최신본 사용을 누르면 현재 임시 입력을 버립니다." : "Personal Brain의 실제 폴더와 파일에 반영합니다."}</DialogDescription></DialogHeader>
      {modal?.action === "latest" ? <div className="kb-conflict-preview"><MarkdownBody>{doc?.content ?? ""}</MarkdownBody></div> : modal?.action !== "trash" && <>
        <label className="grid gap-2 text-sm">이름<Input aria-label="이름" autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
        {modal?.action !== "rename" && <label className="grid gap-2 text-sm">위치<select className="knowledge-select" aria-label="Destination folder" value={parentId} onChange={e => setParentId(e.target.value)}><option value="" disabled>Select a folder</option>{folders.filter(f => modal?.item?.type !== "folder" || (f.id !== modal.item.id && !f.path.startsWith(modal.item.path + "/"))).map(f => <option key={f.id} value={f.id}>{f.path}</option>)}</select></label>}
      </>}
      {modal?.action === "trash" && <p className="text-sm">{modal.item?.path}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</Button><Button disabled={busy || (modal?.action !== "trash" && modal?.action !== "latest" && (!name.trim() || !parentId))} onClick={() => void submit()}>{modal?.action === "latest" ? "Use latest version" : "Confirm"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!closing} onOpenChange={open => { if (!open && !busy) setClosing(null); }}><DialogContent><DialogHeader><DialogTitle>변경 내용을 저장할까요?</DialogTitle><DialogDescription>서버에 저장하지 않은 내용이 있습니다.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setClosing(null)}>Cancel</Button><Button variant="outline" disabled={busy} onClick={() => { if (closing) { clearDraft(scope + ":" + closing); delete buffersRef.current[closing]; setBuffers({ ...buffersRef.current }); removeTab(closing); } }}>Discard</Button><Button disabled={busy || !can("save_document")} onClick={async () => { if (closing && await save(closing)) removeTab(closing); }}>Save and close</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
