import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const developmentBuild = mode === "dev";
  return {
    define: {
      __DEV_BUILD__: JSON.stringify(developmentBuild)
    },
    publicDir: "public",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          game: path.resolve("index.html"),
          stats: path.resolve("stats.html"),
          ...(developmentBuild
            ? { accounts: path.resolve("dev/accounts.html") }
            : {})
        },
        output: developmentBuild
          ? {
              entryFileNames: "assets/[name].js",
              chunkFileNames: "assets/[name].js",
              assetFileNames: "assets/[name][extname]"
            }
          : undefined
      }
    }
  };
});
