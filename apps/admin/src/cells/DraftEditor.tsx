'use client';

import { type ReactNode, useMemo, useRef, useState } from 'react';

import { useLeaveGuard } from '@/ui/useLeaveGuard';

import type { Rating } from './data';

import { DraftEditorContext, type DraftSave } from './draft-editor';

/**
 * The part of the cell page that edits its draft (admin forms §2, PLAN R190): its form, the bar that saves and submits
 * it, and the checklist share whether something is unsaved, and leaving the page with unsaved edits asks first
 * (`leave`). They also share the rating the form shows (`rating`, the saved one until another is chosen), so the
 * evidence it needs follows it (PLAN R230).
 */
export const DraftEditor = ({
  leave,
  rating: saved,
  children,
}: {
  leave: string;
  rating: Rating | null;
  children: ReactNode;
}) => {
  const [unsaved, setUnsaved] = useState(false);
  const [rating, setRating] = useState(saved);
  // A newer saved rating (this page's save, or someone else's once reloaded) is the one shown again.
  const [loaded, setLoaded] = useState(saved);
  if (saved !== loaded) {
    setLoaded(saved);
    setRating(saved);
  }
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
      rating,
      setRating,
    }),
    [unsaved, rating],
  );
  return <DraftEditorContext value={value}>{children}</DraftEditorContext>;
};
