import { describe, expect, it } from 'vitest';

import { imageSize } from './image-size.js';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)),
  );

describe('imageSize', () => {
  it('refuses a PNG without its whole signature or a well-formed IHDR', () => {
    expect(
      imageSize(bytes('<PNG\r\n\x1a\n', [0, 0, 0, 13], 'IHDR', [0, 0, 1, 44], [0, 0, 0, 80])),
    ).toBe(undefined);
    expect(
      imageSize(
        bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 14], 'IHDR', [0, 0, 1, 44], [0, 0, 0, 80]),
      ),
    ).toBeUndefined();
  });

  it('refuses a JPEG a decoder could read another frame from: fill bytes, stray bytes, a scan before the frame', () => {
    const frame = (width: number, height: number) => [
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      0x03,
      ...Array<number>(9).fill(0),
    ];
    // FF FF: a decoder skips the fill byte and reads a 65,535-pixel frame right after it; a naive walk read a
    // "segment" 0xC000 long instead, and the small frame planted where it ends.
    const huge = [0xc0, 0x00, 0x11, 0x08, 0xff, 0xff, 0xff, 0xff, 0x03];
    const padded = bytes(
      [0xff, 0xd8, 0xff, 0xff],
      huge,
      Array<number>(0xc004 - 4 - huge.length).fill(0),
      frame(16, 16),
    );
    expect(imageSize(padded)).toBeUndefined();
    expect(imageSize(bytes([0xff, 0xd8, 0x00], frame(16, 16)))).toBeUndefined();
    expect(
      imageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00], frame(16, 16))),
    ).toBeUndefined();
    // The control: the same frame where it belongs.
    expect(imageSize(bytes([0xff, 0xd8], frame(16, 8)))).toEqual({
      width: 16,
      height: 8,
      type: 'image/jpeg',
    });
  });

  it('reads a PNG', () => {
    // The signature, then the IHDR chunk's length, type, width and height.
    const png = bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 13], 'IHDR', [0, 0, 1, 44], [0, 0, 0, 80]);
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
