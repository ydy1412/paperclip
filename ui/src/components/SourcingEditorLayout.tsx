import type { ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable-panels";

export function SourcingEditorLayout({ children }: { children: [ReactNode, ReactNode] }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "commerce-product-editor", onlySaveAfterUserInteractions: true });
  return <ResizablePanelGroup orientation="horizontal" className="commerce-editor-layout commerce-resizable-layout" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
    <ResizablePanel id="commerce-list" defaultSize="32%" minSize="18%" maxSize="60%" className="commerce-list-pane">{children[0]}</ResizablePanel>
    <ResizableHandle aria-label="상품 목록과 상세 영역 너비 조절" title="드래그하거나 방향키로 상세 영역 너비 조절" className="commerce-resize-handle" />
    <ResizablePanel id="commerce-detail" minSize="40%" className="commerce-detail-pane">{children[1]}</ResizablePanel>
  </ResizablePanelGroup>;
}
