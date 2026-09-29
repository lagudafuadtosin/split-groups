// Pure grouping logic, kept free of the Obsidian runtime so it can be tested
// with plain Node. The view hands in each note's raw values as strings.

export const NO_VALUE_KEY = "\u0000no-value";
export const NO_VALUE_LABEL = "(no value)";

export interface Group<T> {
  key: string;
  label: string;
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

export function splitIntoGroups<T>(
  items: T[],
  valuesOf: (item: T) => string[],
  showNoValue: boolean,
  reverse = false,
): Group<T>[] {
  const groups = new Map<string, Group<T>>();
  const add = (key: string, label: string, item: T) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, entries: [] }));
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
      add(key, label, item);
    }
    if (seen.size === 0 && showNoValue) add(NO_VALUE_KEY, NO_VALUE_LABEL, item);
  }
  // Notes keep the order Bases sorted them in.
  // Groups sort by name, numbers naturally (2 before 10); flipped by `reverse`.
  // "(no value)" is always last.
  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_VALUE_KEY) return 1;
    if (b.key === NO_VALUE_KEY) return -1;
    const cmp = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
    return reverse ? -cmp : cmp;
  });
}
