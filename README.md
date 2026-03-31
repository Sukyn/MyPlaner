# My Planner

`todolist/` is now the source of truth. The app reads every daily project file, aggregates all entries for a given date, and renders them in the planner UI.

## Todo structure

```text
todolist/
  professional/
    some-project/
      2026-03-25.md
      2026-03-26.md
  personnal/
    some-project/
      2026-03-25.md
```

Each file is one project for one day. Use Markdown sections to group entries:

```md
# 2026-03-25

## Tasks
- 09h00 @90m Finish the draft

## Deadlines
- Send the final version

## Events
- 15h00 seminar
```

Supported sections are `Tasks`, `Cadence`, `Deadlines`, `Milestones`, and `Events`. Plain bullet items default to `Tasks`.

Write task lines as concrete deliverables such as `Write the introduction` or `Grade 4 IA projects`.
Put lessons, travel, seminars, conferences, and other blocking commitments under `Events`, not under `Tasks` or `Cadence`.

The planner now turns each day into a real agenda:

- leading time slots such as `09h00-10h30 Write the outline` become fixed reservations;
- leading starts such as `12h00 submit the rebuttal` become anchored slots with an estimated duration;
- duration hints such as `45-60 minutes of revision` or `@45m` reserve the right-sized block;
- relative phrases such as `After the 08h00-10h00 teaching slot, write the introduction paragraph.` bias auto-placement around known events.

Items without an explicit slot still receive an automatic reserved block, so the day panel shows what to do hour by hour instead of a flat todo list.

Projects can also define recurring items with a `recurring.json` file:

```json
{
  "rules": [
    {
      "kind": "cadence",
      "text": "Do accounting.",
      "schedule": {
        "type": "monthly",
        "days": [15, 31],
        "lastDayFallback": true
      }
    }
  ]
}
```

Weekly recurring rules are also supported:

```json
{
  "rules": [
    {
      "kind": "event",
      "text": "10h00-12h00 Aller à l'escalade",
      "schedule": {
        "type": "weekly",
        "weekdays": ["Saturday"]
      },
      "startDate": "2026-04-04"
    }
  ]
}
```

Recurring rules can be monthly or weekly, and recurring projects keep a rolling 12-month horizon from today so reminders keep showing up.

## Local use

Run:

```powershell
npm start
```

That command:

- parses `todolist/`;
- rebuilds the static app into `dist/`;
- serves it locally at `http://localhost:4173`;
- watches for changes in `todolist/` and `src/`.

If you only want a production build:

```powershell
npm run build
```

## Tests

Run:

```powershell
npm test
```

The test suite covers the parser, scheduler, and file mutation helpers in `scripts/planner-data.mjs`.

## Maintainer map

- `todolist/` is the source of truth.
- `scripts/planner-data.mjs` parses todo files, applies agenda scheduling, and handles create/delete mutations.
- `scripts/dev-server.mjs` rebuilds `dist/`, serves the static app, and exposes the local JSON API used by the UI.
- `src/` contains the static client that renders `planner-data.json`.
- `docs/ARCHITECTURE.md` has a longer walkthrough of the data flow and editing invariants.

## Planner behavior

- The website aggregates all matching project files for the selected day.
- `professional/` and `personnal/` are shown together in the day view.
- The selected day now renders as a time-based agenda with reserved slots for every item.
- The agenda range is built from the earliest and latest dated todo files.
- `todolist/legacy-roadmap.md` is kept only as an archive of the previous single-file setup.

## Editing workflow

1. add or update files inside `todolist/professional/` or `todolist/personnal/`;
2. rebuild automatically via `npm start` or manually via `npm run build`;
3. refresh the planner UI.
