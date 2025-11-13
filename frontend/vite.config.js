
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/run": "http://localhost:5000",
      "/environments": {
        target: "http://localhost:5000",
        changeOrigin: true
      },
      "/environment": {
        target: "http://localhost:5000",
        changeOrigin: true
      },
      "/apis": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/apis/, "/apis")
      },
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true
      },
      "/collection": {
        target: "http://localhost:5000",
        changeOrigin: true
      },
      "/save": {
        target: "http://localhost:5000",
        changeOrigin: true
      }
    }
  }
});
