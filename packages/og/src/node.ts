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

/** An element; satori lays out every element with more than one child as a flex container, so say which way. */
export const h = (type: string, style: Style, ...children: OgChild[]): OgNode => ({
  type,
  // No children at all, not an empty list: satori lays out a list as a container.
  props:
    children.length === 0
      ? { style }
      : { style, children: children.length === 1 ? children[0] : children },
});

/** An image from a data URI; satori needs its size. */
export const img = (src: string, width: number, height: number): OgNode => ({
  type: 'img',
  props: { src, width, height, style: { width, height } },
});
