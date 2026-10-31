import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { milkdropDevRewrite, milkdropPrecompile } from "./scripts/vite-milkdrop";

export default defineConfig({
  plugins: [react(), milkdropPrecompile()],
  // relative asset paths so the production build works under file:// in Electron
  base: "./",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    esbuildOptions: { plugins: [milkdropDevRewrite] },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
});
