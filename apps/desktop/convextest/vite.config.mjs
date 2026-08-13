import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone harness (see ./main.tsx) verifying the Convex data client in a
// browser. Fixed port 5174 (authtest uses 5173).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
