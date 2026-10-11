/**
 * The field a refusal without a constraint is about (the form names constraints itself): the API's, for a blank legal
 * name or name; else, when the organization is no longer a PauseAI chapter, the database's trigger that keeps a site's
 * restricted brand assets to PauseAI chapters' sites (P3). Anything else has no field to point at.
 */
export const refusedField = (body: {
  legalName: string;
  displayName: Readonly<Record<string, string>>;
  isPauseaiChapter: boolean;
}): string | undefined => {
  if (body.legalName.trim() === '') {
    return 'legal_name';
  }
  if (Object.values(body.displayName).every((value) => value.trim() === '')) {
    return 'localized_check';
  }
  return body.isPauseaiChapter ? undefined : 'pauseai';
};
