import { createRoot } from "react-dom/client";
import { ConvexReactClient, ConvexProvider, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

// Standalone harness to verify the Convex *data* client wiring (reactive reads)
// in a browser before porting it into the Electron renderer — the read
// counterpart to ../authtest. Auth is MOCKED server-side (requireSubject falls
// back to DEV_SUBJECT), so no token is needed to read dev-user's data.
const CONVEX_URL = "https://chatty-penguin-848.eu-west-1.convex.cloud";
const convex = new ConvexReactClient(CONVEX_URL);

function App() {
  const notes = useQuery(api.notes.list, { limit: 20 });
  const folders = useQuery(api.folders.list, {});
  const val = (x: unknown[] | undefined) => (x === undefined ? "…loading" : String(x.length));
  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
      <h2>Convex data — read harness (mock auth = dev-user)</h2>
      <p id="notes-count">Notes: {val(notes)}</p>
      <p id="folders-count">Folders: {val(folders)}</p>
      <ul>
        {(notes ?? []).slice(0, 5).map((n: any) => (
          <li key={n.id}>
            <b>{n.title ?? "(untitled)"}</b> — {String(n.content ?? "").slice(0, 48)}
          </li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={convex}>
    <App />
  </ConvexProvider>
);
