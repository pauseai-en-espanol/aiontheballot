'use client';

import { useRouter } from 'next/navigation';

import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Turns a site on or off (PLAN R129). On, its addresses serve it, coming soon until the deployment opens it; the
 * database refuses it on without an operator.
 */
export const SiteActiveForm = ({
  slug,
  active,
  text,
}: {
  slug: string;
  active: boolean;
  text: {
    turnOn: string;
    turnOff: string;
    turnedOn: string;
    turnedOff: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const toggle = async () => {
    const answer = await run(
      () => sendToApi('PUT', `/api/sites/${encodeURIComponent(slug)}/active`, { active: !active }),
      active ? text.turnedOff : text.turnedOn,
    );
    if (answer?.ok) {
      router.refresh();
    }
  };
  return (
    <div className={styles.form}>
      <div>
        <button
          className={active ? styles.secondaryButton : styles.button}
          type="button"
          aria-disabled={pending}
          aria-describedby="site-active-messages"
          onClick={() => {
            if (!pending) {
              void toggle();
            }
          }}
        >
          {active ? text.turnOff : text.turnOn}
        </button>
      </div>
      <FormMessages
        id="site-active-messages"
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
    </div>
  );
};
