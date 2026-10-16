import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { SourceKind } from '@/elections/data';

import { fileFieldText, problemText, template, writeErrors } from '@/ui/text';

import type { SourceCopyChoice, SourceFormText } from './SourceForm';

import { COPY_TYPES, MAX_COPY_BYTES } from './copy';

type Translator = ReturnType<typeof getTranslator>;

export const sourceKinds = (t: Translator): Record<SourceKind, string> => ({
  pdf: t('admin.sources.kinds.pdf'),
  web_page: t('admin.sources.kinds.web_page'),
  social_post: t('admin.sources.kinds.social_post'),
  video: t('admin.sources.kinds.video'),
  audio: t('admin.sources.kinds.audio'),
  party_submission: t('admin.sources.kinds.party_submission'),
});

/** The source form's words. */
export const sourceFormText = (t: Translator): SourceFormText => ({
  title: t('admin.sources.fields.title'),
  titleHint: t('admin.sources.fields.titleHint'),
  kind: t('admin.sources.fields.kind'),
  kinds: sourceKinds(t),
  url: t('admin.sources.fields.url'),
  urlHint: t('admin.sources.fields.urlHint'),
  language: t('admin.sources.fields.language'),
  languageHint: t('admin.sources.fields.languageHint'),
  party: t('admin.sources.fields.party'),
  noParty: t('admin.sources.fields.noParty'),
  programme: t('admin.sources.fields.programme'),
  programmeHint: t('admin.sources.fields.programmeHint'),
  optional: t('admin.form.optional'),
  save: t('admin.sources.fields.save'),
  saved: t('admin.sources.fields.saved'),
  added: t('admin.sources.fields.added'),
  errors: writeErrors(t),
  problems: problemText(t),
  constraints: {
    source_documents_url_check: t('admin.sources.fields.urlInvalid'),
    locale_check: t('admin.sources.fields.languageInvalid'),
  },
  languages: {
    none: t('admin.form.language.none'),
    others: t('admin.form.language.others'),
    other: t('admin.form.language.other'),
    code: t('admin.form.language.code'),
  },
});

/** A new source's copy, chosen with it (PLAN R194), as this deployment offers it. */
export const sourceCopyChoice = (
  t: Translator,
  offered: { uploads: boolean; fetching: boolean },
): SourceCopyChoice => ({
  ...offered,
  accept: COPY_TYPES,
  maxBytes: MAX_COPY_BYTES,
  text: {
    legend: t('admin.sources.copyChoice.legend'),
    later: t('admin.sources.copyChoice.later'),
    upload: t('admin.sources.copyChoice.upload'),
    fetch: t('admin.sources.copyChoice.fetch'),
    needsUrl: t('admin.sources.copyChoice.needsUrl'),
    failed: template(t, 'admin.sources.copyChoice.failed'),
    file: t('admin.sources.copy.file'),
    fileHint: t('admin.sources.copy.fileHint'),
    contributor: t('admin.sources.copy.contributor'),
    final: t('admin.sources.copy.final'),
    fileField: fileFieldText(t),
  },
});
