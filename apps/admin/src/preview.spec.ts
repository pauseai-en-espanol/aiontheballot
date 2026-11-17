import { describe, expect, it } from 'vitest';

import {
  PREVIEW_ASSET,
  PREVIEW_HEADERS,
  previewCaching,
  previewConfig,
  previewHtml,
  previewLocation,
} from './preview';

describe("a site's preview through the admin (ADR-0005, PLAN R174)", () => {
  it('is on only with the web app, the preview host and the shared token all set', () => {
    const all = {
      WEB_URL: 'http://web.example.test:3000',
      PREVIEW_HOST: 'vista-previa.example.test',
      PREVIEW_TOKEN: 'un-secreto-de-prueba-de-mas-de-32-caracteres',
    };
    expect(previewConfig(all)).toEqual({
      webUrl: all.WEB_URL,
      host: all.PREVIEW_HOST,
      token: all.PREVIEW_TOKEN,
    });
    for (const missing of ['WEB_URL', 'PREVIEW_HOST', 'PREVIEW_TOKEN'] as const) {
      expect(previewConfig({ ...all, [missing]: '' }), missing).toBeUndefined();
    }
    // A short or mistyped token, as the web app refuses it: off on both sides rather than every request failing.
    for (const token of ['corto', `${all.PREVIEW_TOKEN}\n`, `${all.PREVIEW_TOKEN} con espacio`]) {
      expect(previewConfig({ ...all, PREVIEW_TOKEN: token }), token).toBeUndefined();
    }
  });

  it('is sandboxed, script-free, never cached or indexed, and posts nothing', () => {
    const policy = PREVIEW_HEADERS['content-security-policy'] ?? '';
    expect(policy.split('; ')).toEqual(
      expect.arrayContaining([
        'sandbox allow-same-origin allow-downloads',
        "default-src 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ]),
    );
    expect(policy).not.toContain('script-src');
    // Never scripts, forms, popups or navigation of anything but itself: only downloads (PLAN R234).
    expect(policy.match(/allow-[\w-]+/gu)).toEqual(['allow-same-origin', 'allow-downloads']);
    expect(PREVIEW_HEADERS).toMatchObject({
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    });
  });

  it('keeps in the browser only an image the web app marks immutable, and privately (PLAN R234)', () => {
    const answer = (status: number, type: string, cache?: string) => ({
      status,
      headers: { 'content-type': type, ...(cache === undefined ? {} : { 'cache-control': cache }) },
      body: Buffer.from(''),
    });
    const immutable = 'public, max-age=31536000, immutable';
    expect(previewCaching(answer(200, 'image/png', immutable))).toBe(
      'private, max-age=31536000, immutable',
    );
    for (const other of [
      answer(200, 'text/html; charset=utf-8', immutable),
      answer(200, 'image/png', 'public, max-age=60'),
      answer(200, 'image/png'),
      answer(404, 'image/png', immutable),
    ]) {
      expect(previewCaching(other), JSON.stringify(other.headers)).toBe('private, no-store');
    }
  });

  it("drops the pages' scripts and moves their build assets out of the admin's own `/_next/`", () => {
    expect(
      previewHtml(
        [
          '<head><link rel="stylesheet" href="/_next/static/chunks/a1.css"/>',
          '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/c3.js"/>',
          '<link rel="modulepreload" href="/_next/static/chunks/d4.js"/>',
          '<link rel="preload" href="/_next/static/media/f.woff2" as="font" type="font/woff2"/>',
          '<script src="/_next/static/chunks/b2.js" async=""></script></head>',
          '<body><a href="/t/ejemplo-a/preview/partidos">Partidos</a>',
          '<script>self.__next_f.push([1,"<a href=\\"/x\\">"])</script>',
          '<SCRIPT type="module">alert(1)</SCRIPT></body>',
        ].join(''),
      ),
    ).toBe(
      [
        '<head><link rel="stylesheet" href="/preview-static/chunks/a1.css"/>',
        '<link rel="preload" href="/preview-static/media/f.woff2" as="font" type="font/woff2"/>',
        '</head><body><a href="/t/ejemplo-a/preview/partidos">Partidos</a></body>',
      ].join(''),
    );
  });

  it('passes on only a stylesheet or font by its content-hashed name', () => {
    for (const ok of ['chunks/2f2hh1zkwa9g6.css', 'media/roboto_slab_latin_400-s.p.1iy.woff2']) {
      expect(PREVIEW_ASSET.test(ok), ok).toBe(true);
    }
    for (const no of [
      'chunks/2jt88ngua2i-p.js',
      '../server/app/page.js',
      'chunks/../../x.css',
      'media/x.svg',
      'media/x.html',
      'BUILD_ID',
    ]) {
      expect(PREVIEW_ASSET.test(no), no).toBe(false);
    }
  });

  it("follows a redirect only within the site's preview", () => {
    const root = '/t/ejemplo-a/preview';
    expect(previewLocation('/t/ejemplo-a/preview/partidos', root)).toBe(
      '/t/ejemplo-a/preview/partidos',
    );
    expect(previewLocation('/t/ejemplo-a/preview', root)).toBe('/t/ejemplo-a/preview');
    expect(previewLocation('/t/ejemplo-a/preview#novedades', root)).toBe(
      '/t/ejemplo-a/preview#novedades',
    );
    for (const away of [
      null,
      'https://ejemplo-a.example.test/partidos',
      '//otro.example.test/t/ejemplo-a/preview',
      '/t/ejemplo-b/preview',
      '/t/ejemplo-a/previewx',
    ]) {
      expect(previewLocation(away, root), String(away)).toBeUndefined();
    }
  });
});
