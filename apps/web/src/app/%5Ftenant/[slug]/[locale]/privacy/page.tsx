import type { Metadata } from 'next';

import type { SitePageParams } from '@/site-page';

import { documentMetadata } from '@/document-metadata';
import { DocumentPageView } from '@/document-page';

export const generateMetadata = (props: SitePageParams): Promise<Metadata> =>
  documentMetadata(props, 'privacy');

/** The privacy policy the operator published (public-site spec §3.3), which the signup form links to. */
const Privacy = (props: SitePageParams) => <DocumentPageView props={props} page="privacy" />;

export default Privacy;
