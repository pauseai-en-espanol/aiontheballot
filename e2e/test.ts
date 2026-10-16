import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  expect,
} from '@playwright/test';

/** Records the Content Security Policy violations any page of `context` logs, popups included. */
const watch = (context: BrowserContext, violations: string[]): void => {
  context.on('console', (message) => {
    if (/Content Security Policy/iu.test(message.text())) {
      violations.push(`${message.location().url}: ${message.text()}`);
    }
  });
};

/**
 * Playwright's `test`, failing any test whose pages log a Content Security Policy violation: every page the suite
 * visits, public or admin, is checked against its policy, not only those whose tests say so. A violation is a script,
 * style or request the page needed and the policy refused (or something injected, which it rightly refused): either
 * way, it is to be looked at, not left in the console. A test that needs a browser of its own (another person's, say)
 * takes it from `newContext`, which is watched the same way.
 */
export const test = base.extend<{
  contentSecurityPolicyGuard: string[];
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}>({
  contentSecurityPolicyGuard: [
    async ({ context }, use) => {
      const violations: string[] = [];
      watch(context, violations);
      await use(violations);
      expect(
        violations,
        'Content Security Policy violations on the pages this test opened',
      ).toEqual([]);
    },
    { auto: true },
  ],
  // Closed before the guard checks what they logged.
  newContext: async ({ browser, contentSecurityPolicyGuard: violations }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options) => {
      const context = await browser.newContext(options);
      watch(context, violations);
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
