// Pure template logic, kept free of the Obsidian runtime so it can be tested with plain Node.

// A note's text split into its frontmatter (the YAML between the --- lines, or null) and the rest.
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { yaml: null, body: text };
  return { yaml: m[1], body: text.slice(m[0].length) };
}

// Fills the same placeholders as Obsidian's own Templates: {{title}}, {{date}}, {{time}}, and
// {{date:FORMAT}} / {{time:FORMAT}} with a moment.js format. `format` turns a format into text for now.
export function fillPlaceholders(
  text: string,
  title: string,
  format: (fmt: string) => string,
  dateFormat = "YYYY-MM-DD",
  timeFormat = "HH:mm",
): string {
  return text.replace(/{{\s*(title|date|time)\s*(?::\s*([^}]*?))?\s*}}/gi, (_m, what: string, fmt?: string) => {
    const w = what.toLowerCase();
    if (w === "title") return title;
    return format(fmt && fmt.trim() ? fmt.trim() : w === "date" ? dateFormat : timeFormat);
  });
}

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

// Adds a template's properties to a new note's properties. What the note already has wins (a base
// fills in the values its filters need, and those must stay); lists are joined, without repeats.
export function mergeProps(note: Record<string, unknown>, template: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...note };
  for (const [k, v] of Object.entries(template)) {
    const mine = out[k];
    if (empty(mine)) out[k] = v;
    else if (Array.isArray(mine) || Array.isArray(v)) {
      const list: unknown[] = [...(Array.isArray(mine) ? (mine as unknown[]) : [mine]), ...(Array.isArray(v) ? (v as unknown[]) : [v])];
      out[k] = list.filter((x, i) => list.findIndex((y) => String(y) === String(x)) === i);
    }
  }
  return out;
}

// The body that goes under a new note's frontmatter: the template's body, after what is there (normally nothing).
export function appendBody(current: string, templateBody: string): string {
  const { yaml, body } = splitFrontmatter(current);
  const head = yaml === null ? "" : `---\n${yaml}\n---\n`;
  const rest = body.trim() ? `${body.trimEnd()}\n\n${templateBody.trimStart()}` : templateBody.replace(/^\s*\n/, "");
  return head + rest;
}

// A template's properties without the ones a group fills in: under a group's +, the group decides those.
export function withoutKeys(props: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([k]) => !keys.includes(k)));
}
