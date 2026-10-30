import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // 127.0.0.1, not localhost: the API binds IPv4 loopback only, and localhost may resolve to ::1.
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", rewrite: (p) => p.replace(/^\/api/, "") },
      // The relay binds loopback only; phones read the public record through this path.
      "/relay": { target: "ws://127.0.0.1:7777", ws: true, rewrite: () => "/" },
    },
  },
  build: {
    // Budget from plan.md: < 300 KB initial JS. Warn well before we get there.
    chunkSizeWarningLimit: 200,
  },
});
