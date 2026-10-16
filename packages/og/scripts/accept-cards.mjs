// Accepts the share images as they are now drawn (`pnpm cards:accept`, PLAN R147): renders every template's probe
// cards at every size from the built package and writes them as the reference pictures the reference test compares
// against, removing references no probe draws any more. Look at the pictures (git diff shows them) before committing.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

const { renderProbes } = await import('../dist/fingerprint.js');
const { TEMPLATE_NAMES } = await import('../dist/templates.js');
const root = new URL('../reference/', import.meta.url);

const changed = [];
const kept = new Set();
for (const template of TEMPLATE_NAMES) {
  const folder = new URL(`${template}/`, root);
  await mkdir(folder, { recursive: true });
  for (const { id, png } of await renderProbes(template)) {
    const file = new URL(`${id}.png`, folder);
    kept.add(file.href);
    const before = await readFile(file).catch(() => undefined);
    if (!before || !before.equals(Buffer.from(png))) {
      await writeFile(file, png);
      changed.push(`${template}/${id}.png`);
    }
  }
}
for (const template of await readdir(root)) {
  for (const name of await readdir(new URL(`${template}/`, root))) {
    const file = new URL(`${template}/${name}`, root);
    if (!kept.has(file.href)) {
      await rm(file);
      changed.push(`${template}/${name} (removed)`);
    }
  }
}
console.log(
  changed.length ? `Accepted:\n  ${changed.join('\n  ')}` : 'Every reference picture is current.',
);
