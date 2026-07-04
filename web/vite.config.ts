import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev：前端 5173，/api/* 代理到後端 3000（避開 CORS）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
