import { useRouter } from 'next/navigation';

import type { LocaleOption } from '@/ui/LocalizedField';

import { announce } from '@/ui/announce';
import { constraintProblems, type Problems, refusalProblem } from '@/ui/checks';
import { formText, localizedFromForm } from '@/ui/forms';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteAnswer } from '@/write';

import type { ChangeFormText } from './ChangeForm';

/** The id of a change request form's alert. */
export const CHANGE_ERROR_ID = 'change-error';

/**
 * The column each constraint an approval can meet is about (R78): what the form marks, in the constraint's words. A
 * list of source kinds left empty is the admissible one's, the first.
 */
const CONSTRAINT_FIELDS: Readonly<Record<string, string>> = {
  slug_check: 'slug',
  slug_length: 'slug',
  parties_election_id_slug_key: 'slug',
  criteria_election_id_slug_key: 'slug',
  parties_colour_check: 'colour',
  parties_website_check: 'website',
  parties_territory_codes_check: 'territory_codes',
  methodologies_check1: 'admissible_source_kinds',
};

/** The request's own fields a schema refusal can name, as the form names them. */
const BODY_FIELDS = ['publicNote', 'reportId'] as const;

/**
 * Sends a proposal, and once it is in, says so on the change list it goes back to. What the form finds wrong before
 * sending, and a refusal that names a field (a constraint, the API's schema, the logo's upload as `logo`), shows at
 * that field, the first taking focus (admin forms §1.2); anything else in the form's alert.
 */
export const useProposal = (
  path: string,
  then: string,
  offered: readonly LocaleOption[],
  text: ChangeFormText,
) => {
  const router = useRouter();
  const write = useWrite();
  const { problems, show, form } = useProblems<string>();
  /** Shows what the form found before sending; whether there was anything, the alert then cleared. */
  const refuse = (found: Problems<string>): boolean => {
    if (!show(found)) {
      return false;
    }
    write.setError(undefined);
    return true;
  };
  const propose = async (
    target: HTMLFormElement,
    apply: boolean,
    body: Record<string, unknown> | (() => Promise<Record<string, unknown> | WriteAnswer>),
  ) => {
    show({});
    const answer = await write.run(
      async () => {
        const built = typeof body === 'function' ? await body() : body;
        if ('ok' in built && typeof built.ok === 'boolean') {
          return built as WriteAnswer;
        }
        return sendToApi('POST', path, {
          ...built,
          publicNote: localizedFromForm(target, 'publicNote', offered),
          apply,
          reportId: formText(target, 'reportId') || null,
        });
      },
      () => undefined,
    );
    if (answer && !answer.ok) {
      const pointed =
        answer.constraint === 'logo'
          ? { logo: text.errors[answer.error ?? 'unexpected'] }
          : refusalProblem<string>(
              answer,
              constraintProblems(CONSTRAINT_FIELDS, text.constraints, text.problems.invalid),
              Object.fromEntries(
                BODY_FIELDS.map((name) => [name, [name, text.problems.invalid] as const]),
              ),
            );
      if (pointed) {
        refuse(pointed);
      }
      return;
    }
    if (answer?.ok) {
      announce(apply ? text.applied : text.proposed, { afterNavigation: true });
      router.push(then);
    }
  };
  return { ...write, problems, form, refuse, propose };
};
