import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A plain single-page app, deliberately unrelated to the shop's TanStack Start
// build: it deploys to its own address and shares nothing but the API.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  // Tailwind runs as a Vite plugin; an inline empty PostCSS config stops Vite
  // from walking up the disk and picking up some other project's config.
  css: { postcss: { plugins: [] } },
  server: { port: 8090, strictPort: true },
  preview: { port: 8090, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
});
