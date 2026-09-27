import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const prod = process.argv[2] === "production";
// Built files also land in the test vault so a reload in Obsidian picks them up.
const vaultPlugin = "test-vault/.obsidian/plugins/split-groups";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  sourcemap: prod ? false : "inline",
  minify: prod,
  outfile: "main.js",
});
mkdirSync(vaultPlugin, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, `${vaultPlugin}/${f}`);
console.log("built, copied to", vaultPlugin);
