import type { MarketingDraft, MarketingMediaChoice } from "@paperclipai/shared";

export function MarketingDraftAuthor({ draft }: { draft: MarketingDraft }) {
  return <span aria-label="초안 작성자" data-author-kind={draft.author ? draft.author.agentId ? "agent" : "operator" : "unknown"} className="marketing-author-tag rounded-md border border-border px-2 py-1 text-xs break-words">
    {draft.author ? `작성: ${draft.author.name}` : "작성자 미확인"}
  </span>;
}

export function MarketingDraftDetail({ draft, choices, channelName, status }: {
  draft: MarketingDraft; choices: MarketingMediaChoice[]; channelName: string; status: string;
}) {
  return <article aria-label="선택한 글 상세" className="min-w-0 space-y-5">
    <header className="min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">글 상세</p>
      <h2 className="break-words text-lg font-semibold">{draft.content.title || draft.topic}</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MarketingDraftAuthor draft={draft} /><span className="break-words">{channelName}</span><span>버전 {draft.revision}</span><span>{status}</span>
      </div>
      <p className="break-words text-xs text-muted-foreground">소재: {draft.topic}</p>
    </header>
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{draft.content.body}</p>
    <div className="grid min-w-0 gap-4">{draft.content.media.map(media => {
      const item = choices.find(choice => choice.attachmentId === media.attachmentId);
      return <figure key={media.attachmentId} className="min-w-0 space-y-2">
        {!item ? <p className="text-sm text-destructive">첨부 자료에 접근할 수 없습니다.</p> : item.contentType.startsWith("image/") ?
          <img src={item.href} alt={media.alt || item.title} className="max-h-96 max-w-full rounded-md object-contain" /> :
          <video src={item.href} aria-label={media.alt || item.title} controls preload="metadata" className="max-h-96 max-w-full rounded-md" />}
        <figcaption className="break-words text-xs text-muted-foreground">{media.alt || item?.title || "첨부 자료"}</figcaption>
      </figure>;
    })}</div>
  </article>;
}
