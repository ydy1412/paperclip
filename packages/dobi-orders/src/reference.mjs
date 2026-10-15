/** Validate imported/operator-managed configuration before it can reach UI links. */
export function validateReference(key, value) {
  const invalid = () => { throw new Error('목록 데이터를 확인해주세요.'); };
  if (key !== 'catalog') {
    if (!['carriers', 'channels'].includes(key) || !Array.isArray(value) || value.length > 1000 || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 200)) invalid();
    return value;
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.providers) || value.providers.length > 5000
    || ['__proto__', 'constructor', 'prototype'].some(k => Object.hasOwn(value, k))) invalid();
  const seen = new Set();
  for (const provider of value.providers) {
    if (!provider || typeof provider.id !== 'string' || !provider.id || seen.has(provider.id)
      || typeof provider.name !== 'string' || !['market', 'forwarder'].includes(provider.kind)) invalid();
    seen.add(provider.id);
    for (const field of ['browserUrl', 'homepageUrl', 'loginUrl']) if (provider[field]) {
      let url; try { url = new URL(provider[field]); } catch { invalid(); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid();
    }
  }
  return value;
}
