import type { InLanguage } from '@/localized';

/** Text in the page's language as it is; in any other, marked with its own. */
export const Lang = ({ value, page }: { value: InLanguage; page: string }) =>
  value.lang === page ? <>{value.text}</> : <span lang={value.lang}>{value.text}</span>;
