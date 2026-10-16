import type { PickedPart } from './pick';

/**
 * What the browser's selection covers of each unit shown in `panel`: every element with `data-unit` (its place in the
 * list) holds its unit's body as one text node, so a selection boundary anywhere (in a label, between pages, outside
 * the panel) is placed before, inside or after each body, and only the bodies' text is taken.
 */
export const selectedParts = (panel: HTMLElement): PickedPart[] => {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return [];
  }
  const range = selection.getRangeAt(0);
  const parts: PickedPart[] = [];
  for (const element of panel.querySelectorAll<HTMLElement>('[data-unit]')) {
    const text = element.firstChild;
    const unit = Number(element.dataset.unit);
    if (!(text instanceof Text) || !Number.isInteger(unit)) {
      continue;
    }
    const body = document.createRange();
    body.selectNodeContents(text);
    // Where a boundary falls in this body: before it is its start, after it its end.
    const place = (node: Node, offset: number): number => {
      if (node === text) {
        return offset;
      }
      try {
        return body.comparePoint(node, offset) > 0 ? text.length : 0;
      } catch {
        // Another document or tree (a shadow root): not in this body.
        return 0;
      }
    };
    const [from, to] = [
      place(range.startContainer, range.startOffset),
      place(range.endContainer, range.endOffset),
    ];
    if (to > from) {
      parts.push({ unit, from, to });
    }
  }
  return parts;
};
