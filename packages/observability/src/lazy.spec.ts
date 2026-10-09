import { describe, expect, it, vi } from 'vitest';

import { type Capture, installLazyReporting } from './lazy.js';

const errorEvent = (error: unknown) => Object.assign(new Event('error'), { error });
const rejection = (reason: unknown) => Object.assign(new Event('unhandledrejection'), { reason });

const setup = () => {
  const target = new EventTarget();
  const capture = vi.fn<Capture>();
  let resolve: (capture: Capture) => void = () => undefined;
  const load = vi.fn(() => new Promise<Capture>((done) => (resolve = done)));
  installLazyReporting(target, load);
  return { target, capture, load, finishLoading: () => resolve(capture) };
};

describe('installLazyReporting', () => {
  it('loads nothing until an error happens', () => {
    const { load } = setup();

    expect(load).not.toHaveBeenCalled();
  });

  it('loads the SDK once and reports what was queued while it loaded', async () => {
    const { target, capture, load, finishLoading } = setup();
    const first = new Error('primero');
    const second = new Error('segundo');

    target.dispatchEvent(errorEvent(first));
    target.dispatchEvent(rejection(second));
    expect(load).toHaveBeenCalledOnce();
    finishLoading();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));

    expect(capture).toHaveBeenNthCalledWith(1, first, {
      type: 'auto.browser.global_handlers.onerror',
      handled: false,
    });
    expect(capture).toHaveBeenNthCalledWith(2, second, {
      type: 'auto.browser.global_handlers.onunhandledrejection',
      handled: false,
    });

    const third = new Error('tercero');
    target.dispatchEvent(errorEvent(third));
    expect(capture).toHaveBeenLastCalledWith(third, expect.anything());
    expect(load).toHaveBeenCalledOnce();
  });

  it('ignores error events without an error object', () => {
    const { target, load } = setup();

    target.dispatchEvent(errorEvent(undefined));
    target.dispatchEvent(errorEvent(null));

    expect(load).not.toHaveBeenCalled();
  });

  it('caps the queue while loading', async () => {
    const { target, capture, finishLoading } = setup();

    for (let index = 0; index < 25; index += 1) {
      target.dispatchEvent(errorEvent(new Error(`fallo ${index}`)));
    }
    finishLoading();

    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(10));
  });

  it('stops reporting if the SDK fails to load', async () => {
    const target = new EventTarget();
    const load = vi.fn(async (): Promise<Capture> => {
      throw new Error('chunk missing');
    });
    installLazyReporting(target, load);

    target.dispatchEvent(errorEvent(new Error('uno')));
    await Promise.resolve();
    target.dispatchEvent(errorEvent(new Error('dos')));

    expect(load).toHaveBeenCalledOnce();
  });
});
