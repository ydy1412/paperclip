import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { validateMarketingPostedUrl, type MarketingAccount } from "./marketing-publication.js";

const marker = "PAPERCLIP_NAVER_POST ";
const postSchema = z.object({
  url: z.string().url(), postId: z.string().regex(/^\d+$/),
  title: z.string().max(2000), body: z.string().max(240000),
  titleCount: z.literal(1), bodyCount: z.literal(1),
  imageCount: z.number().int().nonnegative(), videoCount: z.number().int().nonnegative(),
  embedCount: z.number().int().nonnegative(),
  publishedAtText: z.string().max(200),
}).strict();

export function parseMarketingNaverPost(output: string, account: MarketingAccount, expectedPostId: string) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split("\n").filter(line => line.includes(marker));
  if (lines.length !== 1 || /\[error\s*\|/.test(clean)) throw new HttpError(503, "네이버 게시글을 확인할 수 없습니다.");
  let value: unknown;
  try { value = JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length)); } catch { throw new HttpError(503, "네이버 게시글 확인 결과를 읽을 수 없습니다."); }
  const parsed = postSchema.safeParse(value);
  if (!parsed.success || parsed.data.postId !== expectedPostId) throw new HttpError(503, "네이버 게시글 본문 범위가 불명확합니다.");
  const canonical = validateMarketingPostedUrl(account, parsed.data.url);
  const final = new URL(canonical);
  const finalId = final.searchParams.get("logNo") || final.pathname.split("/").at(-1);
  if (finalId !== expectedPostId) throw new HttpError(503, "네이버 게시글 주소가 변경됐습니다.");
  return parsed.data;
}

export function marketingNaverTextMatches(post: z.infer<typeof postSchema>, content: { title: string; body: string; media: unknown[] }) {
  const rendered = (text: string) => text.replace(/\r\n?/g, "\n").trim();
  return content.media.length === 0 && post.imageCount === 0 && post.videoCount === 0 && post.embedCount === 0
    && rendered(post.title) === rendered(content.title) && rendered(post.body) === rendered(content.body);
}

export function marketingNaverPublicationTime(value: string) {
  const match = value.trim().match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute) return null;
  return new Date(local.getTime() - 9 * 60 * 60 * 1000);
}

export async function readMarketingNaverPost(asideAccountId: string, account: MarketingAccount, postedUrl: string) {
  if (!/^u\d{1,6}$/.test(asideAccountId) || account.platform !== "naver_blog") throw new HttpError(400, "명시적인 네이버 Aside 계정이 필요합니다.");
  const validated = new URL(validateMarketingPostedUrl(account, postedUrl));
  const postId = validated.searchParams.get("logNo") || validated.pathname.split("/").at(-1)!;
  const url = `https://blog.naver.com/${account.accountId}/${postId}`;
  const code = `const p=await openTab(${JSON.stringify(url)});try{const v=await p.evaluate((id)=>{const d=document.querySelector("iframe")?.contentDocument||document;const area=d.getElementById("post-view"+id);const root=area?.closest(".post");const titles=root?.querySelectorAll(".se-title-text")||[];const bodies=area?.querySelectorAll(".se-main-container")||[];const body=bodies[0];return {postId:id,title:titles[0]?.innerText||"",body:body?.innerText||"",titleCount:titles.length,bodyCount:bodies.length,imageCount:body?.querySelectorAll("img").length||0,videoCount:body?.querySelectorAll("video").length||0,embedCount:body?.querySelectorAll("iframe,object,embed").length||0,publishedAtText:root?.querySelector(".se_publishDate")?.innerText||""};},${JSON.stringify(postId)});console.log(${JSON.stringify(marker)}+JSON.stringify({...v,url:p.url()}));}finally{await closeTab(p);}`;
  try {
    const result = await promisify(execFile)("aside", ["--account", asideAccountId, "repl", code], { timeout: 40000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
    return parseMarketingNaverPost(result.stdout, account, postId);
  } catch { throw new HttpError(503, "네이버의 실제 게시글 내용 확인을 완료하지 못했습니다. 재게시하지 마십시오."); }
}
