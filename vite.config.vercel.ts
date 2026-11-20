import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(projectRoot, "src/client");

/**
 * Standalone Vercel build configuration.
 * This deliberately does not load @devvit/start/vite; Devvit remains the
 * production Reddit runtime.
 */
export default defineConfig({
  root: clientRoot,
  define: {
    "import.meta.env.VITE_STANDALONE_MODE": JSON.stringify("true"),
  },
  resolve: {
    alias: {
      "@devvit/web/client": path.resolve(projectRoot, "src/client/platform/vercel-devvit-client.ts"),
      "@devvit/analytics/client/reddit": path.resolve(projectRoot, "src/client/platform/noop-telemetry.ts"),
    },
  },
  build: {
    outDir: path.resolve(projectRoot, "dist-vercel"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(clientRoot, "splash.html"),
        game: path.resolve(clientRoot, "game.html"),
      },
    },
  },
});
