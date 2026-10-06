// Pure grouping logic, kept free of the Obsidian runtime so it can be tested
// with plain Node. The view hands in each note's raw values as strings.

export const NO_VALUE_KEY = "\u0000no-value";
export const NO_VALUE_LABEL = "(no value)";

export interface Group<T> {
  key: string;
  label: string;
  // The value as first written in a note, e.g. "[[Main]]", so a new note in
  // this group can be given exactly the same value.
  raw: string;
  entries: T[];
}

// Turns one raw value into the name of its group: "[[Recipes/Main|Main dish]]"
// becomes "Main", "#main" becomes "main", " Main " becomes "Main". Returns ""
// when there is nothing there.
export function cleanValue(raw: string): string {
  let s = raw.trim();
  if (s === "" || s === "null") return "";
  const link = s.match(/^!?\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]$/);
  if (link) {
    // Group by the note the link points to; an alias is only how it is shown.
    s = link[1].trim().split("/").pop()!.replace(/\.md$/i, "");
  } else if (s.startsWith("#") && !/\s/.test(s)) {
    s = s.slice(1);
  }
  return s.trim();
}

// Case differences are one group ("Main" and "main"), shown with the spelling
// seen first. Accents still count: "Café" and "Cafe" stay apart.
export function groupKey(label: string): string {
  return label.normalize("NFKC").toLocaleLowerCase();
}

// How groups are ordered: by name A to Z or Z to A, or by how many notes they hold.
export type GroupOrder = "asc" | "desc" | "most" | "fewest";

export function toOrder(raw: unknown): GroupOrder {
  return raw === "desc" || raw === "most" || raw === "fewest" ? raw : "asc";
}

export function splitIntoGroups<T>(
  items: T[],
  valuesOf: (item: T) => string[],
  showNoValue: boolean,
  order: GroupOrder | boolean = "asc", // true and false are the old reverse flag
): Group<T>[] {
  const how: GroupOrder = order === true ? "desc" : order === false ? "asc" : order;
  const groups = new Map<string, Group<T>>();
  const add = (key: string, label: string, raw: string, item: T) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, raw, entries: [] }));
    g.entries.push(item);
  };
  for (const item of items) {
    const seen = new Set<string>();
    for (const raw of valuesOf(item)) {
      const label = cleanValue(raw);
      if (!label) continue;
      const key = groupKey(label);
      if (seen.has(key)) continue; // [main, Main] puts a note in "main" once
      seen.add(key);
      add(key, label, raw.trim(), item);
    }
    if (seen.size === 0 && showNoValue) add(NO_VALUE_KEY, NO_VALUE_LABEL, "", item);
  }
  // Notes keep the order Bases sorted them in.
  // Groups sort by name, numbers naturally (2 before 10), or by size with the
  // name breaking ties. "(no value)" is always last.
  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_VALUE_KEY) return 1;
    if (b.key === NO_VALUE_KEY) return -1;
    const byName = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
    if (how === "most") return b.entries.length - a.entries.length || byName;
    if (how === "fewest") return a.entries.length - b.entries.length || byName;
    return how === "desc" ? -byName : byName;
  });
}

export const NAME_COLUMN = "file.name";

// Table columns in the order set under Properties, with the note name wherever
// it is placed there. If the name is not listed, it goes first so every row
// still has its link.
export function tableColumns<P extends string>(order: P[]): P[] {
  return order.includes(NAME_COLUMN as P) ? [...order] : [NAME_COLUMN as P, ...order];
}

// Column widths saved by a Bases view under "columnSize", as whole pixels per
// property. Anything that is not a positive number is left out.
export function savedWidths(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.round(v);
  }
  return out;
}

// The frontmatter key behind a Bases property id: "note.category" is
// "category". File and formula properties cannot be written, so null.
export function frontmatterKey(propertyId: string): string | null {
  return propertyId.startsWith("note.") ? propertyId.slice(5) : null;
}

// Adds a group's value to a note's frontmatter without dropping what is
// already there (a base's filter may have filled the same property in).
export function addValue(current: unknown, value: string): unknown {
  if (current === undefined || current === null || current === "") return [value];
  const list: unknown[] = Array.isArray(current) ? current : [current];
  return list.some((v) => String(v) === value) ? list : [...list, value];
}

// Where a group sits, for remembering which ones are folded: "main" for a group,
// "main/quick" for a sub-group inside it.
export function groupPath(key: string, subKey?: string): string {
  return subKey === undefined ? key : `${key}/${subKey}`;
}

// The folded groups saved with a view, as a set. Anything that is not a list of
// strings is ignored.
export function savedFolded(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
}
