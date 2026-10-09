export interface Mechanism {
  type: string;
  handled: boolean;
}

/** Reports one error; provided by the SDK once it has been loaded. */
export type Capture = (error: unknown, mechanism: Mechanism) => void;

// Errors raised while the SDK loads are kept, up to this many.
const MAX_QUEUED = 10;

/**
 * Error reporting that costs the page almost nothing until something fails (the public site, ADR-0003 §7). It
 * listens for uncaught errors and unhandled rejections, and only on the first one loads the SDK through `load`,
 * then reports everything queued meanwhile. Visitors who hit no error never download the SDK.
 *
 * These listeners are the only ones: the loaded SDK must not install its own global handlers, or errors would be
 * reported twice. If loading fails (offline, or a chunk gone after a deploy), reporting stops for this page.
 */
export const installLazyReporting = (target: EventTarget, load: () => Promise<Capture>): void => {
  const queue: [unknown, Mechanism][] = [];
  let capture: Capture | undefined;
  let loading: Promise<void> | undefined;

  const report = (error: unknown, mechanism: Mechanism) => {
    if (capture) {
      capture(error, mechanism);
      return;
    }
    if (queue.length < MAX_QUEUED) {
      queue.push([error, mechanism]);
    }
    loading ??= load().then(
      (loaded) => {
        capture = loaded;
        for (const [queued, queuedMechanism] of queue.splice(0)) {
          loaded(queued, queuedMechanism);
        }
      },
      () => {
        queue.length = 0;
      },
    );
  };

  target.addEventListener('error', (event) => {
    const { error } = event as ErrorEvent;
    // No error object means a cross-origin "Script error." with nothing to report.
    if (error !== undefined && error !== null) {
      report(error, { type: 'auto.browser.global_handlers.onerror', handled: false });
    }
  });
  target.addEventListener('unhandledrejection', (event) => {
    report((event as PromiseRejectionEvent).reason, {
      type: 'auto.browser.global_handlers.onunhandledrejection',
      handled: false,
    });
  });
};
