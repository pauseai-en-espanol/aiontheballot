import type { Metadata } from 'next';

import type { SitePageParams } from '@/site-page';

import { documentMetadata } from '@/document-metadata';
import { DocumentPageView } from '@/document-page';

export const generateMetadata = (props: SitePageParams): Promise<Metadata> =>
  documentMetadata(props, 'about');

/** The operator's text about itself (public-site spec §3.3). */
const About = (props: SitePageParams) => <DocumentPageView props={props} page="about" />;

export default About;
