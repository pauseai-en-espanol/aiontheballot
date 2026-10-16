import { imageSize } from '@aiontheballot/og/image-size';
import { describe, expect, it } from 'vitest';

import { GET as appleTouchIcon } from './app/apple-touch-icon.png/route';
import { GET as favicon } from './app/favicon.ico/route';
import { GET as icon } from './app/icon-32.png/route';

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

describe("the admin's icons (R154)", () => {
  it('draws the tab icon and the home-screen icon as PNGs of their size', async () => {
    for (const [route, side] of [
      [icon, 32],
      [appleTouchIcon, 180],
    ] as const) {
      const response = await route();
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
      expect(imageSize(await bytesOf(response))).toMatchObject({ width: side, height: side });
    }
  });

  it('puts the 16, 32 and 48 px icons in /favicon.ico', async () => {
    const response = await favicon();
    expect(response.headers.get('content-type')).toBe('image/x-icon');
    const bytes = await bytesOf(response);
    // ICONDIR: reserved 0, type 1 (icon), three images.
    expect(Array.from(bytes.subarray(0, 6))).toEqual([0, 0, 1, 0, 3, 0]);
    expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength);
  });
});
