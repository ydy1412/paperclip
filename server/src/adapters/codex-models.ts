import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterModel } from "./types.js";

/** Read the installed Codex catalog, which already reflects its signed-in account. */
export async function listCodexModels(): Promise<AdapterModel[]> {
  const home = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  let contents: string;
  try {
    contents = await readFile(path.join(home, "models_cache.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Codex 모델 목록을 읽지 못했습니다.", { cause: error });
  }
  let payload: { models?: unknown };
  try { payload = JSON.parse(contents); }
  catch (error) { throw new Error("Codex 모델 목록 형식을 확인해 주세요.", { cause: error }); }
  if (!payload || !Array.isArray(payload.models)) throw new Error("Codex 모델 목록 형식을 확인해 주세요.");
  const seen = new Set<string>();
  const models: AdapterModel[] = [];
  for (const entry of payload.models) {
    if (!entry || typeof entry !== "object" || entry.visibility === "hide" || typeof entry.slug !== "string") continue;
    const id = entry.slug.trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    const label = typeof entry.display_name === "string" ? entry.display_name.trim() : "";
    const reasoningEfforts = Array.isArray(entry.supported_reasoning_levels)
      ? [...new Set<string>(entry.supported_reasoning_levels.flatMap((level: unknown) => {
          if (!level || typeof level !== "object" || !("effort" in level)) return [];
          const effort = level.effort;
          return typeof effort === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(effort) ? [effort] : [];
        }))]
      : undefined;
    models.push({ id, label: label || id, ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}) });
  }
  return models;
}

// There is no process-local catalog cache: refresh always rereads the CLI file.
export async function refreshCodexModels(): Promise<AdapterModel[]> {
  return listCodexModels();
}
