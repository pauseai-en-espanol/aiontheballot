/**
 * What the worker extracts before it takes any job (worker.ts): a copy of each kind with text, so a parser that can't
 * run in its box (an import the sandbox refuses, a broken build) stops the worker at startup instead of recording every
 * copy of that kind as the document's failure. Fictional text only.
 */

/** A one-page PDF with a line of text, its cross-reference table computed. */
export const onePagePdf = (line: string): Uint8Array => {
  const content = `BT /F1 12 Tf 72 712 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Prueba de arranque</title></head><body><article>
<h2>Prueba de arranque</h2>
<p>Un párrafo inventado para comprobar que el trabajador lee páginas web antes de aceptar ningún trabajo.</p>
<p>Otro párrafo inventado, lo bastante largo para que el extractor de texto legible tome esta página como artículo.</p>
</article></body></html>`;

/** Each kind with text, and a word its extraction must find. */
export const SELF_CHECKS: readonly { contentType: string; bytes: Uint8Array; word: string }[] = [
  {
    contentType: 'text/plain',
    bytes: new TextEncoder().encode('Prueba de arranque inventada.'),
    word: 'arranque',
  },
  { contentType: 'text/html', bytes: new TextEncoder().encode(html), word: 'trabajador' },
  {
    contentType: 'application/pdf',
    bytes: onePagePdf('Prueba de arranque inventada'),
    word: 'arranque',
  },
];
