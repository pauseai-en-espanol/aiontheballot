'use client';

import { type ReactNode, useMemo, useRef, useState } from 'react';

import { useLeaveGuard } from '@/ui/useLeaveGuard';

import { DraftEditorContext, type DraftSave } from './draft-editor';

/**
 * The part of the cell page that edits its draft (admin forms §2, PLAN R190): its form, the bar that saves and submits
 * it, and the checklist share whether something is unsaved, and leaving the page with unsaved edits asks first
 * (`leave`).
 */
export const DraftEditor = ({ leave, children }: { leave: string; children: ReactNode }) => {
  const [unsaved, setUnsaved] = useState(false);
  const registered = useRef<DraftSave | null>(null);
  useLeaveGuard(unsaved, leave);
  const value = useMemo(
    () => ({
      unsaved,
      setUnsaved,
      registerSave: (save: DraftSave | null) => {
        registered.current = save;
      },
      save: () => registered.current?.() ?? Promise.resolve(undefined),
    }),
    [unsaved],
  );
  return <DraftEditorContext value={value}>{children}</DraftEditorContext>;
};
