export interface ImageSize {
  width: number;
  height: number;
  /** What the bytes are, whatever they were declared as. */
  type: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * The pixel size and real format of a PNG, JPEG or WebP (the formats tenants may upload), read from its header;
 * undefined for anything else or a truncated file. Templates need it to lay an image out.
 */
export const imageSize = (bytes: Uint8Array): ImageSize | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  try {
    // PNG: the IHDR chunk follows the 8-byte signature.
    if (ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
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
    // JPEG: walk the segments to the first start-of-frame.
    if (view.getUint16(0) === 0xffd8) {
      let offset = 2;
      while (offset + 9 < bytes.byteLength) {
        const marker = view.getUint16(offset);
        const length = view.getUint16(offset + 2);
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
