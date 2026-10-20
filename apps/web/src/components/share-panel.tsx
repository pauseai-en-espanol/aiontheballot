'use client';

import type { ShareSize } from '@aiontheballot/og/sizes';

import { css, cx } from '@styled-system/css';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import type { ShareNetwork } from '../share-links';

import { focusRing } from '../styles';
import { ShareIcon } from './share-icons';

/** The networks' own names: the same in every language. Email's is the page's words. */
const NETWORK_NAMES: Record<Exclude<ShareNetwork, 'email'>, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  x: 'X',
  facebook: 'Facebook',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
};

export interface SharePanelText {
  /** "Compartir": the one button, and the dialog's title. */
  button: string;
  /** "La imagen con los datos". */
  image: string;
  imageLead: string;
  /** Each size's name, as "Cuadrada, 1080 × 1080". */
  sizes: Partial<Record<ShareSize, string>>;
  /** "Compartir la imagen": to the phone's apps, with the file. */
  shareImage: string;
  download: string;
  /** Said when the image couldn't be handed to the device's apps. */
  imageFailed: string;
  /** "El enlace". */
  link: string;
  /** "Cerrar": the dialog's own way out. */
  close: string;
  email: string;
  /** "Compartir…": the device's own share sheet, for the link. */
  native: string;
  copy: string;
  copied: string;
  copyFailed: string;
  /** Said after each link, for screen readers: it opens in a new tab. */
  newTab: string;
}

const noSubscription = () => () => undefined;
/** What the browser can do, read after hydration: the server, and a browser without scripts, render neither button. */
const useCan = (check: () => boolean) => useSyncExternalStore(noSubscription, check, () => false);

/** Whether the device can hand a picture to its apps (phones: every app they have). */
const canShareFiles = () => {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([''], 'imagen.png', { type: 'image/png' })] })
    );
  } catch {
    return false;
  }
};

const item = cx(
  focusRing,
  css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '44px',
    paddingInline: '14px',
    border: '1px solid',
    borderColor: 'border.subtle',
    backgroundColor: 'bg.canvas',
    color: 'fg.default',
    fontSize: '16px',
    lineHeight: '1.2',
    cursor: 'pointer',
    textDecoration: 'none',
    _hover: { borderColor: 'border.default', bg: 'bg.subtle' },
  }),
);

/** A share link's tile, as wide as its column. */
const tile = cx(item, css({ width: '100%' }));

/** The page's one share button: solid ink, its icon beside its word. */
const trigger = cx(
  focusRing,
  css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '48px',
    paddingInline: '20px',
    border: '2px solid',
    borderColor: 'border.default',
    bg: 'bg.inverse',
    color: 'fg.inverse',
    fontSize: '17px',
    fontWeight: '700',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    _hover: { bg: 'bg.canvas', color: 'fg.default' },
  }),
);

/**
 * The dialog, laid out only while open (`:popover-open`), so a browser without popovers shows it in place, as a
 * panel: centred over the dimmed page, or on a phone a sheet up from the bottom edge, scrolling inside if it must.
 */
const dialog = css({
  '&:popover-open': {
    position: 'fixed',
    inset: '0',
    margin: 'auto',
    width: 'min(760px, calc(100vw - 32px))',
    height: 'fit-content',
    maxHeight: 'calc(100dvh - 32px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: { base: '20px', md: '28px' },
    bg: 'bg.canvas',
    color: 'fg.default',
    border: '2px solid',
    borderColor: 'border.default',
  },
  '@media (max-width: 639px)': {
    '&:popover-open': {
      insetBlock: 'auto 0',
      width: '100%',
      maxHeight: '88dvh',
      marginBlockEnd: '0',
      borderInline: 'none',
      borderBottom: 'none',
    },
  },
  '&::backdrop': { bg: 'bg.inverse/55' },
});

const groupLabel = css({ fontSize: '18px', fontWeight: '700' });

/**
 * "Compartir" beside the title of every election page (PLAN R185; R218, a dialog): one button opening a dialog with
 * no script (the `popover` attribute), closed by its own button, Escape or a click outside. First the link, what most
 * people send, whose preview is itself the page's data card: copied, the device's share sheet, and a plain link per
 * network, which load nothing from any network until followed (R177). Then the data image, the page's own card (on
 * the scorecard, the whole table), in the three shapes people post: each handed to the phone's apps with the picture
 * itself where the device can, and always downloadable. Icons always beside the names.
 */
export const SharePanel = ({
  links,
  url,
  text,
  image,
  words,
}: {
  links: { network: ShareNetwork; href: string }[];
  /** The page's canonical address. */
  url: string;
  /** The page's title. */
  text: string;
  /** The data image: its words, and each shape's address and file name. */
  image: { alt: string; downloads: { size: ShareSize; href: string; fileName: string }[] };
  words: SharePanelText;
}) => {
  const canShare = useCan(() => typeof navigator.share === 'function');
  const canCopy = useCan(() => typeof navigator.clipboard?.writeText === 'function');
  const canFiles = useCan(canShareFiles);
  const [status, setStatus] = useState('');
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  // Opened, its close button takes the focus, so a keyboard starts inside it; closed, the browser gives the focus back
  // to the share button, and what it said goes.
  useEffect(() => {
    const panel = document.getElementById(id);
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'open') {
        close.current?.focus();
      } else {
        setStatus('');
      }
    };
    panel?.addEventListener('toggle', onToggle);
    return () => panel?.removeEventListener('toggle', onToggle);
  }, [id]);
  const copy = () => {
    navigator.clipboard.writeText(url).then(
      () => setStatus(words.copied),
      () => setStatus(words.copyFailed),
    );
  };
  // A cancelled share sheet rejects too: nothing to say.
  const share = () => {
    navigator.share({ title: text, url }).catch(() => undefined);
  };
  const shareImage = async (href: string, fileName: string) => {
    setStatus('');
    try {
      const blob = await (await fetch(href)).blob();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (!navigator.canShare({ files: [file] })) {
        setStatus(words.imageFailed);
        return;
      }
      await navigator.share({ files: [file], title: text, text: url });
    } catch (error) {
      if ((error as { name?: unknown }).name !== 'AbortError') {
        setStatus(words.imageFailed);
      }
    }
  };
  const [square] = image.downloads;
  return (
    <div data-share-panel="">
      <button type="button" popoverTarget={id} className={trigger}>
        <ShareIcon mark="share" />
        {words.button}
      </button>
      <div id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`} className={dialog}>
        <div
          className={css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            marginBottom: '20px',
          })}
        >
          <h2
            id={`${id}-title`}
            className={css({
              fontFamily: 'display',
              fontWeight: '700',
              textTransform: 'uppercase',
              fontSize: '28px',
              lineHeight: '1',
            })}
          >
            {words.button}
          </h2>
          <button
            ref={close}
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            className={cx(
              focusRing,
              css({
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '44px',
                paddingInline: '12px',
                fontSize: '16px',
                cursor: 'pointer',
                _hover: { textDecoration: 'underline', textUnderlineOffset: '3px' },
              }),
            )}
          >
            {words.close}
            <svg
              aria-hidden="true"
              focusable="false"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className={css({ display: 'grid', gap: '28px' })}>
          <div
            role="group"
            aria-labelledby={`${id}-link`}
            className={css({ display: 'grid', gap: '10px' })}
          >
            <p id={`${id}-link`} className={groupLabel}>
              {words.link}
            </p>
            <ul
              className={css({
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '8px',
                listStyle: 'none',
              })}
            >
              {canCopy && (
                <li>
                  <button type="button" className={tile} onClick={copy} data-share="copy">
                    <ShareIcon mark="copy" />
                    {words.copy}
                  </button>
                </li>
              )}
              {canShare && (
                <li>
                  <button type="button" className={tile} onClick={share} data-share="native">
                    <ShareIcon mark="share" />
                    {words.native}
                  </button>
                </li>
              )}
              {links.map(({ network, href }) =>
                network === 'email' ? (
                  // The mail app opens; a new tab would stay blank.
                  <li key={network}>
                    <a href={href} className={tile} data-share={network}>
                      <ShareIcon mark={network} />
                      {words.email}
                    </a>
                  </li>
                ) : (
                  <li key={network}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={tile}
                      data-share={network}
                    >
                      <ShareIcon mark={network} />
                      {NETWORK_NAMES[network]}
                      <span className={css({ srOnly: true })}> {words.newTab}</span>
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
          <div
            role="group"
            aria-labelledby={`${id}-image`}
            className={css({ display: 'grid', gap: '10px' })}
          >
            <p id={`${id}-image`} className={groupLabel}>
              {words.image}
            </p>
            <p className={css({ color: 'fg.muted', fontSize: '16px', maxWidth: '60ch' })}>
              {words.imageLead}
            </p>
            <div
              className={css({
                display: 'grid',
                gridTemplateColumns: { base: '1fr', sm: '180px minmax(0, 1fr)' },
                gap: '16px',
                alignItems: 'start',
              })}
            >
              {square ? (
                // The picture itself, as it will be posted: loaded only once the dialog is open.
                // oxlint-disable-next-line next/no-img-element
                <img
                  src={square.href}
                  alt={image.alt}
                  width={180}
                  height={180}
                  loading="lazy"
                  className={css({
                    display: 'block',
                    width: { base: '140px', sm: '180px' },
                    height: 'auto',
                    border: '1px solid',
                    borderColor: 'border.subtle',
                  })}
                />
              ) : null}
              <ul className={css({ listStyle: 'none', display: 'grid', minWidth: '0' })}>
                {image.downloads.map(({ size, href, fileName }) => (
                  <li
                    key={size}
                    className={css({
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px 12px',
                      paddingBlock: '8px',
                      borderBottom: '1px solid',
                      borderColor: 'border.subtle',
                    })}
                  >
                    <span className={css({ fontSize: '16px' })}>{words.sizes[size]}</span>
                    <span className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px' })}>
                      {canFiles && (
                        <button
                          type="button"
                          className={item}
                          data-share="image"
                          aria-label={`${words.shareImage}: ${words.sizes[size] ?? size}`}
                          onClick={() => void shareImage(href, fileName)}
                        >
                          <ShareIcon mark="share" />
                          {words.shareImage}
                        </button>
                      )}
                      <a
                        href={href}
                        download={fileName}
                        className={item}
                        data-share="download"
                        aria-label={`${words.download}: ${words.sizes[size] ?? size}`}
                      >
                        <ShareIcon mark="download" />
                        {words.download}
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p role="status" className={css({ fontSize: '16px', minHeight: '1.5em' })}>
            {status}
          </p>
        </div>
      </div>
    </div>
  );
};
