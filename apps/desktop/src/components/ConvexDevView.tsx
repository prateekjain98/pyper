import { useState } from "react";
import { convexClient, ConvexProvider } from "../lib/convexClient";
import { useConvexNotes } from "../hooks/useConvexNotes";
import { useConvexFolders } from "../hooks/useConvexFolders";
import {
  useConvexTranscriptions,
  useConvexDictionary,
  useConvexSnippets,
} from "../hooks/useConvexCollection";
import { useConvexConversations } from "../hooks/useConvexConversations";

// Isolated Convex-backed view, mounted by main.jsx only when the URL carries
// `?convexdev`. It bypasses AppRouter and all Electron/IPC dependencies, so it
// renders (and reads/writes live Convex data under mock auth) in a plain browser
// via the `desktop-renderer` preview — the first real-renderer proof of the
// client wiring, ahead of the full port.
//
// It consumes the adoptable src/hooks/useConvex*.ts hooks (the ones real
// components will swap their SQLite/IPC hooks for). Those hooks use `anyApi`
// (loose refs) to keep the renderer typecheck free of the convex/ drag-in — do
// NOT import convex/_generated/api in renderer src (TS2589/TS2345; see worklog).
function Inner() {
  const { notes, createNote } = useConvexNotes(20);
  const { folders, createFolder } = useConvexFolders();
  const { items: transcriptions } = useConvexTranscriptions({ limit: 20 });
  const { items: dictionary } = useConvexDictionary();
  const { items: snippets } = useConvexSnippets();
  const { conversations, createConversation } = useConvexConversations(20);
  const [status, setStatus] = useState("");
  const count = (x: unknown) => (x === undefined ? "…loading" : String((x as unknown[]).length));
  const run = async (label: string, fn: () => Promise<any>) => {
    setStatus(`${label}…`);
    try {
      const r = await fn();
      setStatus(`${label} → ${r?.id ?? "ok"}`);
    } catch (e) {
      setStatus(`${label} error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
      <h2>Convex dev view — real renderer, mock auth (dev-user)</h2>
      <p id="convex-notes-count">Notes: {count(notes)}</p>
      <p id="convex-folders-count">Folders: {count(folders)}</p>
      <p id="convex-tx-count">Transcriptions: {count(transcriptions)}</p>
      <p id="convex-dict-count">Dictionary: {count(dictionary)}</p>
      <p id="convex-snip-count">Snippets: {count(snippets)}</p>
      <p id="convex-conv-count">Conversations: {count(conversations)}</p>
      <button
        id="convex-create"
        onClick={() =>
          run("create note", () =>
            createNote({
              client_note_id: `convexdev-${Date.now()}`,
              title: "Renderer note",
              content: "created via useConvexNotes",
            })
          )
        }
      >
        Create note
      </button>{" "}
      <button
        id="convex-create-folder"
        onClick={() =>
          run("create folder", () =>
            createFolder({ client_folder_id: `convexdev-${Date.now()}`, name: "Renderer folder" })
          )
        }
      >
        Create folder
      </button>{" "}
      <button
        id="convex-create-conv"
        onClick={() =>
          run("create conversation", () =>
            createConversation({
              client_conversation_id: `convexdev-${Date.now()}`,
              title: "Renderer chat",
              messages: [{ role: "user", content: "hi from the renderer" }],
            })
          )
        }
      >
        Create conversation
      </button>
      <p id="convex-create-status">{status}</p>
      <ul>
        {((notes as any[] | undefined) ?? []).slice(0, 8).map((note: any) => (
          <li key={note.id}>{note.title ?? "(untitled)"}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ConvexDevView() {
  return (
    <ConvexProvider client={convexClient}>
      <Inner />
    </ConvexProvider>
  );
}
