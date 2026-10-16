'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import type { BrandSlot } from '@/data';
import type { ImageChoice } from '@/ui/image-field';

import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { ImageField, type ImageFieldText } from '@/ui/ImageField';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, uploadToApi, type WriteAnswer, type WriteError } from '@/write';

export interface BrandImagesText {
  /** Each slot's name and what it is for. */
  slots: Record<string, { label: string; hint: string }>;
  /** A slot that names an image of the platform's: with `{name}`. */
  platformImage: string;
  optional: string;
  /** An image's alternative text: with `{slot}`. */
  alt: string;
  save: string;
  saved: string;
  image: ImageFieldText;
  errors: Record<WriteError, string>;
}

/**
 * The site's brand images (admin forms §2, settings; PLAN R195): one image field per slot, each saying where the image
 * shows, and one "Save" that uploads what was chosen and empties what was removed, slot by slot; a refusal is said at
 * its slot. Only the site's country admins and platform admins get it; the API and the database check that again. A
 * slot that names an image of the platform's says so: an upload of the site's own replaces it.
 */
export const BrandImagesForm = ({
  tenant,
  slots,
  locale,
  text,
}: {
  tenant: string;
  slots: BrandSlot[];
  locale: string;
  text: BrandImagesText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const [choices, setChoices] = useState<Record<string, ImageChoice>>({});
  const [refused, setRefused] = useState<Record<string, string>>({});
  const path = (slot: string) =>
    `/api/t/${encodeURIComponent(tenant)}/brand/${encodeURIComponent(slot)}`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefused({});
    const failed: Record<string, string> = {};
    const answer = await run(async () => {
      for (const [slot, choice] of Object.entries(choices)) {
        const sent: WriteAnswer =
          choice.kind === 'new'
            ? await uploadToApi(path(slot), choice.file)
            : choice.kind === 'remove'
              ? await sendToApi('DELETE', path(slot))
              : { ok: true };
        if (!sent.ok) {
          failed[slot] = text.errors[sent.error ?? 'unexpected'];
        }
      }
      // What was saved shows once the page reloads its data; what wasn't stays chosen, its refusal at its slot.
      setChoices((current) =>
        Object.fromEntries(Object.entries(current).filter(([slot]) => slot in failed)),
      );
      return Object.keys(failed).length === 0 ? { ok: true } : { ok: false, error: 'invalid' };
    }, text.saved);
    if (answer && !answer.ok && Object.keys(failed).length > 0) {
      setError(undefined);
      setRefused(failed);
      router.refresh();
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {slots.map(({ slot, file, asset }) => {
        const words = text.slots[slot] ?? { label: slot, hint: '' };
        const choice = choices[slot] ?? { kind: 'keep' };
        return (
          <ImageField
            key={slot}
            label={words.label}
            hint={
              asset && !file && choice.kind === 'keep'
                ? `${words.hint} ${text.platformImage.replace('{name}', asset.name)}`
                : words.hint
            }
            optional={text.optional}
            current={file ? `/api/t/${encodeURIComponent(tenant)}/images/${file.id}` : null}
            alt={text.alt.replace('{slot}', words.label)}
            value={choice}
            onChange={(next) => {
              setChoices((current) => ({ ...current, [slot]: next }));
              setRefused(({ [slot]: _, ...rest }) => rest);
            }}
            error={refused[slot]}
            locale={locale}
            text={text.image}
          />
        );
      })}
      <FormMessages id="brand-error" error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
