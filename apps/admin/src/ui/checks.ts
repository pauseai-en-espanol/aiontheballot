import type { WriteAnswer } from '../write';

/** Each field's problem after a submit (admin forms §1.2), by the form's own name for the field. */
export type Problems<F extends string> = Partial<Record<F, string>>;

/** What a field's value must be, checked in the browser before anything is sent; the API checks it all again. */
export interface FieldRule {
  /** It can't be left empty (a checkbox: ticked). */
  required?: boolean;
  /** What a value must look like, when there is one. */
  shape?: 'email' | 'url' | 'https' | 'slug';
  /** A whole number within these bounds, when there is one. */
  whole?: { min: number; max: number };
}

/** The shared messages (admin.form.problems), in the page's language. */
export interface ProblemText {
  required: string;
  /** A localized field with no text in any language. */
  localized: string;
  confirm: string;
  /** A choice nobody made. */
  choose: string;
  email: string;
  /** An http or https address. */
  url: string;
  /** An https address only. */
  https: string;
  slug: string;
  /** With `{min}` and `{max}`. */
  whole: string;
  /** A value the API refused, with nothing more specific to say. */
  invalid: string;
}

const SHAPES = {
  // As the database checks them: one @ with something either side and no space; an http(s) address; a slug.
  email: /^[^\s@]+@[^\s@]+$/u,
  url: /^https?:\/\/\S+$/u,
  https: /^https:\/\/\S+$/u,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
} as const;

/** A value of the form as checked: a checkbox's state, else its text, trimmed. */
export type FormValue = string | boolean;

/**
 * The problems of `values` by `rules`, in the rules' order (the form's), each in words: the first problem of each
 * field. A slug is at most 63 characters, as the database's slugs.
 */
export const checkValues = <F extends string>(
  values: Readonly<Record<F, FormValue>>,
  rules: Readonly<Record<F, FieldRule>>,
  text: ProblemText,
): Problems<F> => {
  const found: Problems<F> = {};
  for (const field of Object.keys(rules) as F[]) {
    const rule = rules[field];
    const value = values[field];
    if (typeof value === 'boolean') {
      if (rule.required && !value) {
        found[field] = text.confirm;
      }
      continue;
    }
    if (value === '') {
      if (rule.required) {
        found[field] = text.required;
      }
      continue;
    }
    if (
      rule.shape &&
      (!SHAPES[rule.shape].test(value) || (rule.shape === 'slug' && value.length > 63))
    ) {
      found[field] = text[rule.shape];
    } else if (
      rule.whole &&
      (!/^-?\d+$/u.test(value) || Number(value) < rule.whole.min || Number(value) > rule.whole.max)
    ) {
      found[field] = text.whole
        .replace('{min}', String(rule.whole.min))
        .replace('{max}', String(rule.whole.max));
    }
  }
  return found;
};

/**
 * The field a refusal points at and what to say there: a value the API's schema refused (`field`, as the request's
 * body names it), else a constraint the form knows; none when the refusal names neither.
 */
export const refusalProblem = <F extends string>(
  answer: WriteAnswer,
  constraints: Readonly<Record<string, readonly [F, string]>>,
  fields: Readonly<Record<string, readonly [F, string]>> = {},
): Problems<F> | undefined => {
  const pointed =
    (answer.field === undefined ? undefined : fields[answer.field]) ??
    (answer.constraint === undefined ? undefined : constraints[answer.constraint]);
  return pointed ? ({ [pointed[0]]: pointed[1] } as Problems<F>) : undefined;
};

/**
 * The constraints a form can point at, each as its field and the page's message for it (else `fallback`): what
 * `refusalProblem` takes, from a static map of constraint to field and the page's messages by constraint.
 */
export const constraintProblems = <F extends string>(
  fieldOf: Readonly<Record<string, F>>,
  messages: Readonly<Record<string, string>>,
  fallback: string,
): Record<string, readonly [F, string]> =>
  Object.fromEntries(
    Object.entries(fieldOf).map(([constraint, field]) => [
      constraint,
      [field, messages[constraint] ?? fallback] as const,
    ]),
  );
