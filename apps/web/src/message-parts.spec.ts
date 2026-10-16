import { getTranslator } from '@aiontheballot/i18n/messages';
import { describe, expect, it } from 'vitest';

import { messageParts } from './message-parts';

describe('messageParts', () => {
  it('cuts a translated message around its values, wherever the language puts them', () => {
    const t = getTranslator('es');
    expect(messageParts((values) => t('cellPage.title', values), ['party', 'criterion'])).toEqual([
      { part: 'party' },
      ' · ',
      { part: 'criterion' },
    ]);
    expect(messageParts((values) => t('election.tableCaption', values), ['election'])).toEqual([
      { part: 'election' },
      ': la valoración de cada partido en cada criterio',
    ]);
  });

  it('keeps a message without the values whole', () => {
    expect(messageParts(() => 'Sin valores', ['party'])).toEqual(['Sin valores']);
  });
});
