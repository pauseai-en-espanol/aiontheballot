import type { Metadata } from 'next';

import { tokenMetadata, type TokenPageProps } from '@/token-metadata';
import { TokenPageView } from '@/token-page';

export const generateMetadata = (props: TokenPageProps): Promise<Metadata> =>
  tokenMetadata(props, 'unsubscribe');

/** Leaving the list, or "this wasn't me": every email's link. */
const Unsubscribe = (props: TokenPageProps) => <TokenPageView props={props} page="unsubscribe" />;

export default Unsubscribe;
