import { Readability } from '@mozilla/readability';
import htmlEncodingSniffer from 'html-encoding-sniffer';
import { JSDOM } from 'jsdom';
import { isUtf8 } from 'node:buffer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Text from a source's stored copy (editorial workflow S3.2; ADR-0003 §9), as the worker extracts it: PDFs page by page
 * with PDF.js, web pages section by section with Readability on jsdom, plain text paragraph by paragraph. The bytes are
 * a party's, so hostile: PDF.js runs without forms, fetching anything or loading fonts, jsdom runs no script and loads
 * nothing, and the worker runs this in a child process of its own (child.ts). The text is untrusted
 * wherever it is shown.
 */

/** One unit of a source: a PDF's page or a document's section, with the label the public sees. */
export interface ExtractedUnit {
  index: number;
  label: string;
  body: string;
}

export type Extraction =
  | { status: 'done'; units: ExtractedUnit[] }
  /** A kind with no text (an image), or a PDF with no text layer (a scan): its quotes are attested (C4). */
  | { status: 'not_applicable' };

/** At most this many units per source: beyond it, neighbouring units are joined, so no text is dropped. */
export const MAX_UNITS = 5000;
const MAX_LABEL = 200;

/** Every page's text, in reading order; a page with none is left out, and a document with none has no text. */
const pdfUnits = async (bytes: Uint8Array): Promise<ExtractedUnit[]> => {
  const task = getDocument({
    // A copy: PDF.js may detach the buffer it is given.
    data: new Uint8Array(bytes),
    // Nothing a document asks for beyond its own text: no forms engine, fonts, fetches or streaming (and the child
    // process allows no code built from strings).
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const document = await task.promise;
  try {
    const units: ExtractedUnit[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str + (item.hasEOL ? '\n' : '');
        }
      }
      page.cleanup();
      if (text.trim() !== '') {
        units.push({ index: number, label: `p. ${number}`, body: text });
      }
    }
    return units;
  } finally {
    await task.destroy();
  }
};

/** Elements that start a block of their own: their text is never run into a neighbour's. */
const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'CAPTION',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LEGEND',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);
/** Headings that start a section, labelled by their text; smaller ones are paragraphs. */
const SECTION_HEADINGS = new Set(['H1', 'H2', 'H3', 'H4']);
/** Elements whose content is never text a reader sees. */
const HIDDEN = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG']);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * The text of a page's readable part, as sections: each heading (h1 to h4) starts one, labelled by its text, and its
 * blocks (paragraphs, list items, cells, a heading's own text) follow, each once, in document order. Every text node
 * lands in exactly one block: the innermost block element around it, so nested blocks (a paragraph in a list item)
 * neither repeat nor lose text, and text outside any listed element still counts.
 */
const sectionsOf = (body: Element): { label: string; parts: string[] }[] => {
  const sections: { label: string; parts: string[] }[] = [{ label: '', parts: [] }];
  let paragraph = '';
  const flush = () => {
    const text = paragraph.replace(/\s+/gu, ' ').trim();
    paragraph = '';
    if (text !== '') {
      sections.at(-1)?.parts.push(text);
    }
  };
  const visit = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      paragraph += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) {
      return;
    }
    const tag = (node as Element).tagName.toUpperCase();
    if (HIDDEN.has(tag)) {
      return;
    }
    if (tag === 'BR') {
      paragraph += '\n';
      return;
    }
    const block = BLOCKS.has(tag);
    if (block) {
      flush();
    }
    if (SECTION_HEADINGS.has(tag)) {
      const heading = (node.textContent ?? '').replace(/\s+/gu, ' ').trim();
      if (heading !== '') {
        sections.push({ label: heading.slice(0, MAX_LABEL), parts: [] });
      }
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
    if (block) {
      flush();
    }
  };
  visit(body);
  flush();
  return sections.filter((section) => section.parts.length > 0);
};

/** The readable part of a web page, cut into sections at its headings, each labelled by its heading. */
const htmlUnits = (bytes: Uint8Array): ExtractedUnit[] => {
  // The encoding as a browser finds it (the HTML Standard's sniffing: a byte-order mark, then the page's own
  // declaration in a meta tag), so a page in Latin-1 reads as it was written. A page that declares none was most likely
  // served with its encoding in a header a saved copy doesn't keep: UTF-8 if it reads as UTF-8, else windows-1252.
  const encoding = htmlEncodingSniffer(bytes, {
    defaultEncoding: isUtf8(bytes) ? 'UTF-8' : 'windows-1252',
  });
  // jsdom runs no script and loads nothing.
  const page = new JSDOM(Buffer.from(bytes), { contentType: `text/html; charset=${encoding}` });
  try {
    const article = new Readability(page.window.document).parse();
    if (!article?.content) {
      return [];
    }
    const readable = new JSDOM(`<!doctype html><html><body>${article.content}</body></html>`);
    try {
      return sectionsOf(readable.window.document.body).map((section, i) => ({
        index: i + 1,
        label: section.label === '' ? `§ ${i + 1}` : section.label,
        body: section.parts.join('\n\n'),
      }));
    } finally {
      readable.window.close();
    }
  } finally {
    page.window.close();
  }
};

/**
 * Plain text as written: a byte-order mark says its encoding; without one it is UTF-8 if it reads as UTF-8, else
 * windows-1252 (what a Spanish document that isn't UTF-8 most likely is). A plain-text copy carries no other
 * declaration.
 */
export const decodeText = (bytes: Uint8Array): string => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    // Drops a UTF-8 byte-order mark.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

/** Plain text, a section per block between blank lines. */
const textUnits = (bytes: Uint8Array): ExtractedUnit[] =>
  decodeText(bytes)
    .replace(/\r\n?/gu, '\n')
    .split(/\n[^\S\n]*\n/u)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((body, i) => ({ index: i + 1, label: `§ ${i + 1}`, body }));

/**
 * At most MAX_UNITS units: past it, runs of neighbouring units are joined into one, labelled from the first to the
 * last, so no text is left out.
 */
export const capUnits = (units: ExtractedUnit[]): ExtractedUnit[] => {
  if (units.length <= MAX_UNITS) {
    return units;
  }
  const size = Math.ceil(units.length / MAX_UNITS);
  const joined: ExtractedUnit[] = [];
  for (let start = 0; start < units.length; start += size) {
    const run = units.slice(start, start + size);
    const first = run[0];
    const last = run.at(-1);
    if (!first || !last) {
      continue;
    }
    joined.push({
      index: joined.length + 1,
      label: (first === last ? first.label : `${first.label} – ${last.label}`).slice(0, MAX_LABEL),
      body: run.map((unit) => unit.body).join('\n\n'),
    });
  }
  return joined;
};

/**
 * Text as stored: NUL, which Postgres can't hold, goes; the other control characters (but tabs and line breaks), which
 * nobody reads and JSON writes six bytes long, become spaces, as a reader sees them.
 */
const clean = (text: string): string =>
  text.replaceAll('\u0000', '').replace(/(?![\t\n\r])\p{Cc}/gu, ' ');

/** What a copy of this type yields: its units, or no text at all. */
export const extract = async (contentType: string, bytes: Uint8Array): Promise<Extraction> => {
  const units =
    contentType === 'application/pdf'
      ? await pdfUnits(bytes)
      : contentType === 'text/html'
        ? htmlUnits(bytes)
        : contentType === 'text/plain'
          ? textUnits(bytes)
          : [];
  const cleaned = capUnits(
    units
      .map((unit) => ({ ...unit, label: clean(unit.label), body: clean(unit.body) }))
      .filter((unit) => unit.body.trim() !== ''),
  );
  return cleaned.length === 0 ? { status: 'not_applicable' } : { status: 'done', units: cleaned };
};
