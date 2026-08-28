import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 部署驗證用：把 commit 印進 HTML，外部一行 curl 就能確認前端跑的是哪版。
// 沒有它只能 grep bundle 裡的中文字串猜——壓縮會改名、code-split 會換 chunk，很容易誤判。
// Render static site 會注入 RENDER_GIT_COMMIT（在 Node 端讀，不需要 VITE_ 前綴、不必改 build command）。
const COMMIT = (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "dev").slice(0, 7);

const commitMeta = {
  name: "inject-commit-meta",
  transformIndexHtml(html: string) {
    return html.replace("</head>", `  <meta name="app-commit" content="${COMMIT}" />\n  </head>`);
  },
};

// dev：前端 5173，/api/* 代理到後端 3000（避開 CORS）。
export default defineConfig({
  plugins: [react(), commitMeta],
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
        // 本機常同時跑別的專案（weyver 也吃 3000）——換 port 不用改檔
        target: process.env.API_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
