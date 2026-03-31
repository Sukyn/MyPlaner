# Todo Layout

Put every dated todo file in one of these two folders:

- `professional/<project>/YYYY-MM-DD.md`
- `personnal/<project>/YYYY-MM-DD.md`

Example:

```md
# 2026-04-02

## Tasks
- 09h00 @90m Write the outline
- 45-60 minutes of Japanese revision

## Events
- 15h00 seminar
```

Supported sections:

- `Tasks`
- `Cadence`
- `Deadlines`
- `Milestones`
- `Events`

Use `Tasks` for concrete deliverables such as `Write the introduction`.
Use `Events` for lessons, travel, seminars, conferences, and other blocking commitments instead of repeating them as tasks.

Scheduling hints the planner understands:

- leading slot: `09h00-10h30 Write the outline`
- timed start with estimate: `09h00 @45m Inbox cleanup`
- leading duration estimate: `45-60 minutes of Japanese revision`
- relative windows: `After the 08h00-10h00 teaching slot, write the introduction paragraph.`

Items without a fixed slot are now auto-placed into reserved agenda blocks for the day view, so every task gets a concrete time window.

You can also add `recurring.json` inside a project folder for generated reminders. Example:

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
