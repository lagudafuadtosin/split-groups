# Contributing

Thanks for helping. Bug reports, fixes and ideas are all welcome.

## Reporting a bug

Open an issue with:

- your Obsidian version and platform (desktop or mobile, which OS)
- the property you split by and one or two example values, copied from a note's frontmatter
- what you expected to see and what you saw instead

If you can, reproduce it in `test-vault` first. A note or a `.base` file that shows the problem is the fastest way to a fix.

## Working on the code

```
npm install
npm run build   # type checks, bundles main.js, copies it into test-vault
npm test        # unit tests for the grouping rules
npm run lint    # Obsidian's own review rules, the same ones it runs on every release
```

Open `test-vault` in Obsidian, turn on Split Groups under Community plugins, and open `Recipes.base` or `Edge.base`. After each build, turn the plugin off and on again to load it. `npm run bulk` adds 3,000 generated notes and `Bulk.base` for a speed check.

The grouping rules live in `src/groups.ts` and have no Obsidian dependency, so new rules should come with a test in `test/groups.test.ts`. The view itself is in `src/main.ts`.

## Pull requests

Keep a pull request to one change, say what it fixes, and include a test when the grouping rules change. The plugin only reads notes. Changes that write to notes, reach the network or add dependencies need a strong reason.

## Releases

Maintainers bump the version in `manifest.json`, `package.json` and `versions.json`, write `RELEASE_NOTES.md`, and push a tag with the same version. The release workflow builds, attests and publishes the files.
