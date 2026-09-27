// Writes 3,000 notes into test-vault/Bulk to check the view stays fast.
// Not committed; run with `npm run bulk`.
import { mkdirSync, writeFileSync } from "node:fs";

const dir = "test-vault/Bulk";
mkdirSync(dir, { recursive: true });
const cats = Array.from({ length: 40 }, (_, i) => `topic ${i + 1}`);
for (let i = 0; i < 3000; i++) {
  const picked = [cats[i % 40], cats[(i * 7) % 40], cats[(i * 13) % 40]];
  writeFileSync(`${dir}/Note ${String(i + 1).padStart(4, "0")}.md`, `---\ntopics: [${picked.join(", ")}]\nsize: ${i % 97}\n---\n`);
}
writeFileSync("test-vault/Bulk.base", `filters:\n  and:\n    - file.inFolder("Bulk")\nviews:\n  - type: split-groups\n    name: 3000 notes split by topic\n    splitBy: note.topics\n    order:\n      - file.name\n      - note.topics\n      - note.size\n`);
console.log("wrote 3000 notes to", dir);
