import { describe, expect, it } from 'vitest';

import { capUnits, decodeText, extract, MAX_UNITS } from './extract.js';

/** A minimal PDF with one line of text per page, its cross-reference table computed: fictional text only. */
const pdf = (pages: string[]): Uint8Array => {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const page = pageIds[i] ?? 0;
    const stream = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
    objects[page] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> >>`;
    objects[page + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[font] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

describe('extract', () => {
  it('reads a PDF page by page, labelled as the public sees them', async () => {
    const result = await extract(
      'application/pdf',
      pdf([
        'Una propuesta de ejemplo en la primera pagina',
        'Otra propuesta de ejemplo en la segunda',
      ]),
    );
    expect(result).toEqual({
      status: 'done',
      units: [
        { index: 1, label: 'p. 1', body: expect.stringContaining('primera pagina') },
        { index: 2, label: 'p. 2', body: expect.stringContaining('segunda') },
      ],
    });
  });

  it('finds no text in a PDF without a text layer, nor in an image', async () => {
    expect(await extract('application/pdf', pdf([' ']))).toEqual({ status: 'not_applicable' });
    expect(await extract('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({
      status: 'not_applicable',
    });
  });

  it("reads a web page's readable part, section by section at its headings", async () => {
    const html = `<!doctype html><html><head><title>Programa de ejemplo</title></head><body>
      <nav>Menú que no cuenta</nav>
      <article>
        <h2>Inteligencia artificial</h2>
        <p>El Partido Ejemplo A propone una moratoria inventada sobre los sistemas de prueba más avanzados del mundo.</p>
        <p>También propone una agencia de supervisión ficticia con un presupuesto inventado para el ejemplo.</p>
        <h2>Otros asuntos</h2>
        <p>Un párrafo de relleno sobre otros asuntos inventados, lo bastante largo para que Readability lo tome.</p>
      </article></body></html>`;
    const result = await extract('text/html', new TextEncoder().encode(html));
    expect(result.status).toBe('done');
    const units = result.status === 'done' ? result.units : [];
    expect(units.map((u) => u.label)).toContain('Inteligencia artificial');
    expect(units.find((u) => u.label === 'Inteligencia artificial')?.body).toContain(
      'moratoria inventada',
    );
    expect(units.map((u) => u.body).join(' ')).not.toContain('Menú que no cuenta');
  });

  it('reads plain text block by block, and keeps no NUL', async () => {
    const result = await extract(
      'text/plain',
      new TextEncoder().encode('Primer bloque de ejemplo.\n\nSegundo\u0000 bloque de ejemplo.\n'),
    );
    expect(result).toEqual({
      status: 'done',
      units: [
        { index: 1, label: '§ 1', body: 'Primer bloque de ejemplo.' },
        { index: 2, label: '§ 2', body: 'Segundo bloque de ejemplo.' },
      ],
    });
  });

  /** A page Readability takes as an article: a title and enough prose around what a test looks at. */
  const page = (head: string, article: string): string =>
    `<!doctype html><html><head>${head}<title>Programa de ejemplo</title></head><body><article>
      <p>Un párrafo de relleno inventado, lo bastante largo para que Readability tome esta página como un artículo.</p>
      ${article}
      <p>Otro párrafo de relleno inventado al final, también largo, para que el artículo tenga cuerpo suficiente.</p>
    </article></body></html>`;
  const bodies = (result: Awaited<ReturnType<typeof extract>>) =>
    result.status === 'done' ? result.units.map((u) => u.body).join('\n\n') : '';

  it('reads every block of a web page once: nested blocks, loose text, line breaks and tables', async () => {
    const html = page(
      '',
      `<h2>Propuestas de ejemplo</h2>
       <ul><li><p>Primera propuesta inventada.</p><p>Su detalle inventado.</p></li></ul>
       <blockquote><p>Una cita inventada dentro de otra cita.</p></blockquote>
       <div>Texto suelto en un div<br>partido por un salto de línea.</div>
       <h5>Un encabezado menor inventado</h5>
       <table><tr><th>Medida</th><td>Una celda inventada</td></tr></table>`,
    );
    const text = bodies(await extract('text/html', new TextEncoder().encode(html)));
    for (const block of [
      'Primera propuesta inventada.',
      'Su detalle inventado.',
      'Una cita inventada dentro de otra cita.',
      'Texto suelto en un div partido por un salto de línea.',
      'Un encabezado menor inventado',
      'Medida',
      'Una celda inventada',
    ]) {
      // Once each: neither dropped nor repeated by an enclosing block.
      expect(text.split(block)).toHaveLength(2);
    }
    // The heading labels its section and is text of it too.
    expect(text).toContain('Propuestas de ejemplo');
  });

  it('reads a web page in the encoding it declares, else as a browser would', async () => {
    const latin1 = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'));
    const declared = page(
      '<meta charset="iso-8859-1">',
      '<p>Una propuesta inventada sobre la inteligencia artificial y su supervisión pública.</p>',
    );
    expect(bodies(await extract('text/html', latin1(declared)))).toContain('supervisión pública');
    const utf8 = page(
      '<meta charset="utf-8">',
      '<p>Una propuesta inventada sobre la inteligencia artificial y su supervisión pública.</p>',
    );
    expect(bodies(await extract('text/html', new TextEncoder().encode(utf8)))).toContain(
      'supervisión pública',
    );
    // Declaring none (a saved copy loses the header that said it): UTF-8 if it reads as such, else windows-1252.
    const undeclared = page(
      '',
      '<p>Una propuesta inventada sobre la inteligencia artificial y su supervisión pública.</p>',
    );
    expect(bodies(await extract('text/html', new TextEncoder().encode(undeclared)))).toContain(
      'supervisión pública',
    );
    expect(bodies(await extract('text/html', latin1(undeclared)))).toContain('supervisión pública');
  });

  it('turns other control characters into spaces, keeping tabs and line breaks', async () => {
    const result = await extract(
      'text/plain',
      new TextEncoder().encode('Un\u0001bloque\u001Finventado\tcon\nlíneas.'),
    );
    expect(result).toEqual({
      status: 'done',
      units: [{ index: 1, label: '§ 1', body: 'Un bloque inventado\tcon\nlíneas.' }],
    });
  });

  it('keeps no NUL in a label', async () => {
    const html = page(
      '',
      '<h2>Encabezado\u0000 inventado</h2><p>Un párrafo inventado bajo él.</p>',
    );
    const result = await extract('text/html', new TextEncoder().encode(html));
    const units = result.status === 'done' ? result.units : [];
    expect(units.map((u) => u.label)).toContain('Encabezado inventado');
    expect(units.some((u) => u.label.includes('\u0000') || u.body.includes('\u0000'))).toBe(false);
  });

  it('reads plain text as UTF-8, or by its byte-order mark, or else as windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('\uFEFFcampaña'))).toBe('campaña');
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x6d, 0x70, 0x61, 0xf1, 0x61]))).toBe('campaña');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0xf1, 0x00]))).toBe('añ');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0xf1]))).toBe('añ');
  });

  it('splits plain text at blank lines whatever ends its lines', async () => {
    const result = await extract(
      'text/plain',
      new TextEncoder().encode('Uno inventado.\r\nsigue.\r\n\r\nDos inventado.\r\r Tres.'),
    );
    expect(result).toEqual({
      status: 'done',
      units: [
        { index: 1, label: '§ 1', body: 'Uno inventado.\nsigue.' },
        { index: 2, label: '§ 2', body: 'Dos inventado.' },
        { index: 3, label: '§ 3', body: 'Tres.' },
      ],
    });
  });

  it('joins neighbouring units past the most a source keeps, losing none', () => {
    const units = Array.from({ length: MAX_UNITS * 2 + 1 }, (_, i) => ({
      index: i + 1,
      label: `§ ${i + 1}`,
      body: `Bloque ${i + 1}`,
    }));
    const capped = capUnits(units);
    expect(capped.length).toBeLessThanOrEqual(MAX_UNITS);
    expect(capped[0]).toEqual({
      index: 1,
      label: '§ 1 – § 3',
      body: 'Bloque 1\n\nBloque 2\n\nBloque 3',
    });
    expect(capped.map((u) => u.body).join('\n\n')).toBe(units.map((u) => u.body).join('\n\n'));
    expect(capped.map((u) => u.index)).toEqual(capped.map((_, i) => i + 1));
  });

  it('fails on bytes that are no PDF, for the worker to record', async () => {
    await expect(
      extract('application/pdf', new TextEncoder().encode('no es un PDF')),
    ).rejects.toThrow();
  });
});
