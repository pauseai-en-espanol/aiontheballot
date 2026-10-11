'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import type { Member, TenantRole } from '@/data';

import { fill } from '@/fill';
import * as styles from '@/ui/styles';
import { sendToApi, type WriteError } from '@/write';

export interface MembersText {
  caption: string;
  name: string;
  email: string;
  roles: string;
  roleNames: Record<TenantRole, string>;
  unknownAccount: string;
  you: string;
  remove: string;
  /** Templates with `{role}` and `{name}`. */
  removeLabel: string;
  confirmBody: string;
  confirmSelf: string;
  removed: string;
  addLabel: string;
  added: string;
  onlyCountryAdmin: string;
  confirmTitle: string;
  confirm: string;
  cancel: string;
  add: string;
  errors: Record<WriteError, string>;
}

const ROLES: readonly TenantRole[] = ['country_admin', 'editor', 'reviewer'];
const ALERT_ID = 'members-error';

/**
 * The tenant's members (editorial workflow A7): names and roles for everyone, emails when the API gives them (country
 * and platform admins), and for those who manage members the means to remove a role, after a confirmation, or give a
 * member another. The tenant's only country admin can't be removed (A7.4): the button is replaced by the reason, and
 * the API refuses it anyway. Each change is announced in the status line and each refusal in the alert, which stay
 * put while the page reloads its data, even when a member leaves the list.
 */
export const MembersTable = ({
  tenant,
  selfId,
  platformAdmin,
  locale,
  members,
  canManage,
  emailsShown,
  text,
}: {
  tenant: string;
  selfId: string;
  /** A platform admin keeps the site after removing their own roles in it. */
  platformAdmin: boolean;
  /** The page's language, for role names inside sentences. */
  locale: string;
  members: Member[];
  canManage: boolean;
  emailsShown: boolean;
  text: MembersText;
}) => {
  const router = useRouter();
  const [confirming, setConfirming] = useState<{ member: Member; role: TenantRole }>();
  const [pending, setPending] = useState(false);
  // Read synchronously, so a double click sends one write, not two.
  const busy = useRef(false);
  const [error, setError] = useState<WriteError>();
  const [status, setStatus] = useState('');
  // Where focus goes once a change is made: the status line, since the button pressed may be gone after the reload.
  const statusLine = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const countryAdmins = members.filter((m) => m.roles.includes('country_admin')).length;
  // A deleted account has no name: a short id tells several apart.
  const nameOf = (member: Member) =>
    `${member.name ?? `${text.unknownAccount} (${member.userId.slice(0, 8)})`}${
      member.userId === selfId ? ` (${text.you})` : ''
    }`;
  const roleIn = (role: TenantRole) => text.roleNames[role].toLocaleLowerCase(locale);
  const rolesPath = (member: Member) =>
    `/api/t/${encodeURIComponent(tenant)}/members/${encodeURIComponent(member.userId)}/roles`;

  const remove = async () => {
    if (!confirming || busy.current) {
      return;
    }
    const { member, role } = confirming;
    busy.current = true;
    setPending(true);
    setError(undefined);
    setStatus('');
    const answer = await sendToApi('DELETE', `${rolesPath(member)}/${role}`);
    busy.current = false;
    setPending(false);
    focusStatus.current = answer.ok;
    setConfirming(undefined);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    // Someone who removed their own last role here can no longer open the site, unless they run the platform.
    if (member.userId === selfId && member.roles.length === 1 && !platformAdmin) {
      window.location.assign('/');
      return;
    }
    setStatus(fill(text.removed, { role: roleIn(role), name: nameOf(member) }));
    router.refresh();
  };

  const add = (member: Member) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const role = new FormData(event.currentTarget).get('role');
    if (busy.current || typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    setStatus('');
    const answer = await sendToApi('POST', rolesPath(member), { role });
    busy.current = false;
    setPending(false);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setStatus(fill(text.added, { role: roleIn(role as TenantRole), name: nameOf(member) }));
    // The form goes once the member holds every role; focus stays on the page either way.
    statusLine.current?.focus();
    router.refresh();
  };

  return (
    <>
      <div id={ALERT_ID} role="alert">
        {error ? (
          <p className={styles.alert}>
            <span>
              <span aria-hidden="true">⚠ </span>
              {text.errors[error]}
            </span>
          </p>
        ) : null}
      </div>
      <p ref={statusLine} role="status" tabIndex={-1} className={styles.status}>
        {status}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption>{text.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{text.name}</th>
              {emailsShown ? <th scope="col">{text.email}</th> : null}
              <th scope="col">{text.roles}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const name = nameOf(member);
              const missing = ROLES.filter((role) => !member.roles.includes(role));
              const selectId = `add-role-${member.userId}`;
              return (
                <tr key={member.userId}>
                  <th scope="row">{name}</th>
                  {emailsShown ? <td>{member.email ?? '—'}</td> : null}
                  <td>
                    <div className={styles.form}>
                      <ul className={styles.tags}>
                        {member.roles.map((role) => {
                          const locked = role === 'country_admin' && countryAdmins === 1;
                          return (
                            <li
                              key={role}
                              className={styles.tag}
                              data-plain={canManage && !locked ? undefined : ''}
                            >
                              {text.roleNames[role]}
                              {canManage && !locked ? (
                                <button
                                  className={styles.tagButton}
                                  type="button"
                                  aria-label={fill(text.removeLabel, {
                                    role: roleIn(role),
                                    name,
                                  })}
                                  onClick={() => {
                                    setError(undefined);
                                    focusStatus.current = false;
                                    setConfirming({ member, role });
                                  }}
                                >
                                  {text.remove}
                                </button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {canManage &&
                      member.roles.includes('country_admin') &&
                      countryAdmins === 1 ? (
                        <p className={styles.hint}>{text.onlyCountryAdmin}</p>
                      ) : null}
                      {canManage && missing.length > 0 ? (
                        <form className={styles.inlineForm} onSubmit={add(member)}>
                          <span className={styles.field}>
                            <label className={styles.label} htmlFor={selectId}>
                              {fill(text.addLabel, { name })}
                            </label>
                            <select
                              id={selectId}
                              className={styles.select}
                              name="role"
                              aria-describedby={error ? ALERT_ID : undefined}
                            >
                              {missing.map((role) => (
                                <option key={role} value={role}>
                                  {text.roleNames[role]}
                                </option>
                              ))}
                            </select>
                          </span>
                          <button
                            className={styles.secondaryButton}
                            type="submit"
                            aria-disabled={pending}
                          >
                            {text.add}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog.Root
        role="alertdialog"
        open={confirming !== undefined}
        // After a removal, to the status line that says so; after Cancel, back to the button.
        finalFocusEl={() => (focusStatus.current ? statusLine.current : null)}
        onOpenChange={({ open }) => {
          if (!open) {
            setConfirming(undefined);
          }
        }}
      >
        <Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Positioner className={styles.dialogPositioner}>
            <Dialog.Content className={styles.dialog}>
              <Dialog.Title className={styles.dialogTitle}>{text.confirmTitle}</Dialog.Title>
              <Dialog.Description>
                {confirming
                  ? fill(
                      confirming.member.userId === selfId ? text.confirmSelf : text.confirmBody,
                      {
                        role: roleIn(confirming.role),
                        name: nameOf(confirming.member),
                      },
                    )
                  : null}
              </Dialog.Description>
              <div className={styles.actions}>
                <Dialog.CloseTrigger className={styles.secondaryButton}>
                  {text.cancel}
                </Dialog.CloseTrigger>
                <button
                  className={styles.button}
                  type="button"
                  aria-disabled={pending}
                  onClick={() => void remove()}
                >
                  {text.confirm}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
};
