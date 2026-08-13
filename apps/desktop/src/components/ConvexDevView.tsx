import { anyApi } from "convex/server";
import { convexClient, ConvexProvider, useQuery } from "../lib/convexClient";

// Isolated Convex-backed view, mounted by main.jsx only when the URL carries
// `?convexdev`. It bypasses AppRouter and all Electron/IPC dependencies, so it
// renders (and reads live Convex data under mock auth) in a plain browser via
// the `desktop-renderer` preview — the first real-renderer proof of the client
// wiring, ahead of the full port.
//
// IMPORTANT: uses `anyApi` (loose function refs), NOT `convex/_generated/api`.
// Importing the typed api into renderer `src/` drags the whole `convex/` dir
// into `npm run typecheck` (which only Convex's own toolchain should typecheck)
// and it fails (TS2589 deep-instantiation + a TS2345 in conversations.ts). The
// full port will need a proper typed boundary; `anyApi` keeps this dev view
// type-safe-enough and the renderer typecheck green.
function Inner() {
  const notes = useQuery(anyApi.notes.list, { limit: 20 });
  const folders = useQuery(anyApi.folders.list, {});
  const count = (x: unknown) => (x === undefined ? "…loading" : String((x as unknown[]).length));
  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
      <h2>Convex dev view — real renderer, mock auth (dev-user)</h2>
      <p id="convex-notes-count">Notes: {count(notes)}</p>
      <p id="convex-folders-count">Folders: {count(folders)}</p>
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
