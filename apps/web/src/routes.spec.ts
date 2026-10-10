import {
  RESERVED_ELECTION_SLUGS,
  SYSTEM_PATHS,
  SYSTEM_PREFIXES,
} from '@aiontheballot/domain/routing';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = join(dirname(fileURLToPath(import.meta.url)), 'app');
/** The routes under a tenant's root, beside the pages: the folders of the internal tenant route. */
const TENANT_ROOT = join(APP, '%5Ftenant', '[slug]', '[locale]');

/** The database's slug domain (`app.slug`): what an election's slug can look like. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether a first path segment is safe from election slugs: reserved, or not a slug at all. */
const safe = (segment: string): boolean =>
  !SLUG.test(segment) || (RESERVED_ELECTION_SLUGS as readonly string[]).includes(segment);

/**
 * Next's metadata files, which serve a path of their own: the images under their name alone when made by code
 * (`/icon`), the rest with a fixed extension (`/sitemap.xml`); a static file under its own name (`/icon.png`).
 */
const METADATA_IMAGE = /^(?:icon|apple-icon|opengraph-image|twitter-image)\d*$/;
const METADATA_EXTENSION: Readonly<Record<string, string>> = {
  sitemap: '.xml',
  robots: '.txt',
  manifest: '.webmanifest',
};
const CODE = /\.[cm]?[jt]sx?$/;

/** The first path segments a folder of the app router serves: route groups and slots add none, their children do. */
const firstSegments = async (folder: string): Promise<string[]> => {
  const segments: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const { name } = entry;
    if (entry.isDirectory()) {
      if (name.startsWith('@') || /^\([^.)][^)]*\)$/.test(name)) {
        segments.push(...(await firstSegments(join(folder, name))));
      } else if (!name.startsWith('_') && !name.startsWith('[')) {
        // A private folder (`_x`) is never routed, and a dynamic one is the pages; an intercepting route, `(.)x`,
        // answers at `x`.
        segments.push(name.replace(/^(?:\(\.{1,3}\))+/, ''));
      }
    } else {
      const base = name.split('.')[0] ?? name;
      if (METADATA_IMAGE.test(base) || base in METADATA_EXTENSION || base === 'favicon') {
        segments.push(CODE.test(name) ? `${base}${METADATA_EXTENSION[base] ?? ''}` : name);
      }
    }
  }
  return segments;
};

describe("a tenant's routes", () => {
  it('take no first segment an election slug could: each is reserved, or not a slug', async () => {
    const segments = await firstSegments(TENANT_ROOT);
    expect(segments).toEqual(expect.arrayContaining(['brand', 'og', 'favicon.ico']));
    for (const segment of segments) {
      expect(
        safe(segment),
        `/${segment} is a route an election slug could shadow: add it to RESERVED_ELECTION_SLUGS and the database`,
      ).toBe(true);
    }
  });

  it("nor do the app's own paths, served on every host before any tenant", async () => {
    const paths = [...SYSTEM_PATHS, ...SYSTEM_PREFIXES].map((path) => path.split('/')[1] ?? '');
    expect(paths).toContain('healthz');
    for (const segment of [...paths, ...(await firstSegments(APP))]) {
      expect(safe(segment), `/${segment} is shadowed by no election only if reserved`).toBe(true);
    }
  });

  it('are found however Next serves them: metadata files, route groups, slots and intercepting routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'routes-'));
    try {
      const files = [
        'icon.tsx',
        'apple-icon1.png',
        'opengraph-image.ts',
        'sitemap.ts',
        'robots.txt',
        'page.tsx',
        'fonts.ts',
        '(grupo)/agrupada/page.tsx',
        '@lateral/ranura/page.tsx',
        '(.)interceptada/page.tsx',
        '_privada/page.tsx',
        '[dinamica]/page.tsx',
      ];
      for (const file of files) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await writeFile(join(root, file), '');
      }
      expect((await firstSegments(root)).sort()).toEqual(
        [
          'icon',
          'apple-icon1.png',
          'opengraph-image',
          'sitemap.xml',
          'robots.txt',
          'agrupada',
          'ranura',
          'interceptada',
        ].sort(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
