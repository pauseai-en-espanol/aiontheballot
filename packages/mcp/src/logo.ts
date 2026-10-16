import { readFile, realpath, stat } from 'node:fs/promises';
import { sep } from 'node:path';

/** What a party's logo may be, as the admin takes it (PLAN R142): an image a browser draws, never SVG; 2 MB at most. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  prefix.every((byte, index) => bytes[at + index] === byte);

/** The image's type by its first bytes, whatever its name says; undefined for anything else. */
export const imageType = (
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | undefined => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return undefined;
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * A logo from a file in `folder`, the one the member set aside for logos (AIONTHEBALLOT_LOGO_DIR), and nowhere else:
 * whatever an AI is told, it can't send the admin another file of theirs (a screenshot, a scan). The path is resolved,
 * links included, before it is checked to be inside. Then it is checked as the admin will check it, so a wrong one is
 * refused here with a reason: its size, and its type by its bytes. An SVG is refused: it can carry script, so it is
 * turned into a PNG first (a square one fits the site's box best). Its name stays here: the admin gets `logo.png`.
 */
export const readLogo = async (
  folder: string | undefined,
  path: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string; filename: string }> => {
  if (!folder) {
    throw new Error('Set AIONTHEBALLOT_LOGO_DIR to the folder that holds the logos to upload');
  }
  const [inside, resolved] = await Promise.all([
    realpath(folder).catch(() => undefined),
    realpath(path).catch(() => undefined),
  ]);
  if (!inside || !resolved || !resolved.startsWith(`${inside}${sep}`)) {
    throw new Error('Only a file in AIONTHEBALLOT_LOGO_DIR can be uploaded as a logo');
  }
  const found = await stat(resolved);
  if (!found.isFile()) {
    throw new Error('Only a file in AIONTHEBALLOT_LOGO_DIR can be uploaded as a logo');
  }
  if (found.size > MAX_LOGO_BYTES) {
    throw new Error('A logo is 2 MB at most');
  }
  const bytes = new Uint8Array(await readFile(resolved));
  const contentType = imageType(bytes);
  if (!contentType) {
    throw new Error(
      /\.svgz?$/i.test(resolved)
        ? 'An SVG is not taken (it can carry script): turn it into a PNG first, square if it can be'
        : 'A logo is a PNG, a JPEG or a WebP image',
    );
  }
  return { bytes, contentType, filename: `logo.${EXTENSIONS[contentType]}` };
};
