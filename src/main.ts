import { BasesEntry, BasesPropertyId, BasesView, HoverParent, HoverPopover, Keymap, Plugin, QueryController, Value } from "obsidian";
import { splitIntoGroups, cleanValue } from "./groups";

// Split Groups: a Bases view where a note shows up under EVERY value of a list
// property, instead of under one combined group. A recipe with
// `category: [main, side]` appears in "main" and in "side", not in "main, side".
export const VIEW_TYPE = "split-groups";

export default class SplitGroupsPlugin extends Plugin {
  async onload() {
    this.registerBasesView(VIEW_TYPE, {
      name: "Split groups",
      icon: "layout-list",
      factory: (controller, containerEl) => new SplitGroupsView(controller, containerEl),
      options: () => [
        { type: "property", key: "splitBy", displayName: "Split by" },
        { type: "dropdown", key: "sortOrder", displayName: "Sort", default: "asc", options: { asc: "A → Z", desc: "Z → A" } as Record<string, string> },
        { type: "dropdown", key: "layout", displayName: "Layout", default: "table", options: { table: "Table", list: "List" } as Record<string, string> },
        { type: "toggle", key: "showNoValue", displayName: "Show notes with no value", default: true },
      ],
    });
  }
}

// A list value exposes length() and get(i). Checked by shape rather than
// instanceof so the view keeps working if the runtime class is not exported.
function isList(v: Value): v is Value & { length(): number; get(i: number): Value } {
  const l = v as unknown as { length?: unknown; get?: unknown };
  return typeof l.length === "function" && typeof l.get === "function";
}

// Every value as a string, one per list item. Nested lists are flattened.
function rawStrings(v: Value | null): string[] {
  if (!v) return [];
  if (!isList(v)) return [v.toString()];
  const out: string[] = [];
  for (let i = 0; i < v.length(); i++) out.push(...rawStrings(v.get(i)));
  return out;
}

function cellText(v: Value | null): string {
  return rawStrings(v).map(cleanValue).filter(Boolean).join(", ");
}

class SplitGroupsView extends BasesView implements HoverParent {
  type = VIEW_TYPE;
  hoverPopover: HoverPopover | null = null;
  private root: HTMLElement;

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.root = containerEl.createDiv({ cls: "split-groups" });
  }

  onDataUpdated(): void {
    this.render();
  }

  private render() {
    const root = this.root;
    root.empty();
    const prop = this.config.getAsPropertyId("splitBy");
    if (!prop) {
      root.createDiv({ cls: "split-groups-hint", text: "Choose a property under \"Split by\" in this view's options." });
      return;
    }
    const showNoValue = this.config.get("showNoValue") !== false;
    const asTable = this.config.get("layout") !== "list";
    // The table keeps the split property as a column so every value stays
    // visible; the list drops it because the group heading already says it.
    const columns = this.config.getOrder().filter((p) => p !== "file.name" && (asTable || p !== prop));
    const reverse = this.config.get("sortOrder") === "desc";
    const groups = splitIntoGroups(this.data.data, (e) => rawStrings(e.getValue(prop)), showNoValue, reverse);
    if (groups.length === 0) {
      root.createDiv({ cls: "split-groups-hint", text: "No notes match this view." });
      return;
    }
    // Built off-DOM and attached once, so a large vault repaints once.
    const frag = createFragment();
    for (const g of groups) {
      const section = frag.createEl("details", { cls: "split-groups-group" });
      section.open = true;
      const summary = section.createEl("summary");
      summary.createSpan({ cls: "split-groups-name", text: g.label });
      summary.createSpan({ cls: "split-groups-count", text: String(g.entries.length) });
      if (asTable) this.renderTable(section, g.entries, columns);
      else {
        const list = section.createDiv({ cls: "split-groups-list" });
        for (const entry of g.entries) this.renderEntry(list, entry, columns);
      }
    }
    root.appendChild(frag);
  }

  private renderTable(section: HTMLElement, entries: BasesEntry[], columns: BasesPropertyId[]) {
    const wrap = section.createDiv({ cls: "split-groups-table-wrap" });
    const table = wrap.createEl("table", { cls: "split-groups-table" });
    // Every group is its own table, so widths are fixed here rather than left to
    // each table's content; otherwise the columns shift from group to group.
    const cols = table.createEl("colgroup");
    const nameWidth = columns.length === 0 ? 100 : 40;
    cols.createEl("col").style.width = `${nameWidth}%`;
    for (let i = 0; i < columns.length; i++) cols.createEl("col").style.width = `${(100 - nameWidth) / columns.length}%`;
    const head = table.createEl("thead").createEl("tr");
    head.createEl("th", { text: this.config.getDisplayName("file.name") });
    for (const p of columns) head.createEl("th", { text: this.config.getDisplayName(p) });
    const body = table.createEl("tbody");
    for (const entry of entries) {
      const tr = body.createEl("tr");
      this.renderLink(tr.createEl("td"), entry);
      for (const p of columns) {
        const text = cellText(entry.getValue(p));
        // Full value on hover, since narrow columns cut it short.
        tr.createEl("td", { text, attr: text ? { title: text } : {} });
      }
    }
  }

  private renderEntry(list: HTMLElement, entry: BasesEntry, columns: BasesPropertyId[]) {
    const row = list.createDiv({ cls: "split-groups-row" });
    this.renderLink(row, entry);
    for (const p of columns) {
      const text = cellText(entry.getValue(p));
      if (!text) continue;
      const cell = row.createSpan({ cls: "split-groups-prop" });
      cell.createSpan({ cls: "split-groups-prop-name", text: this.config.getDisplayName(p) + ": " });
      cell.createSpan({ text });
    }
  }

  private renderLink(parent: HTMLElement, entry: BasesEntry) {
    const path = entry.file.path;
    // No href: a note's path is never handed to the browser as a URL, so a file
    // named like "javascript:..." can only ever open as a note.
    const link = parent.createEl("a", {
      cls: "internal-link split-groups-title",
      text: entry.file.basename,
      attr: { "data-href": path, role: "link", tabindex: "0" },
    });
    // Click opens here; Ctrl/Cmd click, middle click or Ctrl/Cmd Enter opens a
    // new tab, like other links in Obsidian.
    const open = (evt: MouseEvent | KeyboardEvent) => {
      evt.preventDefault();
      void this.app.workspace.openLinkText(path, "", Keymap.isModEvent(evt));
    };
    link.addEventListener("click", open);
    link.addEventListener("auxclick", (evt) => {
      if (evt.button === 1) open(evt);
    });
    link.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") open(evt);
    });
    // Page preview on Ctrl/Cmd hover.
    link.addEventListener("mouseover", (evt) => {
      this.app.workspace.trigger("hover-link", { event: evt, source: VIEW_TYPE, hoverParent: this, targetEl: link, linktext: path });
    });
  }
}
