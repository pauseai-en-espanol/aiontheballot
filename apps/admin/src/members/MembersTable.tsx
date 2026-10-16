'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import type { Member, TenantRole } from '@/data';

import { fill } from '@/fill';
import { ConfirmButton } from '@/ui/ConfirmButton';
import * as styles from '@/ui/styles';
import { sendToApi, type WriteError } from '@/write';

export interface MembersText {
  caption: string;
  name: string;
  email: string;
  roles: string;
  roleNames: Record<TenantRole, string>;
  /** What each role allows, under its box in the roles dialog. */
  roleHints: Record<TenantRole, string>;
  unknownAccount: string;
  you: string;
  onlyCountryAdmin: string;
  cancel: string;
  /** The column of what a manager does for a member. */
  actions: string;
  /** Templates with `{name}`, but the button's text and the save button's. */
  editRoles: {
    button: string;
    label: string;
    title: string;
    intro: string;
    save: string;
    saved: string;
    loseAccess: string;
    loseAccessSelf: string;
  };
  /** Templates with `{name}`, but the button's text and the dialog's title and confirmation. */
  reset: {
    button: string;
    label: string;
    title: string;
    body: string;
    confirm: string;
    done: string;
  };
  errors: Record<WriteError, string>;
}

const ROLES: readonly TenantRole[] = ['country_admin', 'editor', 'reviewer'];
const ALERT_ID = 'members-error';

/**
 * The tenant's members (editorial workflow A7): names and roles for everyone, emails when the API gives them (country
 * and platform admins), and for those who manage members a dialog to set a member's roles at once, a box per role
 * (asked by Dani: the inline forms read as clutter). The tenant's only country admin keeps that role (A7.4): its box
 * is checked and disabled, with the reason, and the API refuses it anyway. Unticking every role warns that the member
 * loses the site. Each save is announced in the status line and each refusal in the alert, which stay put while the
 * page reloads its data, even when a member leaves the list. With the platform's email, they can also send a member a
 * password reset email (PLAN R170), after a confirmation: the member alone gets the link.
 */
export const MembersTable = ({
  tenant,
  selfId,
  platformAdmin,
  members,
  canManage,
  emailsShown,
  resetReady,
  text,
}: {
  tenant: string;
  selfId: string;
  /** A platform admin keeps the site after removing their own roles in it. */
  platformAdmin: boolean;
  members: Member[];
  canManage: boolean;
  emailsShown: boolean;
  /** Whether the API can send password reset emails. */
  resetReady: boolean;
  text: MembersText;
}) => {
  const router = useRouter();
  const [editing, setEditing] = useState<Member>();
  const [chosen, setChosen] = useState<readonly TenantRole[]>([]);
  const [pending, setPending] = useState(false);
  // Read synchronously, so a double click sends one write, not two.
  const busy = useRef(false);
  const [error, setError] = useState<WriteError>();
  const [status, setStatus] = useState('');
  // Where focus goes once a change is made: the status line, since the button pressed may be gone after the reload.
  const statusLine = useRef<HTMLParagraphElement>(null);
  const saved = useRef(false);
  const countryAdmins = members.filter((m) => m.roles.includes('country_admin')).length;
  // A deleted account has no name: a short id tells several apart.
  const nameOf = (member: Member) =>
    `${member.name ?? `${text.unknownAccount} (${member.userId.slice(0, 8)})`}${
      member.userId === selfId ? ` (${text.you})` : ''
    }`;
  const resets = canManage && resetReady;
  const rolesPath = (member: Member) =>
    `/api/t/${encodeURIComponent(tenant)}/members/${encodeURIComponent(member.userId)}/roles`;
  // The site's only country admin keeps the role: someone else must hold it first.
  const lockedFor = (member: Member, role: TenantRole) =>
    role === 'country_admin' && member.roles.includes('country_admin') && countryAdmins === 1;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || busy.current) {
      return;
    }
    const member = editing;
    const added = ROLES.filter((role) => chosen.includes(role) && !member.roles.includes(role));
    const removed = member.roles.filter((role) => !chosen.includes(role));
    // The dialog closes first, so what follows is announced outside it; with a change, focus goes to the status line,
    // since the button pressed may be gone with the member (without one, it goes back to that button).
    saved.current = added.length + removed.length > 0;
    setEditing(undefined);
    if (!saved.current) {
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    setStatus('');
    // Added before removed, so a member never passes through having no role on the way.
    const writes = [
      ...added.map((role) => () => sendToApi('POST', rolesPath(member), { role })),
      ...removed.map((role) => () => sendToApi('DELETE', `${rolesPath(member)}/${role}`)),
    ];
    for (const write of writes) {
      const answer = await write();
      if (!answer.ok) {
        busy.current = false;
        setPending(false);
        setError(answer.error);
        statusLine.current?.focus();
        router.refresh();
        return;
      }
    }
    busy.current = false;
    setPending(false);
    // Someone who removed their own last role here can no longer open the site, unless they run the platform.
    if (member.userId === selfId && chosen.length === 0 && !platformAdmin) {
      window.location.assign('/');
      return;
    }
    setStatus(fill(text.editRoles.saved, { name: nameOf(member) }));
    statusLine.current?.focus();
    router.refresh();
  };

  // A member's buttons: in their own column, or on a phone under the member's roles.
  const rowActions = (member: Member, name: string) => (
    <div className={styles.rowActions}>
      <button
        className={styles.secondaryButton}
        type="button"
        aria-label={fill(text.editRoles.label, { name })}
        onClick={() => {
          setError(undefined);
          saved.current = false;
          setChosen(member.roles);
          setEditing(member);
        }}
      >
        {text.editRoles.button}
      </button>
      {/* A deleted account has nobody to send it to. */}
      {resets && member.name !== null ? (
        <ConfirmButton
          method="POST"
          path={`/api/t/${encodeURIComponent(tenant)}/members/${encodeURIComponent(member.userId)}/password-reset`}
          text={{
            button: text.reset.button,
            label: fill(text.reset.label, { name }),
            title: text.reset.title,
            body: fill(text.reset.body, { name }),
            confirm: text.reset.confirm,
            cancel: text.cancel,
            done: fill(text.reset.done, { name }),
            errors: text.errors,
          }}
        />
      ) : null}
    </div>
  );

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
              {emailsShown ? (
                <th scope="col" className={styles.wideColumn}>
                  {text.email}
                </th>
              ) : null}
              <th scope="col">{text.roles}</th>
              {canManage ? (
                <th scope="col" className={styles.wideColumn}>
                  {text.actions}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const name = nameOf(member);
              return (
                <tr key={member.userId}>
                  <th scope="row">
                    {name}
                    {/* On a phone the email column is hidden, and the email is here instead. */}
                    {emailsShown && member.email ? (
                      <span className={styles.narrowOnly}>{member.email}</span>
                    ) : null}
                  </th>
                  {emailsShown ? (
                    <td className={styles.wideColumn}>{member.email ?? '—'}</td>
                  ) : null}
                  <td>
                    <ul className={styles.tags}>
                      {ROLES.filter((role) => member.roles.includes(role)).map((role) => (
                        <li key={role} className={styles.tag} data-plain="">
                          {text.roleNames[role]}
                        </li>
                      ))}
                    </ul>
                    {/* On a phone the actions column is hidden, and its buttons are here instead. */}
                    {canManage ? (
                      <div className={styles.narrowActions}>{rowActions(member, name)}</div>
                    ) : null}
                  </td>
                  {canManage ? (
                    <td className={styles.wideColumn}>{rowActions(member, name)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog.Root
        open={editing !== undefined}
        finalFocusEl={() => (saved.current ? statusLine.current : null)}
        onOpenChange={({ open }) => {
          if (!open) {
            setEditing(undefined);
          }
        }}
      >
        <Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Positioner className={styles.dialogPositioner}>
            <Dialog.Content className={styles.dialog}>
              <Dialog.Title className={styles.dialogTitle}>
                {editing ? fill(text.editRoles.title, { name: nameOf(editing) }) : null}
              </Dialog.Title>
              {editing ? (
                <form className={styles.form} onSubmit={(event) => void save(event)}>
                  <Dialog.Description>
                    {fill(text.editRoles.intro, { name: nameOf(editing) })}
                  </Dialog.Description>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.visuallyHidden}>{text.roles}</legend>
                    {ROLES.map((role) => {
                      const id = `role-${role}`;
                      const locked = lockedFor(editing, role);
                      return (
                        <div key={role} className={styles.field}>
                          <span className={styles.checkboxField}>
                            <input
                              id={id}
                              className={styles.checkbox}
                              type="checkbox"
                              checked={chosen.includes(role)}
                              disabled={locked}
                              aria-describedby={`${id}-hint`}
                              onChange={(event) => {
                                const on = event.currentTarget.checked;
                                setChosen((roles) =>
                                  on ? [...roles, role] : roles.filter((held) => held !== role),
                                );
                              }}
                            />
                            <label className={styles.label} htmlFor={id}>
                              {text.roleNames[role]}
                            </label>
                          </span>
                          <span id={`${id}-hint`} className={styles.hint}>
                            {locked ? text.onlyCountryAdmin : text.roleHints[role]}
                          </span>
                        </div>
                      );
                    })}
                  </fieldset>
                  {chosen.length === 0 ? (
                    <p className={styles.notice}>
                      <span aria-hidden="true">⚠ </span>
                      {editing.userId === selfId
                        ? text.editRoles.loseAccessSelf
                        : fill(text.editRoles.loseAccess, { name: nameOf(editing) })}
                    </p>
                  ) : null}
                  <div className={styles.actions}>
                    <Dialog.CloseTrigger className={styles.secondaryButton} type="button">
                      {text.cancel}
                    </Dialog.CloseTrigger>
                    <button className={styles.button} type="submit" aria-disabled={pending}>
                      {text.editRoles.save}
                    </button>
                  </div>
                </form>
              ) : null}
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
};
