import { readFileSync } from 'node:fs';
export const integrationCatalog=JSON.parse(readFileSync(new URL('./catalog.json',import.meta.url),'utf8'));
