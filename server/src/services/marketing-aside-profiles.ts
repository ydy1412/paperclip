import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { badRequest } from "../errors.js";

export interface MarketingAsideProfile {
  asideAccountId: string;
  browserProfileName: string;
  signedIn: boolean;
}
export function parseMarketingAsideProfiles(output: string): MarketingAsideProfile[] {
  const rows: MarketingAsideProfile[] = [];
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    const match = line.match(/^\s*\*?\s*(u\d{1,6})\s+.+?\s+(signed in|signed out)\s+profiles:\s*(.+?)\s*$/);
    if (!match) continue;
    const names = match[3].split(",").map(value => value.trim()).filter(Boolean);
    // Current exec CLI selects an account, not an arbitrary Chrome profile.
    // Ambiguous account bindings cannot authorize a chosen profile.
    if (names.length !== 1) continue;
    rows.push({ asideAccountId: match[1], browserProfileName: names[0], signedIn: match[2] === "signed in" });
  }
  return rows;
}
export async function marketingAsideProfiles(): Promise<MarketingAsideProfile[]> {
  const result = await promisify(execFile)("aside", ["account", "list"], { timeout: 10000, maxBuffer: 65536, encoding: "utf8" });
  const rows = parseMarketingAsideProfiles(result.stdout);
  if (!rows.length) throw badRequest("Aside에 연결된 단일 브라우저 프로필을 확인할 수 없습니다.");
  return rows;
}
export function assertMarketingAsideBinding(rows: MarketingAsideProfile[], binding: { asideAccountId: string; browserProfileName: string }) {
  if (!rows.some(row => row.signedIn && row.asideAccountId === binding.asideAccountId && row.browserProfileName === binding.browserProfileName)) {
    throw badRequest("선택한 Aside 계정과 Chrome 프로필의 실제 연결을 확인할 수 없습니다.");
  }
}
