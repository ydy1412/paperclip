import { expect, it } from "vitest";
import { composeDetailHtml } from "./product-detail-composition";

it("preserves the body and image order without repeating existing normalized notice URLs", () => {
  const top = "https://images.example.test/top.png?a=1&b=2";
  const bottom = "https://images.example.test/bottom.png";
  const body = '<p>원본문</p><img src="//images.example.test/top.png?a=1&amp;b=2">';
  expect(composeDetailHtml(body, [top, top], [bottom, top])).toBe(body + '\n<img src="' + bottom + '" alt="공지 이미지">');
  const composed = composeDetailHtml("원본문", [top], [bottom]);
  expect(composed.indexOf("top.png")).toBeLessThan(composed.indexOf("원본문"));
  expect(composed.indexOf("bottom.png")).toBeGreaterThan(composed.indexOf("원본문"));
  expect(composed).toContain("?a=1&amp;b=2");
});
