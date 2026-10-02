import { BasesAllOptions, BasesEntry, BasesPropertyId, BasesView, HoverParent, HoverPopover, Keymap, Plugin, QueryController, Value, setIcon } from "obsidian";
import { splitIntoGroups, cleanValue, tableColumns, savedWidths, NAME_COLUMN, NO_VALUE_KEY, frontmatterKey, addValue } from "./groups";

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
      options: (): BasesAllOptions[] => [
        { type: "property", key: "splitBy", displayName: "Split by" },
        { type: "dropdown", key: "sortOrder", displayName: "Sort", default: "asc", options: { asc: "A → Z", desc: "Z → A" } },
        { type: "dropdown", key: "layout", displayName: "Layout", default: "table", options: { table: "Table", list: "List" } },
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
    const asTable = this.config.get("layout") !== "list";
    if (!prop) {
      // Like Table, Cards and List, show the notes straight away, ungrouped,
      // so a new view does not look broken before a property is chosen.
      root.createDiv({ cls: "split-groups-hint", text: "Choose a property under \"Split by\" in this view's options to split these notes into groups." });
      if (this.data.data.length === 0) {
        root.createDiv({ cls: "split-groups-hint", text: "No notes match this view." });
        return;
      }
      const columns = this.config.getOrder().filter((p) => p !== "file.name");
      const all = createDiv({ cls: "split-groups-all" });
      if (asTable) this.renderTable(all, this.data.data, tableColumns(this.config.getOrder()));
      else {
        const list = all.createDiv({ cls: "split-groups-list" });
        for (const entry of this.data.data) this.renderEntry(list, entry, columns);
      }
      root.appendChild(all);
      return;
    }
    const showNoValue = this.config.get("showNoValue") !== false;
    // The table keeps the split property as a column so every value stays
    // visible; the list drops it because the group heading already says it.
    const columns = asTable
      ? tableColumns(this.config.getOrder())
      : this.config.getOrder().filter((p) => p !== "file.name" && p !== prop);
    const reverse = this.config.get("sortOrder") === "desc";
    const groups = splitIntoGroups(this.data.data, (e) => rawStrings(e.getValue(prop)), showNoValue, reverse);
    if (groups.length === 0) {
      root.createDiv({ cls: "split-groups-hint", text: "No notes match this view." });
      return;
    }
    const key = frontmatterKey(prop);
    // Built off-DOM and attached once, so a large vault repaints once.
    const frag = createFragment();
    for (const g of groups) {
      const section = frag.createEl("details", { cls: "split-groups-group" });
      section.open = true;
      const summary = section.createEl("summary");
      summary.createSpan({ cls: "split-groups-name", text: g.label });
      summary.createSpan({ cls: "split-groups-count", text: String(g.entries.length) });
      // "+" makes a new note through the base's own new-note flow, with this
      // group's value already filled in. Only note properties can be written,
      // and "(no value)" has nothing to fill in.
      if (key && g.key !== NO_VALUE_KEY) {
        const add = summary.createEl("button", { cls: "split-groups-new clickable-icon", attr: { "aria-label": `New note in ${g.label}` } });
        setIcon(add, "plus");
        add.addEventListener("click", (evt) => {
          // Inside <summary>, so stop the click from also folding the group.
          evt.preventDefault();
          evt.stopPropagation();
          void this.createFileForView(undefined, (fm: Record<string, unknown>) => {
            fm[key] = addValue(fm[key], g.raw);
          });
        });
      }
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
    // Widths dragged in this view (or a Table view it was switched from) are
    // kept under "columnSize"; until then the name takes 40% and the rest share.
    const sizes = savedWidths(this.config.get("columnSize"));
    const allSized = columns.every((p) => sizes[p] !== undefined);
    const cols = table.createEl("colgroup");
    const others = columns.length - 1;
    for (const p of columns) {
      const col = cols.createEl("col", { attr: { "data-prop": p } });
      if (sizes[p] !== undefined) col.setCssStyles({ width: `${sizes[p]}px` });
      else if (others === 0) col.setCssStyles({ width: "100%" });
      else col.setCssStyles({ width: p === NAME_COLUMN ? "40%" : `${60 / others}%` });
    }
    if (allSized) table.setCssStyles({ width: `${columns.reduce((sum, p) => sum + sizes[p], 0)}px` });
    const head = table.createEl("thead").createEl("tr");
    for (const p of columns) {
      const th = head.createEl("th", { text: this.config.getDisplayName(p), attr: { "data-prop": p } });
      const grip = th.createDiv({ cls: "split-groups-resize", attr: { "aria-hidden": "true" } });
      grip.addEventListener("pointerdown", (evt) => this.startResize(evt, p, th));
    }
    const body = table.createEl("tbody");
    for (const entry of entries) {
      const tr = body.createEl("tr");
      for (const p of columns) {
        if (p === NAME_COLUMN) {
          this.renderLink(tr.createEl("td"), entry);
          continue;
        }
        const text = cellText(entry.getValue(p));
        // Full value on hover, since narrow columns cut it short.
        tr.createEl("td", { text, attr: text ? { title: text } : {} });
      }
    }
  }

  // Dragging a header's edge resizes that column in every group at once. On
  // the first drag every column is pinned at its current width, so only the
  // dragged one moves. The widths are saved with the view when the drag ends.
  private startResize(evt: PointerEvent, prop: string, th: HTMLElement) {
    evt.preventDefault();
    evt.stopPropagation();
    const win = th.win;
    const startX = evt.clientX;
    const widths: Record<string, number> = {};
    th.parentElement?.querySelectorAll<HTMLElement>("th[data-prop]").forEach((h) => {
      widths[h.dataset.prop!] = Math.round(h.getBoundingClientRect().width);
    });
    const startWidth = widths[prop];
    const apply = () => {
      this.root.querySelectorAll<HTMLElement>("col[data-prop]").forEach((c) => {
        const w = widths[c.dataset.prop!];
        if (w) c.setCssStyles({ width: `${w}px` });
      });
      const total = Object.values(widths).reduce((a, b) => a + b, 0);
      this.root.querySelectorAll<HTMLElement>(".split-groups-table").forEach((t) => t.setCssStyles({ width: `${total}px` }));
    };
    apply();
    const move = (e: PointerEvent) => {
      widths[prop] = Math.max(48, Math.round(startWidth + e.clientX - startX));
      apply();
    };
    const end = () => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", end);
      win.removeEventListener("pointercancel", end);
      this.config.set("columnSize", { ...savedWidths(this.config.get("columnSize")), ...widths });
    };
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", end);
    win.addEventListener("pointercancel", end);
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
