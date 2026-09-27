# Split Groups

A view for Obsidian Bases that puts a note in **every** group its list property names.

Group a Base by a list property today and a recipe with `category: [main, side]` lands in one combined group called "main, side". With Split Groups it appears under **main** and again under **side**, which is what most people expect. This is the behaviour asked for in the forum thread [Make a note fall into multiple groups](https://forum.obsidian.md/t/bases-group-by-sorting-improvement-make-a-note-fall-into-multiple-groups/107097).

## Use it

1. Open a Base, open the view menu and add a view of type **Split groups**.
2. In the view options, set **Split by** to the list property to group on.
3. Pick **Table** or **List** under **Layout**. Columns come from the view's properties, as in any Base.

## How values are grouped

- Every item in a list gets its own group. A single value works too.
- `Main`, `main` and ` main ` are one group, shown with the spelling seen first.
- Links group by the note they point to: `[[Main]]`, `[[Recipes/Main.md]]`, `[[Main|Main dish]]` and plain `main` share a group.
- A tag's leading `#` is dropped.
- The same value twice in one note counts once.
- Notes with nothing in the property go to **(no value)** at the end. Turn that off with **Show notes with no value**.
- Groups sort by name, numbers naturally (2 before 10). Notes inside a group keep the Base's own sort.

If you turn the plugin off, Split groups views show "Unknown view type" until you turn it back on or switch that view to Table. Your notes are never changed.

Click a note to open it, Ctrl or Cmd click (or middle click) for a new tab, and Ctrl or Cmd hover for a preview.

## Try it

`test-vault` is a small vault with recipes and edge cases (links, case, duplicates, empty lists, numbers). Open it in Obsidian, build the plugin, and open `Recipes.base` or `Edge.base`. `npm run bulk` adds 3,000 generated notes and `Bulk.base` for a speed check.

## Build

```
npm install
npm run build   # type checks, bundles main.js, copies it into test-vault
npm test        # unit tests for the grouping rules
```

## Licence

MIT, Fuad Laguda.
