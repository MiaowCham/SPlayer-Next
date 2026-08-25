import { defineConfig, mergeConfig } from "vite";
import electronViteConfig from "./electron.vite.config";

/** 仅启动渲染端，供浏览器持续预览，不会随着 Electron 窗口关闭而退出。 */
export default defineConfig(
  mergeConfig(electronViteConfig.renderer ?? {}, {
    server: {
      host: "127.0.0.1",
      port: 14558,
      strictPort: true,
    },
  }),
);
