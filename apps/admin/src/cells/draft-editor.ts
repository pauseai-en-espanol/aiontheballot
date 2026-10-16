import { createContext, useContext } from 'react';

/** A save of the draft's form: the version it saved the cell at, or none when it was refused. */
export type DraftSave = () => Promise<number | undefined>;

/** What the cell page's parts share about its draft's form (admin forms §2, PLAN R190). */
export interface DraftEditorState {
  /** Whether the form holds edits not saved yet. */
  unsaved: boolean;
  setUnsaved: (unsaved: boolean) => void;
  /** The form registers its save here, and takes it back (null) when it goes. */
  registerSave: (save: DraftSave | null) => void;
  /** Saves the form, if it is on the page: none when it isn't, or the save was refused. */
  save: DraftSave;
}

export const DraftEditorContext = createContext<DraftEditorState | null>(null);

/** The draft's shared state, when the page has an editable draft. */
export const useDraftEditor = (): DraftEditorState | null => useContext(DraftEditorContext);
