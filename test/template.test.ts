import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter, fillPlaceholders, mergeProps, appendBody, withoutKeys } from "../src/template";

test("frontmatter is split from the body", () => {
  assert.deepEqual(splitFrontmatter("---\ntags: [a]\n---\nHello"), { yaml: "tags: [a]", body: "Hello" });
  assert.deepEqual(splitFrontmatter("No frontmatter"), { yaml: null, body: "No frontmatter" });
  assert.deepEqual(splitFrontmatter("---\nx: 1\n---"), { yaml: "x: 1", body: "" });
  assert.deepEqual(splitFrontmatter("---\r\nx: 1\r\n---\r\nBody"), { yaml: "x: 1", body: "Body" });
});

test("placeholders fill like Obsidian's own Templates", () => {
  const fmt = (f: string) => `<${f}>`;
  assert.equal(fillPlaceholders("# {{title}}", "Dune", fmt), "# Dune");
  assert.equal(fillPlaceholders("{{date}} {{time}}", "x", fmt), "<YYYY-MM-DD> <HH:mm>");
  assert.equal(fillPlaceholders("{{date:dddd D MMMM}} {{ TIME:HH }}", "x", fmt), "<dddd D MMMM> <HH>");
  assert.equal(fillPlaceholders("{{date}}", "x", fmt, "DD/MM/YYYY"), "<DD/MM/YYYY>");
  assert.equal(fillPlaceholders("{{nothing}} and {single}", "x", fmt), "{{nothing}} and {single}");
});

test("the note's own values win, lists are joined without repeats", () => {
  assert.deepEqual(
    mergeProps({ status: "reading", tags: ["book"] }, { status: "to read", tags: ["book", "fiction"], rating: 0 }),
    { status: "reading", tags: ["book", "fiction"], rating: 0 },
  );
  assert.deepEqual(mergeProps({ status: "" }, { status: "to read" }), { status: "to read" });
  assert.deepEqual(mergeProps({ tags: "book" }, { tags: ["fiction"] }), { tags: ["book", "fiction"] });
  assert.deepEqual(mergeProps({}, {}), {});
});

test("the template body goes under the frontmatter of a new note", () => {
  assert.equal(appendBody("", "## Notes\n"), "## Notes\n");
  assert.equal(appendBody("---\nstatus: x\n---\n", "\n## Notes\n"), "---\nstatus: x\n---\n## Notes\n");
  assert.equal(appendBody("---\nstatus: x\n---\nAlready here", "## Notes"), "---\nstatus: x\n---\nAlready here\n\n## Notes");
});

test("a group's own properties are left out of the template", () => {
  assert.deepEqual(withoutKeys({ category: ["none"], diet: "x", time: 5 }, ["category", "diet"]), { time: 5 });
  assert.deepEqual(withoutKeys({ time: 5 }, []), { time: 5 });
});
