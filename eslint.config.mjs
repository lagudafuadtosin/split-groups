// Obsidian's own review rules, the same ones it runs on every release.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules/", ".test-build/", "test-vault/", "old/", "scripts/", "esbuild.config.mjs", "eslint.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.*"] },
      },
    },
  },
]);
