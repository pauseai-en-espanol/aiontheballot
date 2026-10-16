import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { WriteAnswer, WriteError } from '@/write';

/**
 * A form's write: busy while it is out (forms mark their button `aria-disabled`, never `disabled`, so focus stays,
 * and a second click sends nothing), the refusal to show in its alert, or the line to announce in its status once
 * done, which then takes focus, since what was pressed may be gone once the page reloads its data from the API.
 */
export const useWrite = () => {
  const router = useRouter();
  const busy = useRef(false);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WriteError>();
  const [status, setStatus] = useState('');
  const run = async (
    send: () => Promise<WriteAnswer>,
    done: string | ((answer: WriteAnswer) => string | undefined),
    { focus = true }: { focus?: boolean } = {},
  ): Promise<WriteAnswer | undefined> => {
    if (busy.current) {
      return undefined;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    setStatus('');
    const answer = await send();
    busy.current = false;
    setPending(false);
    if (!answer.ok) {
      setError(answer.error ?? 'unexpected');
      return answer;
    }
    const line = typeof done === 'string' ? done : done(answer);
    if (line !== undefined) {
      setStatus(line);
      if (focus) {
        statusLine.current?.focus();
      }
    }
    router.refresh();
    return answer;
  };
  return { pending, error, status, statusLine, run, setError };
};
