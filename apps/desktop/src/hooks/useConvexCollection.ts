import { anyApi } from "convex/server";
import { useQuery, useMutation } from "../lib/convexClient";

// Generic Convex-backed collection hook factory — produces list + create/update/
// remove for any entity whose Convex module exposes those public functions
// (transcriptions, dictionary, snippets, conversations; notes/folders have their
// own richer hooks). Uses `anyApi` (loose refs, no convex/ typecheck drag-in —
// see worklog gotcha). Reads/writes dev-user's data under mock auth; becomes
// per-user automatically once real auth activates (convexClient.setAuth).
//
// Unused op refs are harmless — Convex function references are lazy, so wiring
// `update` for an entity that lacks it never errors unless you actually call it.
export function makeCollectionHook(entity: string) {
  return function useCollection(listArgs: Record<string, unknown> = {}) {
    const mod = (anyApi as any)[entity];
    const items = useQuery(mod.list, listArgs) as any[] | undefined;
    const create = useMutation(mod.create);
    const update = useMutation(mod.update);
    const remove = useMutation(mod.remove);
    return {
      items,
      loading: items === undefined,
      create: (input: Record<string, unknown>) => create({ input }),
      update: (id: string, input: Record<string, unknown>) => update({ id, input }),
      remove: (id: string) => remove({ id }),
    };
  };
}

export const useConvexTranscriptions = makeCollectionHook("transcriptions");
export const useConvexDictionary = makeCollectionHook("dictionary");
export const useConvexSnippets = makeCollectionHook("snippets");
// conversations carry child messages → dedicated hook in ./useConvexConversations
