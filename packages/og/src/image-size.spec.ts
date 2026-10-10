import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';

import { imageSize } from './image-size.js';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)),
  );

describe('imageSize', () => {
  it('reads a PNG', () => {
    const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"/>')
      .render()
      .asPng();
    expect(imageSize(png)).toEqual({ width: 300, height: 80, type: 'image/png' });
  });

  it('reads a baseline JPEG, skipping the segments before its frame', () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], // APP0, empty
      [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x50, 0x01, 0x2c, 0x03], // SOF0: 80 high, 300 wide
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    expect(imageSize(jpeg)).toEqual({ width: 300, height: 80, type: 'image/jpeg' });
  });

  it('reads an extended WebP (VP8X)', () => {
    const webp = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBP',
      'VP8X',
      [10, 0, 0, 0, 0, 0, 0, 0],
      [43, 1, 0],
      [79, 0, 0],
    );
    expect(imageSize(webp)).toEqual({ width: 300, height: 80, type: 'image/webp' });
  });

  it('reads a lossless WebP (VP8L)', () => {
    // 14 bits of width - 1, then 14 bits of height - 1, after the 0x2f signature byte.
    const bits = (300 - 1) | ((80 - 1) << 14);
    const webp = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBP',
      'VP8L',
      [0, 0, 0, 0, 0x2f],
      [bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff],
    );
    expect(imageSize(webp)).toEqual({ width: 300, height: 80, type: 'image/webp' });
  });

  it('gives up on anything else, or a truncated file', () => {
    expect(imageSize(bytes('GIF89a', [0, 0, 0, 0]))).toBeUndefined();
    expect(imageSize(bytes([0x89], 'PNG'))).toBeUndefined();
    expect(imageSize(new Uint8Array())).toBeUndefined();
  });
});
