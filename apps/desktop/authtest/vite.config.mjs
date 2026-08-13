import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone harness (see ./main.tsx). Fixed port 5173 so it matches the
// server's crossDomain CLIENT_ORIGIN trusted origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
