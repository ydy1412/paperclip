import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { badRequest, HttpError } from "../errors.js";
import { assertMarketingAsideBinding, marketingAsideProfiles, type MarketingAsideProfile } from "./marketing-aside-profiles.js";

const marker = "PAPERCLIP_NAVER_ACCOUNT ";
export function parseMarketingNaverAccount(output: string) {
  if (/\[error\s*\|/.test(output)) throw new HttpError(503, "Aside에서 네이버 계정을 확인하지 못했습니다.");
  const line = output.split("\n").find(line => line.startsWith(marker));
  if (!line) throw new HttpError(503, "네이버 계정 확인 결과가 없습니다.");
  let value: unknown;
  try { value = JSON.parse(line.slice(marker.length)); } catch { throw new HttpError(503, "네이버 계정 확인 결과를 읽을 수 없습니다."); }
  const result = z.object({ url: z.string().url() }).strict().safeParse(value);
  if (!result.success) throw new HttpError(503, "네이버 계정 확인 결과가 올바르지 않습니다.");
  const url = new URL(result.data.url);
  if (url.protocol !== "https:" || !["blog.naver.com", "m.blog.naver.com"].includes(url.hostname) || url.username || url.password || url.port) {
    return { signedIn: false as const, accountId: null, accountUrl: null };
  }
  const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
  if (!match || /\.naver$/.test(match[1]) || ["MyBlog", "Login"].includes(match[1])) return { signedIn: false as const, accountId: null, accountUrl: null };
  return { signedIn: true as const, accountId: match[1], accountUrl: `https://blog.naver.com/${match[1]}` };
}
export async function checkMarketingNaverAccount(binding: Pick<MarketingAsideProfile, "asideAccountId" | "browserProfileName">) {
  if (!/^u\d{1,6}$/.test(binding.asideAccountId)) throw badRequest("유효한 Aside 계정이 필요합니다.");
  assertMarketingAsideBinding(await marketingAsideProfiles(), binding);
  const code = `const p=await openTab("https://blog.naver.com/MyBlog.naver");try{console.log(${JSON.stringify(marker)}+JSON.stringify({url:p.url()}));}finally{await closeTab(p);}`;
  let output: string;
  try { output = (await promisify(execFile)("aside", ["--account", binding.asideAccountId, "repl", code], { timeout: 30000, maxBuffer: 65536, encoding: "utf8" })).stdout; }
  catch { throw new HttpError(503, "Aside 연결 상태를 확인하십시오. 네이버 계정 확인이 완료되지 않았습니다."); }
  return { ...parseMarketingNaverAccount(output), checkedAt: new Date().toISOString() };
}
