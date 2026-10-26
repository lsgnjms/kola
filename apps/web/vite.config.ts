import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: "http://localhost:3000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  build: {
    // Budget from plan.md: < 300 KB initial JS. Warn well before we get there.
    chunkSizeWarningLimit: 200,
  },
});
