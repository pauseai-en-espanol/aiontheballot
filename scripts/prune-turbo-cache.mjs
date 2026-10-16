#!/usr/bin/env node
// Keeps in .turbo/cache only what this CI run's tasks used, so the Turborepo cache saved for the next run doesn't
// grow with every run (it had reached a gigabyte: minutes to restore and to save). Every turbo command writes a run
// summary when TURBO_RUN_SUMMARY is set; an entry none of them names belongs to an older run. Anything the next run
// needs and lost is just rebuilt, so this can only cost time, never correctness.
//
// Usage: prune-turbo-cache.mjs <file listing the entries the restore brought, one per line>
// Writes `changed=true|false` to $GITHUB_OUTPUT: whether the run added entries, so an unchanged cache isn't saved again.
import { appendFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE = '.turbo/cache';
const RUNS = '.turbo/runs';
// <hash>.tar.zst, <hash>-meta.json, <hash>-manifest.json: one task's output under its hash.
const ENTRY = /^([0-9a-f]{16})(?:\.tar\.zst|-meta\.json|-manifest\.json)$/;

const [restoredList] = process.argv.slice(2);
if (!restoredList) {
  console.error('usage: prune-turbo-cache.mjs <restored entries file>');
  process.exit(1);
}

const used = new Set();
for (const file of await readdir(RUNS).catch(() => [])) {
  if (!file.endsWith('.json')) {
    continue;
  }
  try {
    const summary = JSON.parse(await readFile(join(RUNS, file), 'utf8'));
    for (const task of summary.tasks ?? []) {
      if (typeof task.hash === 'string') {
        used.add(task.hash);
      }
    }
  } catch {
    // An unreadable summary names nothing; with none readable, the warning below keeps the cache as it is.
  }
}
// No summary means the run didn't record what it used: neither empty the cache nor save it whole (CI stays green).
if (used.size === 0) {
  console.log(
    `::warning::No run summary in ${RUNS}: the Turborepo cache is neither pruned nor saved`,
  );
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, 'changed=false\n');
  }
  process.exit(0);
}

const restored = new Set(
  (await readFile(restoredList, 'utf8').catch(() => '')).split('\n').filter(Boolean),
);
let kept = 0;
let removed = 0;
let added = 0;
let unknown = 0;
for (const entry of await readdir(CACHE).catch(() => [])) {
  const hash = ENTRY.exec(entry)?.[1];
  if (hash === undefined) {
    unknown += 1;
  }
  if (hash !== undefined && used.has(hash)) {
    kept += 1;
    if (!restored.has(entry)) {
      added += 1;
    }
  } else {
    await rm(join(CACHE, entry), { recursive: true, force: true });
    removed += 1;
  }
}
await rm(RUNS, { recursive: true, force: true });
console.log(`Turborepo cache: kept ${kept} files (${added} new), removed ${removed}`);
// Turbo named its entries differently (a new version?): this would empty the cache on every run.
if (kept === 0 || unknown > 0) {
  console.log(
    `::warning::The Turborepo cache kept ${kept} entries and found ${unknown} it doesn't recognise: check prune-turbo-cache.mjs against turbo's cache layout`,
  );
}
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${added > 0}\n`);
}
