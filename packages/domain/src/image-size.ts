export interface ImageSize {
  width: number;
  height: number;
  /** What the bytes are, whatever they were declared as. */
  type: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * The pixel size and real format of a PNG, JPEG or WebP (the formats tenants may upload), read from its header;
 * undefined for anything else or a truncated file. Share-card templates need it to lay an image out, and the API to
 * check an uploaded logo is what it says.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const imageSize = (bytes: Uint8Array): ImageSize | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  try {
    // PNG: the whole 8-byte signature, then the IHDR chunk, 13 bytes long, first.
    if (
      PNG_SIGNATURE.every((byte, i) => bytes[i] === byte) &&
      view.getUint32(8) === 13 &&
      ascii(12, 4) === 'IHDR'
    ) {
      return { width: view.getUint32(16), height: view.getUint32(20), type: 'image/png' };
    }
    // WebP: a RIFF container with a VP8, VP8L or VP8X chunk.
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const chunk = ascii(12, 4);
      if (chunk === 'VP8 ') {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
          type: 'image/webp',
        };
      }
      if (chunk === 'VP8L') {
        const bits = view.getUint32(21, true);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
          type: 'image/webp',
        };
      }
      if (chunk === 'VP8X') {
        const width = 1 + (view.getUint16(24, true) | (view.getUint8(26) << 16));
        const height = 1 + (view.getUint16(27, true) | (view.getUint8(29) << 16));
        return { width, height, type: 'image/webp' };
      }
      return undefined;
    }
    // JPEG: walk the segments to the first start-of-frame, strictly. Each must start right where the last ended, with a
    // marker that has a length: decoders skip fill bytes (FF FF…) and stray bytes, which would let a file show this
    // check one frame and a decoder another, far larger.
    if (view.getUint16(0) === 0xffd8) {
      let offset = 2;
      while (offset + 9 < bytes.byteLength) {
        const code = view.getUint8(offset + 1);
        const length = view.getUint16(offset + 2);
        if (
          view.getUint8(offset) !== 0xff ||
          code === 0xff ||
          code === 0x00 ||
          code === 0x01 ||
          (code >= 0xd0 && code <= 0xda) ||
          length < 2
        ) {
          return undefined;
        }
        const marker = 0xff00 | code;
        const isFrame =
          marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker);
        if (isFrame) {
          return {
            width: view.getUint16(offset + 7),
            height: view.getUint16(offset + 5),
            type: 'image/jpeg',
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // Truncated: fall through.
  }
  return undefined;
};
