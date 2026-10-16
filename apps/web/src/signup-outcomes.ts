/** What the form's target answers with, in the home's query (`?aviso=…`), so the page can say how it went. */
export const SIGNUP_OUTCOMES = ['accepted', 'invalid', 'limit', 'failed', 'unavailable'] as const;
export type SignupOutcome = (typeof SIGNUP_OUTCOMES)[number];

export const isSignupOutcome = (value: unknown): value is SignupOutcome =>
  (SIGNUP_OUTCOMES as readonly unknown[]).includes(value);

/** The id the form's section takes, and the anchor its answer returns to. */
export const SIGNUP_ANCHOR = 'avisos';
