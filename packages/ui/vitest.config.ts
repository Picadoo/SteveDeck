import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// UI 单元测试：只测 src/lib 下的纯逻辑（数值/文本解析、编辑距离等），不渲染组件，
// 故用 node 环境、不挂 react 插件。复用与 vite.config 相同的 @ → src 别名。
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
