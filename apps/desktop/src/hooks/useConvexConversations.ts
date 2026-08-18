import { anyApi } from "convex/server";
import { useQuery, useMutation } from "../lib/convexClient";

// Convex-backed conversations hook (agent chat threads). Unlike the generic
// collection factory, conversations carry child messages, so this exposes
// addMessage too. `anyApi` refs (no convex/ typecheck drag-in); per-user scoped
// via the shared client's setAuth (see ../lib/convexClient).
export function useConvexConversations(limit = 50) {
  const conversations = useQuery(anyApi.conversations.list, { limit }) as any[] | undefined;
  const create = useMutation(anyApi.conversations.create);
  const update = useMutation(anyApi.conversations.update);
  const remove = useMutation(anyApi.conversations.remove);
  const add = useMutation(anyApi.conversations.addMessage);
  return {
    conversations,
    loading: conversations === undefined,
    createConversation: (input: Record<string, unknown>) => create({ input }),
    updateConversation: (id: string, input: Record<string, unknown>) => update({ id, input }),
    removeConversation: (id: string) => remove({ id }),
    addMessage: (conversation_id: string, message: Record<string, unknown>) =>
      add({ conversation_id, message }),
  };
}

// Messages for one conversation (query keyed by id) — pass null to skip.
export function useConvexConversationMessages(conversationId: string | null) {
  return useQuery(
    anyApi.conversations.listMessages,
    conversationId ? { conversation_id: conversationId } : "skip"
  ) as any[] | undefined;
}
