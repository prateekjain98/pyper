import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

// Client for the Convex-hosted Better Auth (verified working — see authtest/).
// crossDomainClient keeps the session token in localStorage because the renderer
// is a cross-origin context (file:// in prod, http://localhost:5183 in dev) where
// convex.site cookies don't stick.
const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL as string;

export const convexAuthClient = createAuthClient({
  baseURL: SITE_URL,
  plugins: [convexClient(), crossDomainClient()],
});
