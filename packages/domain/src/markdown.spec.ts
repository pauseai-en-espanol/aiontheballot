import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders paragraphs, lists, emphasis and links', () => {
    expect(renderMarkdown('Texto *de ejemplo*.\n\n- uno\n- [dos](https://ejemplo.example/)')).toBe(
      '<p>Texto <em>de ejemplo</em>.</p>\n<ul>\n<li>uno</li>\n<li><a href="https://ejemplo.example/">dos</a></li>\n</ul>\n',
    );
  });

  it('links only to http(s) and mailto addresses', () => {
    expect(
      renderMarkdown('[a](mailto:a@ejemplo.example) [b](ftp://ejemplo.example/) [c](/ruta)'),
    ).toBe(
      '<p><a href="mailto:a@ejemplo.example">a</a> [b](ftp://ejemplo.example/) [c](/ruta)</p>\n',
    );
  });

  it('starts headings below the page’s own h1', () => {
    expect(renderMarkdown('# Uno\n\n###### Seis')).toBe('<h2>Uno</h2>\n<h6>Seis</h6>\n');
  });

  it.each([
    ['raw HTML', '<script>alert(1)</script><b onclick="x()">b</b>'],
    ['a javascript: link', '[x](javascript:alert(1))'],
    ['a data: link', '[x](data:text/html,<script>alert(1)</script>)'],
    ['an image', '![x](https://ejemplo.example/x.png)'],
    ['an autolink to javascript:', '<javascript:alert(1)>'],
  ])('lets nothing active through from %s', (_name, text) => {
    const html = renderMarkdown(text);
    // Escaped text is harmless: what matters is that no tag, attribute or link of these gets through.
    expect(html).not.toMatch(/<script|<b[\s>]|<img|href="(?:javascript|data):/iu);
  });
});
