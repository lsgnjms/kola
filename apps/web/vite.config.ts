import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Preact's React-compatible build: same components and hooks, ~120 KB less JavaScript
    // on the first download (mid-range phones on 3G). Types still come from @types/react.
    alias: [
      { find: "react-dom/client", replacement: "preact/compat/client" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react/jsx-dev-runtime", replacement: "preact/jsx-dev-runtime" },
      { find: /^react$/, replacement: "preact/compat" },
    ],
  },
  server: {
    // 127.0.0.1, not localhost: the API binds IPv4 loopback only, and localhost may resolve to ::1.
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", rewrite: (p) => p.replace(/^\/api/, "") },
      // The relay binds loopback only; phones read the public record through this path.
      "/relay": { target: "ws://127.0.0.1:7777", ws: true, rewrite: () => "/" },
    },
  },
  build: {
    // Budget: < 300 KB initial JS. Warn well before we get there.
    chunkSizeWarningLimit: 200,
  },
});
