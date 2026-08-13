import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

// Registers the Better Auth component so it runs INSIDE this Convex deployment
// (decision 2026-08-13 — zero self-hosting). Running `npx convex dev` picks this
// up and regenerates `convex/_generated/` with `components.betterAuth`.
const app = defineApp();
app.use(betterAuth);

export default app;
