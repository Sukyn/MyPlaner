import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSite,
  createPlannerItem,
  createPlannerProject,
  deletePlannerItem,
  updatePlannerItem
} from "../scripts/planner-data.mjs";

async function createWorkspace(t, extraFiles = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "myplaner-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const baseFiles = {
    "src/index.html": "<!doctype html><title>Planner Test</title>\n",
    "src/app.js": "console.log('planner test');\n",
    "src/styles.css": "body { font-family: sans-serif; }\n",
    "todolist/professional/.gitkeep": "",
    "todolist/personnal/.gitkeep": ""
  };

  for (const [relativePath, contents] of Object.entries({ ...baseFiles, ...extraFiles })) {
    const filepath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(filepath), { recursive: true });
    await writeFile(filepath, contents, "utf8");
  }

  return rootDir;
}

async function pathExists(filepath) {
  try {
    await access(filepath);
    return true;
  } catch {
    return false;
  }
}

test("buildSite aggregates scheduled and recurring items", async (t) => {
  const rootDir = await createWorkspace(t, {
    "todolist/professional/demo/project.json": '{\n  "label": "Demo Project"\n}\n',
    "todolist/professional/demo/2026-04-07.md": `# 2026-04-07

## Events
- 09h00-10h00 Planning sync

## Tasks
- After the 09h00-10h00 Planning sync, write the summary @30m
`,
    "todolist/professional/demo/recurring.json": `{
  "rules": [
    {
      "kind": "event",
      "text": "08h30-09h00 Weekly standup",
      "schedule": {
        "type": "weekly",
        "weekdays": ["Monday"]
      },
      "startDate": "2026-04-06",
      "endDate": "2026-04-06"
    }
  ]
}
`
  });

  const { distDir, plannerData } = await buildSite({ rootDir });

  assert.equal(await pathExists(path.join(distDir, "planner-data.json")), true);
  assert.equal(
    plannerData.projects.find((project) => project.key === "professional/demo")?.projectLabel,
    "Demo Project"
  );

  const workDay = plannerData.days.find((day) => day.date === "2026-04-07");
  assert.ok(workDay);

  const planningSync = workDay.items.find((item) => item.text === "Planning sync");
  assert.ok(planningSync);
  assert.equal(planningSync.agenda.slotLabel, "09:00-10:00");
  assert.equal(planningSync.agenda.scheduleKind, "fixed");

  const followUp = workDay.items.find((item) => item.text.includes("write the summary"));
  assert.ok(followUp);
  assert.equal(followUp.agenda.slotLabel, "10:00-10:30");
  assert.equal(followUp.agenda.scheduleKind, "auto");

  const recurringDay = plannerData.days.find((day) => day.date === "2026-04-06");
  assert.ok(recurringDay);
  assert.ok(
    recurringDay.items.some(
      (item) => item.source === "recurring-rule" && item.text === "Weekly standup"
    )
  );
});

test("createPlannerProject creates the project directory and metadata", async (t) => {
  const rootDir = await createWorkspace(t);

  const project = await createPlannerProject({
    rootDir,
    project: {
      name: "Research Planner 2026",
      category: "personal"
    }
  });

  const projectDir = path.join(rootDir, "todolist", "personnal", "research-planner-2026");
  const metadata = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));

  assert.equal(project.key, "personnal/research-planner-2026");
  assert.equal(project.projectLabel, "Research Planner 2026");
  assert.equal(project.categoryLabel, "Personal");
  assert.equal(metadata.label, "Research Planner 2026");
  assert.equal(await pathExists(path.join(projectDir, ".gitkeep")), true);
});

test("createPlannerItem inserts new sections in canonical order", async (t) => {
  const rootDir = await createWorkspace(t, {
    "todolist/professional/demo/project.json": '{\n  "label": "Demo Project"\n}\n',
    "todolist/professional/demo/2026-04-08.md": `# 2026-04-08

## Tasks
- Write intro @45m
`
  });

  const created = await createPlannerItem({
    rootDir,
    item: {
      projectKey: "professional/demo",
      date: "2026-04-08",
      kind: "deadline",
      text: "Submit abstract"
    }
  });

  const markdown = await readFile(
    path.join(rootDir, "todolist", "professional", "demo", "2026-04-08.md"),
    "utf8"
  );

  assert.equal(created.relativePath, "professional/demo/2026-04-08.md");
  assert.equal(
    markdown,
    `# 2026-04-08

## Tasks
- Write intro @45m

## Deadlines
- Submit abstract
`
  );
});

test("updatePlannerItem updates the correct duplicate daily entry", async (t) => {
  const rootDir = await createWorkspace(t, {
    "todolist/professional/demo/project.json": '{\n  "label": "Demo Project"\n}\n',
    "todolist/professional/demo/2026-04-09.md": `# 2026-04-09

## Tasks
- Write summary
- Write summary
- Send notes
`
  });

  const { plannerData } = await buildSite({ rootDir });
  const day = plannerData.days.find((entry) => entry.date === "2026-04-09");
  const duplicates = day.items.filter((item) => item.text === "Write summary");

  assert.equal(duplicates.length, 2);

  const updated = await updatePlannerItem({
    rootDir,
    sourceInfo: duplicates[1].sourceInfo,
    text: "Review summary @30m"
  });

  const markdown = await readFile(
    path.join(rootDir, "todolist", "professional", "demo", "2026-04-09.md"),
    "utf8"
  );
  const refreshed = await buildSite({ rootDir });
  const refreshedDay = refreshed.plannerData.days.find((entry) => entry.date === "2026-04-09");

  assert.equal(updated.relativePath, "professional/demo/2026-04-09.md");
  assert.equal(
    markdown,
    `# 2026-04-09

## Tasks
- Write summary
- Review summary @30m
- Send notes
`
  );
  assert.ok(refreshedDay.items.some((item) => item.text === "Review summary"));
});

test("updatePlannerItem updates a recurring rule in place", async (t) => {
  const rootDir = await createWorkspace(t, {
    "todolist/professional/demo/project.json": '{\n  "label": "Demo Project"\n}\n',
    "todolist/professional/demo/recurring.json": `{
  "rules": [
    {
      "kind": "event",
      "text": "08h30-09h00 Weekly standup",
      "schedule": {
        "type": "weekly",
        "weekdays": ["Monday"]
      },
      "startDate": "2026-04-06",
      "endDate": "2026-04-06"
    }
  ]
}
`
  });

  const { plannerData } = await buildSite({ rootDir });
  const recurringDay = plannerData.days.find((day) => day.date === "2026-04-06");
  const recurringItem = recurringDay.items.find((item) => item.source === "recurring-rule");

  assert.ok(recurringItem);

  const updated = await updatePlannerItem({
    rootDir,
    sourceInfo: recurringItem.sourceInfo,
    text: "09h00-09h30 Weekly standup"
  });

  const recurringDocument = JSON.parse(
    await readFile(path.join(rootDir, "todolist", "professional", "demo", "recurring.json"), "utf8")
  );
  const refreshed = await buildSite({ rootDir });
  const refreshedDay = refreshed.plannerData.days.find((day) => day.date === "2026-04-06");
  const refreshedItem = refreshedDay.items.find((item) => item.source === "recurring-rule");

  assert.equal(updated.relativePath, "professional/demo/recurring.json");
  assert.equal(recurringDocument.rules[0].text, "09h00-09h30 Weekly standup");
  assert.equal(refreshedItem.text, "Weekly standup");
  assert.equal(refreshedItem.agenda.slotLabel, "09:00-09:30");
});

test("deletePlannerItem removes the correct duplicate daily entry", async (t) => {
  const rootDir = await createWorkspace(t, {
    "todolist/professional/demo/project.json": '{\n  "label": "Demo Project"\n}\n',
    "todolist/professional/demo/2026-04-09.md": `# 2026-04-09

## Tasks
- Write summary
- Write summary
- Send notes
`
  });

  const { plannerData } = await buildSite({ rootDir });
  const day = plannerData.days.find((entry) => entry.date === "2026-04-09");
  const duplicates = day.items.filter((item) => item.text === "Write summary");

  assert.equal(duplicates.length, 2);

  const deleted = await deletePlannerItem({
    rootDir,
    sourceInfo: duplicates[1].sourceInfo
  });

  const markdown = await readFile(
    path.join(rootDir, "todolist", "professional", "demo", "2026-04-09.md"),
    "utf8"
  );

  assert.equal(deleted.deletedFile, false);
  assert.equal(
    markdown,
    `# 2026-04-09

## Tasks
- Write summary
- Send notes
`
  );
});

test("deletePlannerItem removes a recurring rule file when its last rule is deleted", async (t) => {
  const rootDir = await createWorkspace(t, {
    "todolist/professional/demo/project.json": '{\n  "label": "Demo Project"\n}\n',
    "todolist/professional/demo/recurring.json": `{
  "rules": [
    {
      "kind": "cadence",
      "text": "Review roadmap",
      "schedule": {
        "type": "monthly",
        "days": [10]
      },
      "startDate": "2026-04-10",
      "endDate": "2026-04-10"
    }
  ]
}
`
  });

  const { plannerData } = await buildSite({ rootDir });
  const recurringDay = plannerData.days.find((day) => day.date === "2026-04-10");
  const recurringItem = recurringDay.items.find((item) => item.source === "recurring-rule");

  assert.ok(recurringItem);

  const deleted = await deletePlannerItem({
    rootDir,
    sourceInfo: recurringItem.sourceInfo
  });

  assert.equal(deleted.deletedFile, true);
  assert.equal(
    await pathExists(path.join(rootDir, "todolist", "professional", "demo", "recurring.json")),
    false
  );
});