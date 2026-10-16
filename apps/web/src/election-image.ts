import type { ShareSize } from '@aiontheballot/og/sizes';

import type { PreviewAccess } from './data-stage';
import type { ElectionCardContent } from './election-share';

import { cardLogo } from './home-image';
import { shareImages } from './image-cache';

/**
 * An election view's share image, rendered once per content hash and process (R148), like the home's: the renderer
 * (a native module) loads only when an image is rendered, so a failure there fails images, never pages. The admin's
 * preview draws it with its own access to logos (PLAN R181). The hash covers everything drawn, each logo's by its
 * hash, so a picture drawn for the preview is the public's only if the public's data names the same content.
 */
export const electionImage = (
  slug: string,
  locale: string,
  size: ShareSize,
  hash: string,
  content: ElectionCardContent,
  preview?: PreviewAccess,
): Promise<Uint8Array> =>
  shareImages()(`${slug}/${locale}/${content.template}/${size}/${hash}`, async () => {
    const [cards, data, { renderPng }, { imageSize }] = await Promise.all([
      import('@aiontheballot/og/election-cards'),
      import('@aiontheballot/og/data-cards'),
      import('@aiontheballot/og/render'),
      import('@aiontheballot/og/image-size'),
    ]);
    const { card } = content;
    const operatorLogo = await cardLogo(slug, card.operatorLogo, imageSize, preview);
    const partyLogo =
      'partyLogo' in card ? await cardLogo(slug, card.partyLogo, imageSize, preview) : undefined;
    // The data cards', one per party or row (PLAN R173, R185): one that can't be read leaves its row without.
    const partyLogos =
      'partyLogos' in card && card.partyLogos
        ? await Promise.all(
            card.partyLogos.map((logo) => cardLogo(slug, logo ?? undefined, imageSize, preview)),
          )
        : undefined;
    const images = {
      ...(operatorLogo ? { operatorLogo } : {}),
      ...(partyLogo ? { partyLogo } : {}),
      ...(partyLogos ? { partyLogos } : {}),
    };
    switch (content.template) {
      case 'overview':
        return renderPng(data.overviewCard(content.card, size, images), size);
      case 'methodology':
        return renderPng(cards.methodologyCard(content.card, size, images), size);
      case 'corrections':
        return renderPng(cards.correctionsCard(content.card, size, images), size);
      case 'party':
        return renderPng(data.partyCard(content.card, size, images), size);
      case 'criterion':
        return renderPng(data.criterionCard(content.card, size, images), size);
      case 'cell':
        return renderPng(cards.cellCard(content.card, size, images), size);
      case 'table':
        return renderPng(data.tableCard(content.card, size, images), size);
    }
  });

/** Renders it in the background, while the page that names it goes out, so the crawler that follows finds it ready. */
export const warmElectionImage = (...args: Parameters<typeof electionImage>): void => {
  electionImage(...args).catch((error: unknown) => {
    console.error('Could not pre-render a share image', error);
  });
};
