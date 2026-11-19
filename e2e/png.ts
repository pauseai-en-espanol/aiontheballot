import { inflateSync } from 'node:zlib';

/** Bytes a pixel, by a PNG's colour type: RGB (a browser's screenshot) and RGBA (the share and icon renderer). */
const CHANNELS: Readonly<Record<number, number>> = { 2: 3, 6: 4 };

/**
 * The pixels of an 8-bit RGB or RGBA PNG that isn't interlaced (what a browser's screenshot and the share and icon
 * renderer write), by position: #rrggbb where opaque, #rrggbbaa otherwise, so a transparent pixel never passes for
 * black. Enough for the tests to check what a picture shows, not only its size.
 */
export const decodePng = (
  png: Buffer,
): { width: number; height: number; at: (x: number, y: number) => string } => {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = CHANNELS[png[25] ?? -1];
  if (png[24] !== 8 || channels === undefined || png[28] !== 0) {
    throw new Error('Only 8-bit RGB or RGBA PNGs without interlacing');
  }
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') {
      data.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      const paeth = () => {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        return a <= b && a <= c ? left : b <= c ? up : corner;
      };
      if (filter === undefined || filter > 4) {
        throw new Error(`Row ${y} has an unknown filter, ${filter}`);
      }
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth()][filter] ?? 0;
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const start = (y * width + x) * channels;
      const opaque = channels === 3 || pixels[start + 3] === 255;
      return `#${pixels.subarray(start, start + (opaque ? 3 : 4)).toString('hex')}`;
    },
  };
};
