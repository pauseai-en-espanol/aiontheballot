#!/usr/bin/env node
// Mutation check (`pnpm test:mutation <list> [--only <text>]`; PLAN R137): breaks each rule in turn and expects a test
// to fail. A list is a JSON array in scripts/mutations/ (or any path) of mutations:
//
//   { "name": "what breaks", "file": "path from the root", "old": "exact text", "new": "its replacement",
//     "cmd": "a shell command that must fail", "cwd": "folder to run it in (the root by default)",
//     "before": "run once with the mutation applied, before cmd (a build)", "after": "run once restored (the same)",
//     "equivalent": "why no test can fail: another rule refuses the same thing first" }
//
// The file is put back after each one, also when interrupted. A mutation whose `old` text is gone is STALE: the code
// moved on, so update the list; one found more than once is AMBIGUOUS. A mutation marked `equivalent` (with the reason) is expected to survive. Exits 1 if any
// other mutation survived, or one is stale. Manual only: never in a hook or in CI,
// since each mutation reruns its tests.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt === -1 ? undefined : args[onlyAt + 1];
const listArg = args.find(
  (arg, index) => !arg.startsWith('--') && (onlyAt === -1 || index !== onlyAt + 1),
);
if (!listArg || (onlyAt !== -1 && !only)) {
  console.error('Usage: pnpm test:mutation <list name or path> [--only <text in a name>]');
  process.exit(2);
}
const listPath = [listArg, join(ROOT, 'scripts/mutations', `${listArg}.json`)].find((candidate) =>
  existsSync(candidate),
);
if (!listPath) {
  console.error(`No mutation list ${listArg} (nor scripts/mutations/${listArg}.json)`);
  process.exit(2);
}
const mutations = JSON.parse(readFileSync(listPath, 'utf8')).filter(
  (mutation) => !only || mutation.name.includes(only),
);

const run = (command, cwd) =>
  spawnSync(command, { shell: true, cwd: join(ROOT, cwd ?? ''), encoding: 'utf8' });

// The file being mutated, so an interrupt puts it back.
let pending;
const restore = () => {
  if (pending) {
    writeFileSync(pending.path, pending.original);
    pending = undefined;
  }
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

const results = [];
for (const mutation of mutations) {
  const path = join(ROOT, mutation.file);
  const original = readFileSync(path, 'utf8');
  // Text found more than once would mutate whichever comes first, maybe not the rule meant: make it unique.
  if (original.split(mutation.old).length > 2) {
    results.push({
      name: mutation.name,
      outcome: 'AMBIGUOUS',
      line: `${mutation.file}: text found twice`,
    });
    continue;
  }
  if (!original.includes(mutation.old)) {
    results.push({
      name: mutation.name,
      outcome: 'STALE',
      line: `${mutation.file}: text not found`,
    });
    continue;
  }
  process.stdout.write(`${mutation.name} … `);
  pending = { path, original };
  writeFileSync(
    path,
    original.replace(mutation.old, () => mutation.new),
  );
  let outcome;
  let line;
  try {
    if (mutation.before) {
      run(mutation.before, mutation.cwd);
    }
    const { status, stdout, stderr } = run(mutation.cmd, mutation.cwd);
    const output = `${stdout}${stderr}`;
    const summary = output
      .split('\n')
      .filter((text) => /Tests |passed|failed/.test(text))
      .at(-1);
    outcome = status !== 0 ? 'KILLED' : mutation.equivalent ? 'EQUIVALENT' : 'SURVIVED';
    line = (summary ?? output.slice(-200)).trim();
  } finally {
    restore();
    if (mutation.after) {
      run(mutation.after, mutation.cwd);
    }
  }
  console.log(outcome);
  results.push({
    name: mutation.name,
    outcome,
    line: outcome === 'EQUIVALENT' ? mutation.equivalent : line,
  });
}

// Never leave a mutation behind: the tree must be as it was.
const changed = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
console.log(`\n${listPath}`);
for (const { name, outcome, line } of results) {
  console.log(`${outcome.padEnd(9)} ${name} | ${line}`);
}
if (changed.trim() !== '') {
  console.log(`\ngit status after the run (should be what it was before):\n${changed}`);
}
const failed = results.filter(({ outcome }) =>
  ['SURVIVED', 'STALE', 'AMBIGUOUS'].includes(outcome),
);
const killed = results.filter(({ outcome }) => outcome === 'KILLED').length;
console.log(
  `\n${killed} of ${results.length} killed, ${results.length - killed - failed.length} equivalent.`,
);
process.exit(failed.length > 0 ? 1 : 0);
