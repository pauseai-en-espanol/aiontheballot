import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { LocaleOption } from '@/ui/LocalizedField';

import { imageFieldText } from '@/changes/text';
import { languageName } from '@/ui/locales';
import { problemText, template, writeErrors } from '@/ui/text';

import type { OrganizationFormText } from './OrganizationForm';

type Translator = ReturnType<typeof getTranslator>;

/** The organization form's words. */
export const organizationFormText = (t: Translator, save: string): OrganizationFormText => ({
  displayName: t('admin.organizations.form.displayName'),
  displayNameHint: t('admin.organizations.form.displayNameHint'),
  needed: t('admin.localized.needed'),
  fields: {
    legalName: {
      label: t('admin.organizations.form.legalName'),
      hint: t('admin.organizations.form.legalNameHint'),
    },
    // Only an operator's legal details are published (its legal notice); an endorser's record keeps none (D18).
    taxId: {
      label: t('admin.organizations.form.taxId'),
      hint: t('admin.organizations.form.legalOnlyHint'),
    },
    address: {
      label: t('admin.organizations.form.address'),
      hint: t('admin.organizations.form.legalOnlyHint'),
    },
    registryEntry: {
      label: t('admin.organizations.form.registryEntry'),
      hint: `${t('admin.organizations.form.registryEntryHint')} ${t('admin.organizations.form.legalOnlyHint')}`,
    },
    contactEmail: {
      label: t('admin.organizations.form.contactEmail'),
      hint: t('admin.organizations.form.contactEmailHint'),
    },
    privacyEmail: {
      label: t('admin.organizations.form.privacyEmail'),
      hint: t('admin.organizations.form.privacyEmailHint'),
    },
    url: { label: t('admin.organizations.form.url'), hint: t('admin.organizations.form.linkHint') },
    newsletterUrl: {
      label: t('admin.organizations.form.newsletterUrl'),
      hint: t('admin.organizations.form.linkHint'),
    },
  },
  optional: t('admin.organizations.form.optional'),
  pauseai: t('admin.organizations.form.pauseai'),
  pauseaiHint: t('admin.organizations.form.pauseaiHint'),
  logo: t('admin.organizations.form.logo'),
  logoHint: t('admin.organizations.form.logoHint'),
  logoAlt: template(t, 'admin.organizations.form.logoAlt'),
  image: imageFieldText(t),
  logoFailed: template(t, 'admin.organizations.form.logoFailed'),
  save,
  saved: t('admin.organizations.form.saved'),
  errors: writeErrors(t),
  problems: problemText(t),
  constraints: {
    legal_name: t('admin.organizations.constraints.legalName'),
    localized_check: t('admin.organizations.constraints.displayName'),
    pauseai: t('admin.organizations.constraints.pauseai'),
    organizations_contact_email_check: t('admin.organizations.constraints.email'),
    organizations_privacy_email_check: t('admin.organizations.constraints.email'),
    organizations_url_check: t('admin.organizations.constraints.link'),
    organizations_newsletter_url_check: t('admin.organizations.constraints.link'),
  },
});

/**
 * The languages an organization's name may be in (every site's): the admin's own first, then by name. None is required
 * on its own; the name needs one.
 */
export const organizationLocales = (codes: readonly string[], uiLocale: string): LocaleOption[] =>
  codes
    .map((code) => ({ code, label: languageName(code, uiLocale), required: false }))
    .sort(
      (a, b) =>
        Number(b.code === uiLocale) - Number(a.code === uiLocale) ||
        a.label.localeCompare(b.label, uiLocale),
    );
