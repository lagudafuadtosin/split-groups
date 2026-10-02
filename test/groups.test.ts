import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanValue, splitIntoGroups, NO_VALUE_LABEL, tableColumns, savedWidths } from "../src/groups";

type Note = { name: string; values: string[] };
const run = (notes: Note[], showNoValue = true, reverse = false) =>
  splitIntoGroups(notes, (n) => n.values, showNoValue, reverse).map((g) => `${g.label}: ${g.entries.map((n) => n.name).join(" ")}`);

test("a note lands in every group its list names", () => {
  assert.deepEqual(run([{ name: "jollof", values: ["main", "side"] }, { name: "moi", values: ["side"] }]), ["main: jollof", "side: jollof moi"]);
});

test("case differences are one group, first spelling wins", () => {
  assert.deepEqual(run([{ name: "a", values: ["Main"] }, { name: "b", values: ["main"] }]), ["Main: a b"]);
});

test("the same value twice in one note counts once", () => {
  assert.deepEqual(run([{ name: "a", values: ["main", "Main", " main "] }]), ["main: a"]);
});

test("links group by the note they point to, alias or not", () => {
  assert.equal(cleanValue("[[Main]]"), "Main");
  assert.equal(cleanValue("[[Recipes/Main.md]]"), "Main");
  assert.equal(cleanValue("[[Main|Main dish]]"), "Main");
  assert.equal(cleanValue("[[Main#Heading]]"), "Main");
  assert.equal(cleanValue("![[Main]]"), "Main");
});

test("a link and plain text with the same name share a group", () => {
  assert.deepEqual(run([{ name: "a", values: ["[[Main]]"] }, { name: "b", values: ["main"] }]), ["Main: a b"]);
});

test("tags drop the leading #, text with spaces keeps it", () => {
  assert.equal(cleanValue("#main"), "main");
  assert.equal(cleanValue("# not a tag"), "# not a tag");
});

test("empty values, blanks and null go to (no value)", () => {
  assert.deepEqual(run([{ name: "a", values: [] }, { name: "b", values: ["", "  ", "null"] }]), [`${NO_VALUE_LABEL}: a b`]);
});

test("(no value) can be hidden", () => {
  assert.deepEqual(run([{ name: "a", values: [] }, { name: "b", values: ["x"] }], false), ["x: b"]);
});

test("numbers sort naturally and (no value) is last", () => {
  assert.deepEqual(run([{ name: "a", values: ["10"] }, { name: "b", values: ["2"] }, { name: "c", values: [] }]), ["2: b", "10: a", `${NO_VALUE_LABEL}: c`]);
});

test("notes keep the order they arrive in", () => {
  assert.deepEqual(run([{ name: "z", values: ["g"] }, { name: "a", values: ["g"] }]), ["g: z a"]);
});

test("a group literally named no value does not merge with notes that have none", () => {
  assert.deepEqual(run([{ name: "a", values: ["(no value)"] }, { name: "b", values: [] }]), ["(no value): a", `${NO_VALUE_LABEL}: b`]);
});

test("reverse flips group order, numbers included", () => {
  assert.deepEqual(run([{ name: "a", values: ["10"] }, { name: "b", values: ["2"] }], true, true), ["10: a", "2: b"]);
});

test("(no value) stays last even when reversed", () => {
  assert.deepEqual(run([{ name: "a", values: ["x"] }, { name: "b", values: [] }], true, true), ["x: a", `${NO_VALUE_LABEL}: b`]);
});

test("3,000 notes with up to 3 values each group quickly", () => {
  const notes: Note[] = Array.from({ length: 3000 }, (_, i) => ({ name: `n${i}`, values: [`c${i % 40}`, `c${(i * 7) % 40}`, `c${(i * 13) % 40}`] }));
  const t0 = performance.now();
  const groups = splitIntoGroups(notes, (n) => n.values, true);
  const ms = performance.now() - t0;
  assert.equal(groups.length, 40);
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
});

test("the note name column follows the Properties order", () => {
  assert.deepEqual(tableColumns(["note.category", "file.name", "note.time"]), ["note.category", "file.name", "note.time"]);
});

test("the note name column goes first when it is not listed", () => {
  assert.deepEqual(tableColumns(["note.category", "note.time"]), ["file.name", "note.category", "note.time"]);
});

test("saved widths keep only positive numbers", () => {
  assert.deepEqual(savedWidths({ "file.name": 220.4, "note.time": 0, "note.category": "wide", "note.x": -5 }), { "file.name": 220 });
  assert.deepEqual(savedWidths(undefined), {});
  assert.deepEqual(savedWidths("200"), {});
});
