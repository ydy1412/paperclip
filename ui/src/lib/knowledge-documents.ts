import type { BrainVault } from "../api/knowledgeWorkspace";

export function documentProjects(content: string): string[] {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (!header) return [];
  const multiple = /^projects:[ \t]*(.*)$/m.exec(header)?.[1]?.trim();
  if (multiple) {
    try { const names = JSON.parse(multiple); if (Array.isArray(names) && names.every(n => typeof n === "string")) return names; } catch { /* Read the single-project format below. */ }
  }
  const single = /^project:[ \t]*(.*)$/m.exec(header)?.[1]?.trim();
  if (!single) return [];
  try { return [single.startsWith('"') ? JSON.parse(single) : single]; } catch { return []; }
}

export function withDocumentProjects(content: string, input: string): string {
  const names = [...new Set(input.split(",").map(n => n.trim()).filter(Boolean))];
  if (names.length > 20 || names.some(n => n.length > 120 || /[\x00-\x1f]/.test(n))) throw new Error("프로젝트는 최대 20개, 이름은 120자 이내로 입력해 주세요.");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const header = match?.[1].split(/\r?\n/) ?? [];
  if (header.some((line, index) => /^projects:\s*$/.test(line) && /^\s*-\s/.test(header[index + 1] ?? ""))) throw new Error("여러 줄로 된 projects 속성은 Markdown 편집에서 수정해 주세요.");
  const fields = header.filter(line => !/^projects?:/.test(line));
  if (names.length) fields.push(`projects: ${JSON.stringify(names)}`);
  if (fields.join("\n").length > 4090) throw new Error("문서 속성이 너무 길어 프로젝트를 저장할 수 없습니다. Markdown 속성을 줄여 주세요.");
  const body = match ? content.slice(match[0].length) : content;
  return fields.length ? `---${newline}${fields.join(newline)}${newline}---${newline}${body}` : body;
}

// Only provider-confirmed vault identities can merge connection choices.
export function visibleBrainVaults(vaults: BrainVault[], selected?: string | null): BrainVault[] {
  const groups = new Map<string, BrainVault[]>();
  for (const vault of vaults) {
    const key = vault.vaultId && vault.ownerId ? `${vault.ownerId}:${vault.vaultId}` : vault.id;
    groups.set(key, [...(groups.get(key) ?? []), vault]);
  }
  return [...groups.values()].map(group => group.find(v => v.id === selected)
    ?? [...group].sort((a, b) => (b.actions?.length ?? 0) - (a.actions?.length ?? 0))[0]);
}
