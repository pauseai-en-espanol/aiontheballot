// html-encoding-sniffer ships no types: the one function the worker uses, as its README documents it.
declare module 'html-encoding-sniffer' {
  /** The canonical name of the encoding an HTML byte stream is in, by the HTML Standard's sniffing algorithm. */
  export default function htmlEncodingSniffer(
    bytes: Uint8Array,
    options?: {
      xml?: boolean;
      transportLayerEncodingLabel?: string;
      defaultEncoding?: string;
      maxPrescanBytes?: number;
    },
  ): string;
}
