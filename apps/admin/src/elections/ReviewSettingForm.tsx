'use client';

import { SwitchField } from '@/ui/SwitchField';
import { sendToApi, type WriteError } from '@/write';

/**
 * Whether publishing in the election needs a second reviewer (four-eyes, editorial workflow P1): only platform admins
 * change it, audited, with a switch that saves as it is switched (PLAN R193). Turning it off asks first, and says what
 * it means (P1.2): one person may then publish their own work, which is recorded privately as self-reviewed.
 */
export const ReviewSettingForm = ({
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
    confirmTitle: string;
    confirmBody: string;
    confirm: string;
    cancel: string;
    errors: Record<WriteError, string>;
  };
}) => (
  <SwitchField
    label={text.label}
    hint={text.hint}
    on={on}
    save={(requireSecondReviewer) =>
      sendToApi('PATCH', `/api/t/${encodeURIComponent(tenant)}/e/${encodeURIComponent(election)}`, {
        requireSecondReviewer,
      })
    }
    confirmOff={{
      title: text.confirmTitle,
      body: text.confirmBody,
      confirm: text.confirm,
      cancel: text.cancel,
    }}
    text={text}
  />
);
