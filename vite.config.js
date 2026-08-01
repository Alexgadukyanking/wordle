import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  define: {
    __DEV_BUILD__: JSON.stringify(mode === "dev")
  },
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
}));
