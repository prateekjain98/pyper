import { useState } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { convexAuthClient } from "../lib/convexAuth";

// Self-contained Convex Better Auth sign-in, reachable at ?convex-auth=true.
// It brings its own provider so it can't affect the main app's startup. Verified
// email/password working; Google needs a Google-logged-in browser to complete.
const convex = new ConvexReactClient(
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ||
    "https://chatty-penguin-848.eu-west-1.convex.cloud"
);

function Inner() {
  const { data: session, isPending } = convexAuthClient.useSession();
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
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 620, color: "#eee" }}>
      <h2>Pyper — Convex sign-in</h2>
      <p>
        Session:{" "}
        {isPending ? "…" : session?.user ? `✅ signed in as ${session.user.email}` : "not signed in"}
      </p>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email"
        style={{ width: "100%", padding: 8 }}
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password"
        type="password"
        style={{ width: "100%", padding: 8, marginTop: 8 }}
      />
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run("signUp.email", () => convexAuthClient.signUp.email({ email, password, name: "User" }))}>
          Sign up (email)
        </button>
        <button onClick={() => run("signIn.email", () => convexAuthClient.signIn.email({ email, password }))}>
          Sign in (email)
        </button>
        <button
          onClick={() =>
            run("signIn.social(google)", () =>
              convexAuthClient.signIn.social({ provider: "google", callbackURL: location.href })
            )
          }
        >
          Sign in with Google
        </button>
        <button onClick={() => run("signOut", () => convexAuthClient.signOut())}>Sign out</button>
      </div>
      <pre
        style={{
          marginTop: 16,
          background: "#0b0d12",
          color: "#7CFC7C",
          padding: 12,
          whiteSpace: "pre-wrap",
          borderRadius: 8,
        }}
      >
        {log}
      </pre>
    </div>
  );
}

export default function ConvexAuthTest() {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={convexAuthClient as never}>
      <Inner />
    </ConvexBetterAuthProvider>
  );
}
