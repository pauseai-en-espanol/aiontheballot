'use client';

import { SwitchField } from '@/ui/SwitchField';
import { sendToApi, type WriteError } from '@/write';

/**
 * Whether a draft election is announced, so the site's coming-soon page gives its name and date (PLAN R51): country
 * admins and platform admins, while it is a draft; a switch that saves as it is switched (PLAN R193). It needs the
 * election's name in the default language (the database's rule, which names nothing: its refusal is said at the
 * switch, admin forms §1.2).
 */
export const AnnounceForm = ({
  tenant,
  election,
  on,
  text,
}: {
  tenant: string;
  election: string;
  on: boolean;
  text: {
    label: string;
    hint: string;
    on: string;
    off: string;
    saved: string;
    /** When the election has no name in the site's default language yet. */
    needsName: string;
    errors: Record<WriteError, string>;
  };
}) => (
  <SwitchField
    label={text.label}
    hint={text.hint}
    on={on}
    save={(announced) =>
      sendToApi('PATCH', `/api/t/${encodeURIComponent(tenant)}/e/${encodeURIComponent(election)}`, {
        announced,
      })
    }
    refused={(answer) => (answer.error === 'incomplete' ? text.needsName : undefined)}
    text={text}
  />
);
