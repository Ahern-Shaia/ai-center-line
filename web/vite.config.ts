import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev：前端 5173，/api/* 代理到後端 3000（避開 CORS）。
export default defineConfig({
  plugins: [react()],
  build: {
    // 多入口：戰情室 SPA(index.html) + LIFF「我的日報」(liff.html)
    rollupOptions: {
      // key 命名保持 "index"：輸出 bundle 仍為 assets/index-*.js，
      // UpdateBanner 版本偵測靠此前綴，勿改成別的 key。
      input: {
        index: "index.html",
        liff: "liff.html",
      },
    },
  },
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
