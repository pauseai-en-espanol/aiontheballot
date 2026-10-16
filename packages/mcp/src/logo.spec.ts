import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { imageType, MAX_LOGO_BYTES, readLogo } from './logo.js';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The member's folder for logos, inside one for everything else of theirs. */
let home: string;
let folder: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'casa-'));
  folder = join(home, 'logos');
  await mkdir(folder);
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

const file = async (name: string, bytes: Uint8Array) => {
  const path = join(folder, name);
  await writeFile(path, bytes);
  return path;
};

describe('imageType', () => {
  it('knows a PNG, a JPEG and a WebP by their bytes, and nothing else', () => {
    expect(imageType(new Uint8Array(PNG))).toBe('image/png');
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageType(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(
      imageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeUndefined();
  });
});

describe('readLogo (PLAN R204)', () => {
  it('reads an image from the logos folder, typed by its bytes whatever its name says, named only by its type', async () => {
    const logo = await readLogo(
      folder,
      await file('escaneado-personal.jpg', new Uint8Array([...PNG, 1, 2, 3])),
    );
    expect(logo).toMatchObject({ contentType: 'image/png', filename: 'logo.png' });
  });

  it('reads nothing outside the logos folder, through a link either, nor without one', async () => {
    const outside = join(home, 'captura.png');
    await writeFile(outside, new Uint8Array([...PNG, 4, 5, 6]));
    await expect(readLogo(folder, outside)).rejects.toThrow(/AIONTHEBALLOT_LOGO_DIR/);
    await expect(readLogo(folder, join(folder, '..', 'captura.png'))).rejects.toThrow(
      /AIONTHEBALLOT_LOGO_DIR/,
    );
    const link = join(folder, 'enlace.png');
    await symlink(outside, link);
    await expect(readLogo(folder, link)).rejects.toThrow(/AIONTHEBALLOT_LOGO_DIR/);
    await expect(readLogo(undefined, join(folder, 'escaneado-personal.jpg'))).rejects.toThrow(
      /Set AIONTHEBALLOT_LOGO_DIR/,
    );
  });

  it('refuses an SVG, saying to turn it into a PNG, anything else that isn’t an image, a large one and no file', async () => {
    const svg = await file(
      'logo.svg',
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    await expect(readLogo(folder, svg)).rejects.toThrow(/PNG/);
    await expect(
      readLogo(folder, await file('notas.txt', new TextEncoder().encode('hola'))),
    ).rejects.toThrow(/PNG, a JPEG or a WebP/);
    const large = new Uint8Array(MAX_LOGO_BYTES + 1);
    large.set(PNG);
    await expect(readLogo(folder, await file('grande.png', large))).rejects.toThrow(/2 MB/);
    await expect(readLogo(folder, join(folder, 'no-existe.png'))).rejects.toThrow(
      /AIONTHEBALLOT_LOGO_DIR/,
    );
  });
});
