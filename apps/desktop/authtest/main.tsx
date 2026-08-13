import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

// Standalone harness to verify the Convex Better Auth client wiring (email/pw +
// Google) in a browser before porting it into the Electron renderer.
const SITE_URL = "https://chatty-penguin-848.eu-west-1.convex.site";
const CONVEX_URL = "https://chatty-penguin-848.eu-west-1.convex.cloud";

const authClient = createAuthClient({
  baseURL: SITE_URL,
  plugins: [convexClient(), crossDomainClient()],
});
const convex = new ConvexReactClient(CONVEX_URL);

function App() {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState(`test${Date.now()}@example.com`);
  const [password, setPassword] = useState("password1234");
  const [log, setLog] = useState("");
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setLog(`${label}…`);
    try {
      setLog(`${label} →\n${JSON.stringify(await fn(), null, 2)}`);
    } catch (e) {
      setLog(`${label} ✗\n${e instanceof Error ? e.stack : String(e)}`);
    }
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 620 }}>
      <h2>Convex Better Auth — test harness</h2>
      <p>
        Session:{" "}
        {isPending ? "…" : session?.user ? `✅ signed in as ${session.user.email}` : "not signed in"}
      </p>
      <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: 6 }} />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 6, marginTop: 8 }}
      />
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run("signUp.email", () => authClient.signUp.email({ email, password, name: "Test User" }))}>
          Sign up (email)
        </button>
        <button onClick={() => run("signIn.email", () => authClient.signIn.email({ email, password }))}>
          Sign in (email)
        </button>
        <button onClick={() => run("signIn.social(google)", () => authClient.signIn.social({ provider: "google", callbackURL: location.href }))}>
          Sign in (Google)
        </button>
        <button onClick={() => run("signOut", () => authClient.signOut())}>Sign out</button>
      </div>
      <pre style={{ marginTop: 16, background: "#0b0d12", color: "#7CFC7C", padding: 12, whiteSpace: "pre-wrap", borderRadius: 8 }}>
        {log}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ConvexBetterAuthProvider client={convex} authClient={authClient}>
    <App />
  </ConvexBetterAuthProvider>
);
