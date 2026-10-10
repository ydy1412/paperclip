import { useState } from "react";
import { productDescriptionDocument } from "../lib/product-description";
import { Button } from "./ui/button";

export function ProductDescription({ value, onChange }: { value: string; onChange?: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  return <section aria-label="상품 상세 설명" className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">상세 설명</h3><div className="flex gap-2">
      <Button type="button" size="sm" variant={!editing ? "secondary" : "outline"} aria-pressed={!editing} onClick={() => setEditing(false)}>미리보기</Button>
      {onChange && <Button type="button" size="sm" variant={editing ? "secondary" : "outline"} aria-pressed={editing} onClick={() => setEditing(true)}>HTML 편집</Button>}
    </div></div>
    {editing && onChange ? <textarea aria-label="상세 설명" className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground" rows={12} maxLength={200000} value={value} onChange={e => onChange(e.target.value)} />
      : value ? <iframe title="상세 설명 미리보기" sandbox="" referrerPolicy="no-referrer" srcDoc={productDescriptionDocument(value)} className="h-96 w-full rounded-md border border-border bg-background" /> : <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">상세 설명이 없습니다.</p>}
  </section>;
}
