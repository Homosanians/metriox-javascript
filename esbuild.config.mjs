/** @format */

import esbuild from "esbuild";
import { rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

// Start from an empty dist. Without this the directory only accumulates: declarations for sources
// that were since renamed or excluded stay behind and get published, which is how four *.test.d.ts
// files ended up inside the package. Skipped under --watch so a rebuild does not delete files out
// from under a running dev server.
if (!watch) rmSync("dist", { recursive: true, force: true });

const common = {
  bundle: true,
  sourcemap: true,
  target: ["es2019"],
};

await esbuild.build({
  ...common,
  entryPoints: ["src/index.ts"],
  format: "esm",
  outfile: "dist/index.esm.js",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/react/index.tsx"],
  format: "esm",
  outfile: "dist/react/index.esm.js",
  external: ["react"],
});

await esbuild.build({
  ...common,
  entryPoints: ["src/index.ts"],
  format: "iife",
  globalName: "MetrioxTG",
  minify: true,
  outfile: "dist/metriox-tg-webapp.min.js",
});

if (watch) {
  console.log("watch mode not implemented in this snippet; use esbuild context if desired");
}
