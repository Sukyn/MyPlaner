# Architecture

## Overview

This project is a small static planner with one important source of truth: the
`todolist/` directory. Everything else is derived from those files.

## Main pieces

- `todolist/`: daily markdown files, `project.json`, and optional `recurring.json`.
- `scripts/planner-data.mjs`: reads planner sources, normalizes them, schedules
  every item into agenda slots, and performs create/delete mutations.
- `scripts/dev-server.mjs`: rebuilds `dist/`, serves the static app locally, and
  exposes the JSON endpoints used by the UI forms.
- `src/`: static client that renders `planner-data.json` and handles local UI
  state such as filters, dialogs, and the live "today" view.
- `dist/`: generated output. Treat it as build artefacts, not source.

## Data flow

1. `npm run build` calls `buildSite()`.
2. `buildSite()` loads every project under `todolist/`.
3. Markdown files are parsed into normalized planner items.
4. Recurring rules are expanded into dated items across the planner range.
5. `scheduleDayItems()` assigns each item an agenda slot.
6. The final JSON is written to `dist/planner-data.json` for the browser.

## Scheduling model

- Explicit ranges such as `09h00-10h30` become fixed slots.
- Explicit starts such as `12h00 submit draft` become anchored slots.
- Everything else is auto-placed after explicit work is reserved.
- Relative hints like `after 10h00-11h00` constrain auto-placement.
- The browser only reflows auto-placed items for the current day so the UI can
  stay current without rebuilding the site.

## Mutation model

The local API never edits planner data directly in `dist/`. It edits the real
source files under `todolist/` and then triggers a rebuild.

- Project creation makes a new project directory, `.gitkeep`, and `project.json`.
- Item creation inserts a bullet into the correct markdown section.
- Item deletion uses source fingerprints plus stored indexes to safely remove
  the correct bullet or recurring rule, even when duplicates exist.

## Testing guidance

Run `npm test` after changing parser, scheduling, or mutation logic.

The tests in `test/planner-data.test.mjs` are intentionally focused on the
high-value behavior in `scripts/planner-data.mjs`:

- planner-data generation from markdown and recurring rules;
- section insertion for newly created items;
- project creation side effects;
- deletion of duplicate daily items and recurring rules.