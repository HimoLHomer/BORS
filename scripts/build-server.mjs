import { build } from "esbuild";

await build({
  entryPoints: ["server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/server.cjs",
  sourcemap: true,
  external: ["better-sqlite3"],
  define: { "process.env.NODE_ENV": '"production"' },
});
