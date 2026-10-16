export const knowledgeViews = [
  { id: "library", label: "Library", path: "" },
  { id: "ask", label: "Ask & Search", path: "/ask" },
  { id: "graph", label: "Knowledge Graph", path: "/graph" },
] as const;

export function getKnowledgeView(pathname: string, legacyGraph = false) {
  return knowledgeViews.find(view => view.path && pathname.endsWith(view.path))
    ?? knowledgeViews[legacyGraph ? 2 : 0];
}
