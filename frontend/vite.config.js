import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy REST API calls to backend
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Proxy WebSocket
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
