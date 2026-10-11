const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const allowedTags = new Set("div p span section article h1 h2 h3 h4 h5 h6 strong b em i u s br hr ul ol li table thead tbody tfoot tr td th img blockquote".split(" "));
const removedTags = new Set("script style iframe object embed form input button textarea select meta link base svg math video audio".split(" "));
/** The preview has no application origin, scripts, links, forms or provider HTML styles. */
export function productDescriptionDocument(description: string): string {
  let content = escape(description).replace(/\n/g, "<br>");
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(description, "text/html");
    const render = (node: Node): string => {
      if (node.nodeType === 3) return escape(node.textContent ?? "").replace(/\n/g, "<br>");
      if (node.nodeType !== 1) return "";
      const element = node as Element; const tag = element.tagName.toLowerCase();
      if (removedTags.has(tag)) return "";
      const children = [...element.childNodes].map(render).join("");
      if (!allowedTags.has(tag)) return children;
      if (tag === "img") {
        try {
          const src = (element.getAttribute("src") ?? "").trim();
          // Provider detail HTML can use network-path references without a scheme.
          const url = new URL(/^\/\/[^/\\]/.test(src) ? `https:${src}` : src);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
          if (url.protocol === "http:") url.protocol = "https:";
          return `<img src="${escape(url.href)}" alt="${escape(element.getAttribute("alt") ?? "")}" loading="lazy" referrerpolicy="no-referrer">`;
        } catch { return ""; }
      }
      if (tag === "br" || tag === "hr") return `<${tag}>`;
      const span = ["td", "th"].includes(tag) ? ["colspan", "rowspan"].map(key => {
        const value = element.getAttribute(key); return value && /^\d{1,2}$/.test(value) ? ` ${key}="${value}"` : "";
      }).join("") : "";
      return `<${tag}${span}>${children}</${tag}>`;
    };
    content = [...doc.body.childNodes].map(render).join("");
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}</style></head><body>${content}</body></html>`;
}
