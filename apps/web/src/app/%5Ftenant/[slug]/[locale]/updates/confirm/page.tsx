import type { Metadata } from 'next';

import { tokenMetadata, type TokenPageProps } from '@/token-metadata';
import { TokenPageView } from '@/token-page';

export const generateMetadata = (props: TokenPageProps): Promise<Metadata> =>
  tokenMetadata(props, 'confirm');

/** Confirming a signup (double opt-in, PLAN R119): the confirmation email's link. */
const Confirm = (props: TokenPageProps) => <TokenPageView props={props} page="confirm" />;

export default Confirm;
