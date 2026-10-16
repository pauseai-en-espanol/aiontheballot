import { fileURLToPath } from 'node:url';
import { createDeflate } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { createChildExtractor } from './child-extractor.js';
import { type ChildLimits, readRootsFor, runInChild } from './child.js';
import { SELF_CHECKS } from './self-check.js';

const limits: ChildLimits = {
  timeoutMs: 60_000,
  memoryMb: 256,
  maxOutputBytes: 16 * 1024 * 1024,
  readRoots: readRootsFor(fileURLToPath(new URL('.', import.meta.url))),
  // The sources as they are, as the build would run them.
  execArgv: ['--import', fileURLToPath(new URL('../../tests/ts-resolve.mjs', import.meta.url))],
};
const script = new URL('./extract-child.ts', import.meta.url);
const extractor = createChildExtractor(script, limits);

/** `size` MB of spaces, deflated as they stream, so the test itself never holds them: about 1 KB per MB. */
const deflatedSpaces = async (size: number): Promise<Buffer> => {
  const deflate = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise((resolve) => deflate.once('end', resolve));
  const megabyte = Buffer.alloc(1024 * 1024, 0x20);
  for (let i = 0; i < size; i += 1) {
    if (!deflate.write(megabyte)) {
      await new Promise((resolve) => deflate.once('drain', resolve));
    }
  }
  deflate.end();
  await finished;
  return Buffer.concat(chunks);
};

/** A one-page PDF whose page content is the given stream, deflated: a decompression bomb when it inflates to a lot. */
const pdfWithDeflatedContent = (content: Buffer): Uint8Array => {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (part: string | Buffer) => {
    const bytes = typeof part === 'string' ? Buffer.from(part, 'latin1') : part;
    parts.push(bytes);
    length += bytes.byteLength;
  };
  const object = (id: number, body: string | Buffer[]) => {
    offsets[id] = length;
    add(`${id} 0 obj\n`);
    for (const part of typeof body === 'string' ? [body] : body) {
      add(part);
    }
    add('\nendobj\n');
  };
  add('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
  );
  object(4, [
    Buffer.from(`<< /Length ${content.byteLength} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream', 'latin1'),
  ]);
  object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = length;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (let id = 1; id <= 5; id += 1) {
    add(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
};

describe('the child extractor (PLAN R133)', () => {
  it('extracts a copy in a child process', async () => {
    expect(
      await extractor('text/plain', new TextEncoder().encode('Un bloque inventado.\n\nOtro.')),
    ).toEqual({
      status: 'done',
      units: [
        { index: 1, label: '§ 1', body: 'Un bloque inventado.' },
        { index: 2, label: '§ 2', body: 'Otro.' },
      ],
    });
  });

  it.each(SELF_CHECKS.map((check) => [check.contentType, check] as const))(
    "extracts the worker's startup check of %s in a child process",
    async (_type, { contentType, bytes, word }) => {
      const result = await extractor(contentType, bytes);
      expect(result.status).toBe('done');
      expect(result.status === 'done' && result.units.some((u) => u.body.includes(word))).toBe(
        true,
      );
    },
  );

  it('extracts a PDF in a child process, under its restrictions', async () => {
    const deflate = createDeflate();
    const chunks: Buffer[] = [];
    deflate.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise((resolve) => deflate.once('end', resolve));
    deflate.end('BT /F1 12 Tf 72 712 Td (Una propuesta de ejemplo inventada) Tj ET');
    await finished;
    expect(
      await extractor('application/pdf', pdfWithDeflatedContent(Buffer.concat(chunks))),
    ).toEqual({
      status: 'done',
      units: [{ index: 1, label: 'p. 1', body: expect.stringContaining('propuesta de ejemplo') }],
    });
  });

  it("records a decompression bomb as the document's failure, and the worker's memory never sees it", async () => {
    // Under a megabyte that inflates to 1 GB, four times what the child may hold: it is stopped, the job fails, and
    // only the bomb's own bytes ever reach this process.
    const bomb = pdfWithDeflatedContent(await deflatedSpaces(1024));
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const before = process.memoryUsage.rss();
    const started = Date.now();
    expect(await extractor('application/pdf', bomb)).toEqual({ status: 'failed' });
    expect(Date.now() - started).toBeLessThan(limits.timeoutMs);
    expect(process.memoryUsage.rss() - before).toBeLessThan(64 * 1024 * 1024);
    // Stopped for its memory, by the watchdog: not the deadline, nor a parser error.
    expect(await runInChild(script, ['application/pdf'], bomb, limits)).toEqual({
      kind: 'fault',
      fault: 'memory',
    });
  }, 120_000);

  it('records bytes that are no PDF as a failed extraction', async () => {
    expect(await extractor('application/pdf', new TextEncoder().encode('no es un PDF'))).toEqual({
      status: 'failed',
    });
  });

  it("refuses an answer that isn't an extraction, whatever the child says", async () => {
    const liar = createChildExtractor(
      new URL('../../tests/children/liar.ts', import.meta.url),
      limits,
    );
    expect(await liar('text/plain', new Uint8Array())).toEqual({ status: 'failed' });
  });
});
