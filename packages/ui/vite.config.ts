import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5273,
    strictPort: false,
  },
  preview: {
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // 把不常变动的第三方库拆分为独立 chunk，提升浏览器缓存命中率
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-net": ["socket.io-client"],
          "vendor-icons": ["lucide-react"],
        },
      },
    },
  },
});
