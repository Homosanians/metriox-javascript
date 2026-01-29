/** @format */

import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

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
  entryPoints: ["src/index.ts"],
  format: "iife",
  globalName: "MetrioxTG",
  minify: true,
  outfile: "dist/metriox-tg-webapp.min.js",
});

if (watch) {
  console.log("watch mode not implemented in this snippet; use esbuild context if desired");
}
