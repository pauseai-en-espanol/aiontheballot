'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { fill } from '@/fill';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface OrderedItem {
  id: string;
  name: string;
  lang: string;
  /** Short facts shown beside the name: its slug, short name, and so on. */
  details: string[];
  href: string;
}

/**
 * An election's parties or criteria in their display order (editorial workflow E4.5), each with a link to its form. In
 * a draft election, editors move them up or down with buttons, so the order can be changed by keyboard; the whole new
 * order is sent at once, and refused (409) if the list changed meanwhile. After a move, focus follows the moved item's
 * button, or the status line when that button is gone (at either end).
 */
export const OrderedList = ({
  items,
  orderPath,
  canReorder,
  label,
  text,
}: {
  items: OrderedItem[];
  orderPath: string;
  canReorder: boolean;
  label: string;
  text: {
    up: string;
    down: string;
    /** With `{name}`. */
    upLabel: string;
    downLabel: string;
    moved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  // The order shown: the server's, kept for a moved item until the reload brings it, and taken again whenever the
  // server's changes (someone else's move).
  const serverOrder = items.map((item) => item.id).join(',');
  const [order, setOrder] = useState(items.map((item) => item.id));
  const [synced, setSynced] = useState(serverOrder);
  if (serverOrder !== synced) {
    setSynced(serverOrder);
    setOrder(items.map((item) => item.id));
  }
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  // Where focus goes once the moved item is rendered in its new place: the same direction's button if it can still
  // move that way, else the other one.
  const focusAfter = useRef<{ id: string; by: -1 | 1 } | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) {
      return;
    }
    focusAfter.current = null;
    const same = buttons.current.get(`${target.id}:${target.by < 0 ? 'up' : 'down'}`);
    const other = buttons.current.get(`${target.id}:${target.by < 0 ? 'down' : 'up'}`);
    (same ?? other ?? statusLine.current)?.focus();
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  // A refresh brings the server's order; until then the moved one is shown where it went.
  const shown =
    order.every((id) => byId.has(id)) && order.length === items.length
      ? order
      : items.map((i) => i.id);

  const move = async (index: number, by: -1 | 1) => {
    const next = [...shown];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(index + by, 0, moved);
    const answer = await run(
      () => sendToApi('PUT', orderPath, { shown, ids: next }),
      fill(text.moved, { name: byId.get(moved)?.name ?? '' }),
      { focus: false },
    );
    if (answer?.ok) {
      focusAfter.current = { id: moved, by };
      setOrder(next);
    }
  };

  return (
    <>
      <ol className={styles.ordered} aria-label={label}>
        {shown.map((id, index) => {
          const item = byId.get(id);
          if (!item) {
            return null;
          }
          return (
            <li key={id} className={styles.orderedItem}>
              <span className={styles.orderedName}>
                <Link className={styles.link} href={item.href} lang={item.lang}>
                  {item.name}
                </Link>
                <span className={styles.hint}>{item.details.join(' · ')}</span>
              </span>
              {canReorder ? (
                <span className={styles.buttonRow}>
                  {index > 0 ? (
                    <button
                      ref={(el) => {
                        buttons.current.set(`${id}:up`, el);
                      }}
                      className={styles.secondaryButton}
                      type="button"
                      aria-label={fill(text.upLabel, { name: item.name })}
                      aria-disabled={pending}
                      onClick={() => void move(index, -1)}
                    >
                      <span aria-hidden="true">↑ </span>
                      {text.up}
                    </button>
                  ) : null}
                  {index < shown.length - 1 ? (
                    <button
                      ref={(el) => {
                        buttons.current.set(`${id}:down`, el);
                      }}
                      className={styles.secondaryButton}
                      type="button"
                      aria-label={fill(text.downLabel, { name: item.name })}
                      aria-disabled={pending}
                      onClick={() => void move(index, 1)}
                    >
                      <span aria-hidden="true">↓ </span>
                      {text.down}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <FormMessages
        id="order-error"
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
    </>
  );
};
