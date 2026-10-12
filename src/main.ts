import { BasesAllOptions, BasesEntry, BasesPropertyId, BasesView, HoverParent, HoverPopover, Keymap, Notice, Plugin, QueryController, TFile, Value, moment, parseYaml, setIcon } from "obsidian";
import { splitIntoGroups, cleanValue, tableColumns, savedWidths, NAME_COLUMN, NO_VALUE_KEY, frontmatterKey, addValue, toOrder, groupPath, savedFolded, movedValue, toDropMode, type Group } from "./groups";
import { appendBody, fillPlaceholders, mergeProps, splitFrontmatter, withoutKeys } from "./template";

// Split Groups: a Bases view where a note shows up under EVERY value of a list
// property, instead of under one combined group. A recipe with
// `category: [main, side]` appears in "main" and in "side", not in "main, side".
export const VIEW_TYPE = "split-groups";

type Fill = (fm: Record<string, unknown>) => void;

// A note asked for by a group's + that is to be made from the view's template:
// the template, the properties the group fills in, and when the + was pressed.
interface Pending {
  template: TFile;
  keys: string[];
  fill: Fill;
  at: number;
}

// A note made within this many milliseconds of the + counts as made by it.
const WINDOW = 3000;

interface TemplaterApi {
  write_template_to_file(template: TFile, file: TFile): Promise<void>;
}

export default class SplitGroupsPlugin extends Plugin {
  pending: Pending | null = null;
  views = new Set<SplitGroupsView>();

  async onload() {
    this.registerBasesView(VIEW_TYPE, {
      name: "Split groups",
      icon: "layout-list",
      factory: (controller, containerEl) => new SplitGroupsView(controller, containerEl, this),
      options: (): BasesAllOptions[] => [
        { type: "property", key: "splitBy", displayName: "Split by" },
        { type: "property", key: "thenSplitBy", displayName: "Then split by" },
        {
          type: "dropdown",
          key: "sortOrder",
          displayName: "Sort groups",
          default: "asc",
          options: { asc: "A → Z", desc: "Z → A", most: "Most notes first", fewest: "Fewest notes first" },
        },
        { type: "dropdown", key: "layout", displayName: "Layout", default: "table", options: { table: "Table", list: "List", cards: "Cards", kanban: "Kanban" } },
        // Cards and Kanban show this property's image at the top of each card
        { type: "property", key: "image", displayName: "Image property" },
        {
          type: "dropdown",
          key: "onDrop",
          displayName: "Dropping a card on a group",
          default: "move",
          options: { move: "Moves it: that group's value replaces the one it came from", add: "Adds that group's value, keeps the others", replace: "Leaves only that group's value" },
        },
        { type: "toggle", key: "showNoValue", displayName: "Show notes with no value", default: true },
        { type: "file", key: "template", displayName: "Template for new notes", placeholder: "None", filter: (f) => f.extension === "md" },
      ],
    });
    // The toolbar's New in a Split groups view uses the view's template too.
    // Watched in the capture phase, so it is seen before the base makes the note.
    const onNew = (evt: Event) => {
      const target = evt.target instanceof Element ? evt.target : null;
      if (!target?.closest(".bases-toolbar-new-item-menu")) return;
      if (evt instanceof KeyboardEvent && evt.key !== "Enter" && evt.key !== " ") return;
      for (const view of this.views) if (view.owns(target)) view.newFromToolbar();
    };
    this.registerDomEvent(activeDocument, "pointerdown", onNew, { capture: true });
    this.registerDomEvent(activeDocument, "keydown", onNew, { capture: true });
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.onCreate(file);
      }));
    });
  }

  private async onCreate(file: TFile) {
    const p = this.pending;
    if (!p || Date.now() - p.at > WINDOW) return;
    // Only a brand new note: anything that already has a body was not made by the +
    if (splitFrontmatter(await this.app.vault.read(file)).body.trim()) return;
    this.pending = null; // one note per click
    try {
      await this.applyTemplate(p, file);
    } catch (err) {
      new Notice(`Split Groups could not fill in ${file.basename} from ${p.template.basename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The template's properties and body go into the new note. The group's own
  // values win over the template's, and values the base fills in are kept.
  private async applyTemplate(p: Pending, file: TFile) {
    const text = await this.app.vault.read(p.template);
    // Templater syntax goes to Templater when it is installed; the note's own values are put back after.
    const plugins = (this.app as unknown as { plugins: { getPlugin(id: string): unknown } }).plugins;
    const templater = (plugins.getPlugin("templater-obsidian") as { templater?: TemplaterApi } | null)?.templater;
    if (text.includes("<%") && templater?.write_template_to_file) {
      const before = splitFrontmatter(await this.app.vault.read(file)).yaml;
      const kept = before ? (parseYaml(before) as Record<string, unknown> | null) ?? {} : {};
      await templater.write_template_to_file(p.template, file);
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const k of p.keys) delete fm[k];
        Object.assign(fm, mergeProps(kept, fm));
        p.fill(fm);
      });
      return;
    }
    // Typed here so the check holds where moment's own types are not installed
    const now = moment as unknown as () => { format(fmt: string): string };
    const filled = fillPlaceholders(text, file.basename, (fmt) => now().format(fmt));
    const { yaml, body } = splitFrontmatter(filled);
    const props = yaml ? withoutKeys((parseYaml(yaml) as Record<string, unknown> | null) ?? {}, p.keys) : {};
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      Object.assign(fm, mergeProps(fm, props));
      p.fill(fm);
    });
    if (body.trim()) await this.app.vault.process(file, (data) => appendBody(data, body));
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

type Layout = "table" | "list" | "cards" | "kanban";

function toLayout(raw: unknown): Layout {
  return raw === "list" || raw === "cards" || raw === "kanban" ? raw : "table";
}

// A card being dragged between Kanban columns: which note, which group it
// left, where the pointer started, and the copy that follows the pointer.
interface Drag {
  entry: BasesEntry;
  from: string;
  startX: number;
  startY: number;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
}

// Pointer travel before a press on a card becomes a drag rather than a click
const DRAG_START = 6;

class SplitGroupsView extends BasesView implements HoverParent {
  type = VIEW_TYPE;
  hoverPopover: HoverPopover | null = null;
  private root: HTMLElement;
  private drag: Drag | null = null;
  // Set when a drag ends on a card, so the click that follows does not open the note
  private dropped = false;
  // Each Kanban column's group, by key, for the drop that lands on it
  private columns = new Map<string, Group<BasesEntry>>();

  constructor(controller: QueryController, containerEl: HTMLElement, private plugin: SplitGroupsPlugin) {
    super(controller);
    this.root = containerEl.createDiv({ cls: "split-groups" });
    plugin.views.add(this);
  }

  onunload(): void {
    this.plugin.views.delete(this);
  }

  // Whether this view is the one showing in the tab that holds `el`
  owns(el: Element): boolean {
    const tab = this.root.closest(".workspace-leaf-content");
    return this.root.isConnected && !!tab && tab.contains(el);
  }

  // The toolbar's New: the view's template, with no group value to fill in
  newFromToolbar() {
    const template = this.templateFile();
    if (template) this.plugin.pending = { template, keys: [], fill: () => {}, at: Date.now() };
  }

  onDataUpdated(): void {
    this.render();
  }

  private render() {
    const root = this.root;
    root.empty();
    const prop = this.config.getAsPropertyId("splitBy");
    const layout = toLayout(this.config.get("layout"));
    const asTable = layout === "table";
    root.toggleClass("split-groups-kanban", layout === "kanban");
    this.columns.clear();
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
      // Without a property there are no columns, so Kanban shows cards.
      this.renderEntries(all, this.data.data, asTable ? tableColumns(this.config.getOrder()) : columns, layout === "kanban" ? "cards" : layout, null);
      root.appendChild(all);
      return;
    }
    const showNoValue = this.config.get("showNoValue") !== false;
    // The table keeps the split property as a column so every value stays
    // visible; the list drops it because the group heading already says it.
    const columns = asTable
      ? tableColumns(this.config.getOrder())
      : this.config.getOrder().filter((p) => p !== "file.name" && p !== prop);
    const order = toOrder(this.config.get("sortOrder"));
    const valuesOf = (p: BasesPropertyId) => (e: BasesEntry) => rawStrings(e.getValue(p));
    const groups = splitIntoGroups(this.data.data, valuesOf(prop), showNoValue, order);
    if (groups.length === 0) {
      root.createDiv({ cls: "split-groups-hint", text: "No notes match this view." });
      return;
    }
    // A second split inside each group, if one is chosen (and it is not the same
    // property). Kanban has one column per group and no sub-groups.
    const subProp = this.config.getAsPropertyId("thenSplitBy");
    const sub = subProp && subProp !== prop && layout !== "kanban" ? subProp : null;
    const subColumns = sub && !asTable ? columns.filter((p) => p !== sub) : columns;
    const key = frontmatterKey(prop);
    const subKey = sub ? frontmatterKey(sub) : null;
    const folded = savedFolded(this.config.get("folded"));
    const paths: string[] = [];

    // Built off-DOM and attached once, so a large vault repaints once.
    const frag = createFragment();
    const bar = frag.createDiv({ cls: "split-groups-bar" });
    const foldAll = bar.createEl("button", { cls: "split-groups-fold-all", text: "Collapse all" });
    const openAll = bar.createEl("button", { cls: "split-groups-fold-all", text: "Expand all" });
    foldAll.addEventListener("click", () => this.saveFolded(new Set(paths)));
    openAll.addEventListener("click", () => this.saveFolded(new Set()));
    if (layout === "kanban" && subProp && subProp !== prop) {
      frag.createDiv({ cls: "split-groups-hint", text: "Then split by is not used in the Kanban layout." });
    }
    if (layout === "kanban" && !key) {
      frag.createDiv({ cls: "split-groups-hint", text: "Cards can be dragged between columns when Split by is a note property." });
    }
    // Kanban columns sit side by side in one row
    const row = layout === "kanban" ? frag.createDiv({ cls: "split-groups-board" }) : frag;

    for (const g of groups) {
      const path = groupPath(g.key);
      paths.push(path);
      const section = this.groupSection(row, g, path, folded, layout === "kanban" ? "split-groups-group split-groups-column" : "split-groups-group", (fm) => {
        if (key) fm[key] = addValue(fm[key], g.raw);
      }, !!key && g.key !== NO_VALUE_KEY);
      if (layout === "kanban") {
        section.dataset.key = g.key;
        this.columns.set(g.key, g);
      }
      if (!sub) {
        this.renderEntries(section, g.entries, columns, layout, layout === "kanban" && key ? g.key : null);
        continue;
      }
      for (const s2 of splitIntoGroups(g.entries, valuesOf(sub), showNoValue, order)) {
        const subPath = groupPath(g.key, s2.key);
        paths.push(subPath);
        const inner = this.groupSection(section, s2, subPath, folded, "split-groups-subgroup", (fm) => {
          if (key && g.key !== NO_VALUE_KEY) fm[key] = addValue(fm[key], g.raw);
          if (subKey) fm[subKey] = addValue(fm[subKey], s2.raw);
        }, !!key && !!subKey && g.key !== NO_VALUE_KEY && s2.key !== NO_VALUE_KEY);
        this.renderEntries(inner, s2.entries, subColumns, layout, null);
      }
    }
    root.appendChild(frag);
  }

  // One group (or sub-group) heading: its name, its count and a "+" for a new note
  // with its value(s) filled in. Whether it is folded is remembered with the view.
  private groupSection(
    parent: DocumentFragment | HTMLElement,
    g: Group<BasesEntry>,
    path: string,
    folded: Set<string>,
    cls: string,
    fill: Fill,
    canAdd: boolean,
  ): HTMLElement {
    const section = parent.createEl("details", { cls });
    section.open = !folded.has(path);
    // Saved only when the person folds or opens it, not when it is drawn
    section.addEventListener("toggle", () => {
      const now = savedFolded(this.config.get("folded"));
      if (section.open === !now.has(path)) return;
      if (section.open) now.delete(path);
      else now.add(path);
      this.saveFolded(now);
    });
    const summary = section.createEl("summary");
    summary.createSpan({ cls: "split-groups-name", text: g.label });
    summary.createSpan({ cls: "split-groups-count", text: String(g.entries.length) });
    if (canAdd) {
      const add = summary.createEl("button", { cls: "split-groups-new clickable-icon", attr: { "aria-label": `New note in ${g.label}` } });
      setIcon(add, "plus");
      add.addEventListener("click", (evt) => {
        // Inside <summary>, so stop the click from also folding the group.
        evt.preventDefault();
        evt.stopPropagation();
        this.newNote(fill);
      });
    }
    return section;
  }

  // A new note with the group's value(s) filled in, made from the view's
  // template when one is chosen under "Template for new notes".
  private newNote(fill: Fill) {
    const template = this.templateFile();
    if (template) {
      const own: Record<string, unknown> = {};
      fill(own);
      this.plugin.pending = { template, keys: Object.keys(own), fill, at: Date.now() };
    }
    void this.createFileForView(undefined, fill);
  }

  private templateFile(): TFile | null {
    const raw = this.config.get("template");
    if (typeof raw !== "string" || !raw.trim()) return null;
    // Saved as a path, or as a [[link]] if typed by hand
    const path = raw.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
    const file = this.app.vault.getFileByPath(path) ?? this.app.metadataCache.getFirstLinkpathDest(path, "");
    if (!file) new Notice(`Split Groups: the template ${path} was not found, so the note is blank.`);
    return file;
  }

  private saveFolded(paths: Set<string>) {
    this.config.set("folded", [...paths].sort());
    // Redrawn straight away so Collapse all / Expand all show at once
    this.render();
  }

  // `dragFrom` is the group key the cards can be dragged out of (Kanban, when
  // the split property can be written), or null when they cannot be dragged.
  private renderEntries(section: HTMLElement, entries: BasesEntry[], columns: BasesPropertyId[], layout: Layout, dragFrom: string | null) {
    if (layout === "table") this.renderTable(section, entries, columns);
    else if (layout === "list") {
      const list = section.createDiv({ cls: "split-groups-list" });
      for (const entry of entries) this.renderEntry(list, entry, columns);
    } else {
      const grid = section.createDiv({ cls: layout === "kanban" ? "split-groups-stack" : "split-groups-cards" });
      const image = this.config.getAsPropertyId("image");
      for (const entry of entries) this.renderCard(grid, entry, columns.filter((p) => p !== image), image, dragFrom);
    }
  }

  // One card: the image at the top when the view has an image property and the
  // note has one, then the name, then the properties that have a value.
  private renderCard(grid: HTMLElement, entry: BasesEntry, columns: BasesPropertyId[], image: BasesPropertyId | null, dragFrom: string | null) {
    const card = grid.createDiv({ cls: "split-groups-card" });
    const src = image ? this.imageSrc(entry, entry.getValue(image)) : null;
    if (src) card.createDiv({ cls: "split-groups-card-cover" }).createEl("img", { attr: { src, alt: "", loading: "lazy" } });
    const body = card.createDiv({ cls: "split-groups-card-body" });
    this.renderLink(body.createDiv({ cls: "split-groups-card-title" }), entry);
    for (const p of columns) {
      if (p === NAME_COLUMN) continue;
      const text = cellText(entry.getValue(p));
      if (!text) continue;
      const line = body.createDiv({ cls: "split-groups-card-prop" });
      line.createSpan({ cls: "split-groups-prop-name", text: this.config.getDisplayName(p) + ": " });
      line.createSpan({ text });
    }
    if (dragFrom !== null) {
      card.addClass("split-groups-draggable");
      card.addEventListener("pointerdown", (evt) => this.startDrag(evt, card, entry, dragFrom));
      // The browser's own drag of the image or the link would cut the pointer events short
      card.addEventListener("dragstart", (evt) => evt.preventDefault());
    }
  }

  // The image behind a property value: a web address as it is, or a link or
  // path to a file in the vault. Nothing when it points at no file.
  private imageSrc(entry: BasesEntry, v: Value | null): string | null {
    const raw = rawStrings(v)[0]?.trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
    const file = this.app.metadataCache.getFirstLinkpathDest(path, entry.file.path) ?? this.app.vault.getFileByPath(path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  // A press on a Kanban card. A short press is a click and opens the note as
  // usual; moving the pointer makes it a drag, with a copy of the card under
  // the pointer, and the column under the pointer on release gets the note.
  private startDrag(evt: PointerEvent, card: HTMLElement, entry: BasesEntry, from: string) {
    if (evt.button !== 0 || this.drag) return;
    const drag: Drag = { entry, from, startX: evt.clientX, startY: evt.clientY, ghost: null, over: null };
    this.drag = drag;
    const win = card.win;
    const move = (e: PointerEvent) => {
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START) return;
        drag.ghost = this.root.createDiv({ cls: "split-groups-ghost" });
        drag.ghost.appendChild(card.cloneNode(true));
        drag.ghost.setCssStyles({ width: `${card.getBoundingClientRect().width}px` });
        card.addClass("split-groups-drag-source");
        try {
          card.setPointerCapture(e.pointerId);
        } catch { /* a pointer that cannot be captured still drags */ }
      }
      drag.ghost.setCssStyles({ left: `${e.clientX + 8}px`, top: `${e.clientY + 8}px` });
      const el = this.root.doc.elementFromPoint(e.clientX, e.clientY);
      const column = el?.closest<HTMLElement>(".split-groups-column") ?? null;
      if (column !== drag.over) {
        drag.over?.removeClass("split-groups-drop-target");
        drag.over = column && column.dataset.key !== from ? column : null;
        drag.over?.addClass("split-groups-drop-target");
      }
    };
    const end = (e: PointerEvent) => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", end);
      win.removeEventListener("pointercancel", cancel);
      const to = drag.over?.dataset.key;
      this.endDrag(card, drag);
      if (e.type === "pointerup" && to !== undefined) {
        // The release lands on the card too; that click must not open the note
        this.dropped = true;
        win.setTimeout(() => (this.dropped = false), 0);
        void this.drop(entry, from, to);
      }
    };
    const cancel = (e: PointerEvent) => end(e);
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", end);
    win.addEventListener("pointercancel", cancel);
  }

  private endDrag(card: HTMLElement, drag: Drag) {
    drag.ghost?.remove();
    drag.over?.removeClass("split-groups-drop-target");
    card.removeClass("split-groups-drag-source");
    this.drag = null;
  }

  // The drop: the note's list property is changed the way "Dropping a card on a
  // group" says. Only the split property is touched, nothing else in the note.
  private async drop(entry: BasesEntry, from: string, to: string) {
    const prop = this.config.getAsPropertyId("splitBy");
    const key = prop ? frontmatterKey(prop) : null;
    const target = this.columns.get(to);
    if (!key || !target) return;
    const mode = toDropMode(this.config.get("onDrop"));
    try {
      await this.app.fileManager.processFrontMatter(entry.file, (fm: Record<string, unknown>) => {
        const next = movedValue(fm[key], from, to, target.raw, mode);
        if (!next) return;
        if (next.length === 0) delete fm[key];
        else fm[key] = next;
      });
    } catch (err) {
      new Notice(`Split Groups could not change ${entry.file.basename}: ${err instanceof Error ? err.message : String(err)}`);
    }
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
      if (this.dropped) return;
      void this.app.workspace.openLinkText(path, "", Keymap.isModEvent(evt));
    };
    link.addEventListener("click", open);
    // A middle press on a link without href starts autoscroll, and then no auxclick follows.
    link.addEventListener("mousedown", (evt) => {
      if (evt.button === 1) evt.preventDefault();
    });
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
