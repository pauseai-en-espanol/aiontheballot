/**
 * A satori element in object form, so the templates need neither React nor JSX: satori reads `type` and `props`
 * exactly as it reads what JSX produces.
 */
export interface OgNode {
  type: string;
  props: {
    style?: Style;
    children?: OgChild | OgChild[];
    src?: string;
    width?: number;
    height?: number;
  };
}

export type OgChild = OgNode | string;

export type Style = Readonly<Record<string, string | number>>;

/**
 * Sizes include padding and borders, as the templates are drawn: satori follows CSS's `content-box` by default since
 * 0.42, which made every padded box larger than the card.
 */
const BOX: Style = { boxSizing: 'border-box' };

/** An element; satori lays out every element with more than one child as a flex container, so say which way. */
export const h = (type: string, style: Style, ...children: OgChild[]): OgNode => ({
  type,
  // No children at all, not an empty list: satori lays out a list as a container.
  props:
    children.length === 0
      ? { style: { ...BOX, ...style } }
      : { style: { ...BOX, ...style }, children: children.length === 1 ? children[0] : children },
});

/** An image from a data URI; satori needs its size. */
export const img = (src: string, width: number, height: number): OgNode => ({
  type: 'img',
  props: { src, width, height, style: { ...BOX, width, height } },
});
