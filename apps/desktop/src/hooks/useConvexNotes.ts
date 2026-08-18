import { anyApi } from "convex/server";
import { useQuery, useMutation } from "../lib/convexClient";

// Convex-backed notes data hook — the adoptable replacement for the app's
// SQLite/IPC notes reads/writes. Real components can swap their IPC-based notes
// hook for this one.
//
// Typed via `anyApi` (loose refs) to keep the renderer typecheck free of the
// convex/ drag-in (see worklog gotcha). The shared client authenticates per-user
// (convexClient.setAuth mints the signed-in user's Convex JWT — see
// ../lib/convexClient), so reads/writes are scoped to the real user's subject.
export interface ConvexNote {
  id: string;
  client_note_id: string;
  title: string | null;
  content: string;
  folder_id: string | null;
  space_id: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

export function useConvexNotes(limit = 50) {
  const notes = useQuery(anyApi.notes.list, { limit }) as ConvexNote[] | undefined;
  const create = useMutation(anyApi.notes.create);
  const update = useMutation(anyApi.notes.update);
  const remove = useMutation(anyApi.notes.remove);
  return {
    notes,
    loading: notes === undefined,
    createNote: (input: Partial<ConvexNote>) =>
      create({ input }) as Promise<ConvexNote>,
    updateNote: (id: string, input: Partial<ConvexNote>) => update({ id, input }),
    removeNote: (id: string) => remove({ id }),
  };
}
