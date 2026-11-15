// Merges cameras from a remote build (e.g. the GitHub US-network artifact) into public/data/cameras.json.
// For each source in GEO_BLOCKED (from .env or the environment), the remote cams replace the local ones.
//   gh run download <run-id> --repo <owner>/lookout --name cameras --dir tmp-remote
//   node scripts/merge-remote.mjs tmp-remote/cameras.json
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'cameras.json');
try {
  for (const line of (await readFile(join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/merge-remote.mjs <remote cameras.json>'); process.exit(1); }
const sources = new Set((process.env.GEO_BLOCKED || '').split(',').map(s => s.trim()).filter(Boolean));
if (!sources.size) { console.error('Set GEO_BLOCKED in .env (e.g. GEO_BLOCKED=ca,ut,wi,cars_co,mo)'); process.exit(1); }

const remote = JSON.parse(await readFile(file, 'utf8'));
const local = JSON.parse(await readFile(OUT, 'utf8'));
const incoming = remote.cams.filter(c => sources.has(c.s));
const kept = local.cams.filter(c => !sources.has(c.s));
const by = {};
for (const c of incoming) by[c.s] = (by[c.s] || 0) + 1;
local.cams = kept.concat(incoming);
local.sources = { ...local.sources, ...Object.fromEntries(Object.entries(remote.sources).filter(([k]) => sources.has(k))) };
await writeFile(OUT, JSON.stringify(local));
console.log(`Merged from remote: ${JSON.stringify(by)}. cameras.json now has ${local.cams.length} cams.`);
