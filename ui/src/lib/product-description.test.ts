// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { productDescriptionDocument } from "./product-description";

describe("product HTML preview", () => {
  it("keeps text, tables and safe images while removing executable markup and navigation", () => {
    const html = productDescriptionDocument(`<p onclick="alert(1)" style="position:fixed">설명 <strong>굵게</strong></p><script>alert(1)</script><iframe srcdoc="bad"></iframe><form action="/api"><input></form><svg onload="bad"></svg><a href="javascript:alert(1)">링크</a><img src="http://example.test/a.jpg" onerror="bad"><img src="data:text/html,bad"><img src="https://u:p@example.test/b"><table><tr><td colspan="2">옵션</td></tr></table>`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toBe("설명 굵게링크옵션"); expect(doc.body.querySelector("script,iframe,form,input,svg,a,[onclick],[onerror],[style]")).toBeNull();
    expect(doc.body.querySelectorAll("img")).toHaveLength(1); expect(doc.body.querySelector("img")?.getAttribute("src")).toBe("https://example.test/a.jpg");
    expect(doc.body.querySelector("td")?.getAttribute("colspan")).toBe("2");
    expect(doc.head.querySelector('[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'");
  });
  it("preserves line breaks and handles malformed untrusted HTML as an inert document", () => {
    const html = productDescriptionDocument("첫 줄\n둘째 줄 <img src=javascript:alert(1)><math><mtext><img src=x onerror=bad></mtext></math><!--ignore-->");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.querySelector("br")).not.toBeNull(); expect(doc.body.textContent).toContain("첫 줄둘째 줄");
    expect(doc.body.querySelector("img,math,[onerror]")).toBeNull();
  });
});
