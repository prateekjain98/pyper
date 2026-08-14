import { anyApi } from "convex/server";
import { useQuery, useMutation } from "../lib/convexClient";

// Convex-backed folders data hook — adoptable replacement for the app's
// SQLite/IPC folders reads/writes. Same pattern as useConvexNotes: `anyApi`
// refs (no convex/ typecheck drag-in), per-user automatically once auth
// activates (convexClient.setAuth).
export interface ConvexFolder {
  id: string;
  client_folder_id: string;
  name: string;
  is_default: boolean;
  sort_order: number;
  space_id: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

export function useConvexFolders() {
  const folders = useQuery(anyApi.folders.list, {}) as ConvexFolder[] | undefined;
  const create = useMutation(anyApi.folders.create);
  const update = useMutation(anyApi.folders.update);
  const remove = useMutation(anyApi.folders.remove);
  return {
    folders,
    loading: folders === undefined,
    createFolder: (input: Partial<ConvexFolder>) => create({ input }) as Promise<ConvexFolder>,
    updateFolder: (id: string, input: Partial<ConvexFolder>) => update({ id, input }),
    removeFolder: (id: string) => remove({ id }),
  };
}
