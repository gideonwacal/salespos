import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ command, mode }) => {
  // Inline VITE_* vars as import.meta.env.* so they survive the SSR build too.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define,

    server: {
      // The app has always served on 8080; the Django CORS allowlist expects it.
      port: 8080,
      strictPort: true,
      host: "::",
    },

    css: { transformer: "lightningcss" },

    resolve: {
      alias: { "@": srcDir },
      // React and Query must resolve to one copy each, or hooks break at runtime.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },

    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },

    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Keep server-only modules out of the client bundle.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // Build the SSR entry from src/server.ts (our error wrapper).
        server: { entry: "server" },
      }),
      // Nitro only participates in builds; it has nothing to do during `vite dev`.
      // The preset decides the deploy target. Vercel and Netlify set their own
      // CI env vars, which Nitro detects on its own, so NITRO_PRESET is only
      // needed to force a target locally (e.g. NITRO_PRESET=node for a plain
      // server build).
      ...(command === "build"
        ? [nitro({ preset: process.env.NITRO_PRESET || undefined })]
        : []),
      viteReact(),
    ],
  };
});
