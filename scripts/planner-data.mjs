import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

const WEEKDAY_ALIASES = {
  sunday: 0,
  sun: 0,
  dimanche: 0,
  dim: 0,
  monday: 1,
  mon: 1,
  lundi: 1,
  lun: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  mardi: 2,
  mar: 2,
  wednesday: 3,
  wed: 3,
  mercredi: 3,
  mer: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  jeudi: 4,
  jeu: 4,
  friday: 5,
  fri: 5,
  vendredi: 5,
  ven: 5,
  saturday: 6,
  sat: 6,
  samedi: 6,
  sam: 6
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECURRING_HORIZON_MONTHS = 12;

const CATEGORY_LABELS = {
  professional: "Professional",
  personnal: "Personal"
};

const PROJECT_LABELS = {
  "fscd-2026": "FSCD 2026",
  "general-planning": "General planning",
  "les-chevaliers-du-quantique": "Les Chevaliers du Quantique",
  "lics-2026": "LICS 2026",
  "liqcs-2026": "LIQCS 2026",
  "qpl-2026": "QPL 2026",
  "talks-and-presentations": "Talks and presentations",
  "teaching-and-admin": "Teaching and admin",
  "tqc-2027-paper": "TQC 2027 paper",
  "travel-and-events": "Travel and events",
  japanese: "Japanese",
  "life-and-trips": "Life and trips"
};

const KIND_ALIASES = {
  task: "task",
  tasks: "task",
  todo: "task",
  todos: "task",
  note: "task",
  notes: "task",
  cadence: "cadence",
  recurring: "cadence",
  routine: "cadence",
  routines: "cadence",
  deadline: "deadline",
  deadlines: "deadline",
  milestone: "milestone",
  milestones: "milestone",
  event: "event",
  events: "event"
};

const PROJECT_METADATA_FILENAME = "project.json";
const GITKEEP_FILENAME = ".gitkeep";

const KIND_SECTION_TITLES = {
  task: "Tasks",
  cadence: "Cadence",
  deadline: "Deadlines",
  milestone: "Milestones",
  event: "Events"
};

const KIND_SECTION_ORDER = ["task", "cadence", "deadline", "milestone", "event"];

const DEFAULT_SLOT_START_MINUTE = 8 * 60;
const DEFAULT_SLOT_END_MINUTE = 21 * 60;
const MIN_SLOT_MINUTES = 15;

const DEFAULT_ESTIMATE_MINUTES = {
  task: 60,
  cadence: 45,
  deadline: 30,
  event: 60,
  milestone: 45
};

const WINDOW_HINTS = {
  morning: {
    earliestStartMinute: 8 * 60,
    latestEndMinute: 12 * 60
  },
  afternoon: {
    earliestStartMinute: 13 * 60,
    latestEndMinute: 18 * 60
  },
  evening: {
    earliestStartMinute: 18 * 60,
    latestEndMinute: 22 * 60
  }
};

export async function buildSite({ rootDir = process.cwd() } = {}) {
  const srcDir = path.join(rootDir, "src");
  const distDir = path.join(rootDir, "dist");
  const todoDir = path.join(rootDir, "todolist");
  const plannerData = await parseTodoDirectory({ todoDir });

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(srcDir, distDir, { recursive: true });
  await writeFile(
    path.join(distDir, "planner-data.json"),
    JSON.stringify(plannerData, null, 2),
    "utf8"
  );

  return {
    distDir,
    plannerData
  };
}

export async function deletePlannerItem({ rootDir = process.cwd(), sourceInfo } = {}) {
  const todoDir = path.join(rootDir, "todolist");
  const normalizedSourceInfo = normalizeDeleteSourceInfo(sourceInfo);
  const filepath = resolveTodoChildPath(todoDir, normalizedSourceInfo.relativePath);

  if (normalizedSourceInfo.type === "daily-file") {
    return deleteDailyItemFromFile({ filepath, sourceInfo: normalizedSourceInfo });
  }

  if (normalizedSourceInfo.type === "recurring-rule") {
    return deleteRecurringRuleFromFile({ filepath, sourceInfo: normalizedSourceInfo });
  }

  throw new Error(`Unsupported planner source type "${normalizedSourceInfo.type}".`);
}

export async function createPlannerProject({ rootDir = process.cwd(), project } = {}) {
  const todoDir = path.join(rootDir, "todolist");
  const normalizedProject = normalizeProjectInput(project);
  const categoryDir = path.join(todoDir, normalizedProject.categoryKey);
  const projectKey = slugifyProjectName(normalizedProject.name);

  if (!projectKey) {
    throw new Error("Project names need at least one letter or number.");
  }

  const projectDir = path.join(categoryDir, projectKey);

  if (fileExists(projectDir)) {
    throw new Error(`The project "${normalizedProject.name}" already exists.`);
  }

  await mkdir(categoryDir, { recursive: true });
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, GITKEEP_FILENAME), "", "utf8");
  await writeFile(
    path.join(projectDir, PROJECT_METADATA_FILENAME),
    `${JSON.stringify({ label: normalizedProject.name }, null, 2)}\n`,
    "utf8"
  );

  return {
    key: `${normalizedProject.categoryKey}/${projectKey}`,
    categoryKey: normalizedProject.categoryKey,
    categoryLabel: CATEGORY_LABELS[normalizedProject.categoryKey],
    projectKey,
    projectLabel: normalizedProject.name
  };
}

export async function createPlannerItem({ rootDir = process.cwd(), item } = {}) {
  const todoDir = path.join(rootDir, "todolist");
  const normalizedItem = normalizeNewItemInput(item);
  const projectPath = resolveProjectPath(normalizedItem.projectKey);
  const projectDir = resolveTodoChildPath(todoDir, `${projectPath.categoryKey}/${projectPath.projectKey}`);

  if (!fileExists(projectDir)) {
    throw new Error("The selected project could not be found. Refresh the planner and try again.");
  }

  const filepath = path.join(projectDir, `${normalizedItem.date}.md`);
  const bulletLine = buildNewItemBulletLine(normalizedItem);
  const nextMarkdown = fileExists(filepath)
    ? insertDailyItemIntoMarkdown(await readFile(filepath, "utf8"), {
        date: normalizedItem.date,
        kind: normalizedItem.kind,
        bulletLine
      })
    : createDailyMarkdown(normalizedItem.date, normalizedItem.kind, bulletLine);

  await writeFile(filepath, ensureTrailingNewline(nextMarkdown), "utf8");

  return {
    key: normalizedItem.projectKey,
    date: normalizedItem.date,
    kind: normalizedItem.kind,
    text: normalizedItem.text,
    relativePath: toPortablePath(path.relative(todoDir, filepath))
  };
}

async function parseTodoDirectory({ todoDir }) {
  const now = new Date();
  const currentDate = toIsoDate(now);
  const currentHourMinute = Math.max(
    DEFAULT_SLOT_START_MINUTE,
    getStartOfCurrentHourMinute(now)
  );
  const projectEntries = await loadProjects(todoDir);
  const dates = projectEntries.flatMap((project) => project.days.map((day) => day.date));
  const range = findOverallRange(dates, currentDate, projectEntries);
  const daysMap = new Map();
  let itemSequence = 0;

  for (const date of eachDate(range.start, range.end)) {
    daysMap.set(date, createEmptyDay(date));
  }

  for (const project of projectEntries) {
    for (const dayEntry of project.days) {
      const day = daysMap.get(dayEntry.date);
      if (!day) {
        continue;
      }

      for (const item of dayEntry.items) {
        day.items.push({
          ...item,
          order: itemSequence++,
          source: "daily-file",
          sourceInfo: buildClientSourceInfo(todoDir, dayEntry.filepath, item.sourceInfo, "daily-file"),
          categoryKey: project.categoryKey,
          categoryLabel: project.categoryLabel,
          projectKey: project.projectKey,
          projectLabel: project.projectLabel,
          contextLabel: project.projectLabel
        });
      }
    }

    for (const rule of project.recurringRules) {
      const ruleStart = rule.startDate ?? range.start;
      const ruleEnd = rule.endDate ?? range.end;

      for (const date of eachDate(ruleStart, ruleEnd)) {
        if (!matchesRecurringRule(rule, date)) {
          continue;
        }

        const day = daysMap.get(date);
        if (!day) {
          continue;
        }

        day.items.push({
          kind: rule.kind,
          text: rule.text,
          timing: rule.timing,
          order: itemSequence++,
          source: "recurring-rule",
          sourceInfo: buildClientSourceInfo(
            todoDir,
            rule.sourceInfo.filepath,
            {
              ruleIndex: rule.sourceInfo.ruleIndex,
              fingerprint: rule.sourceInfo.fingerprint
            },
            "recurring-rule"
          ),
          categoryKey: project.categoryKey,
          categoryLabel: project.categoryLabel,
          projectKey: project.projectKey,
          projectLabel: project.projectLabel,
          contextLabel: project.projectLabel
        });
      }
    }
  }

  const days = Array.from(daysMap.values()).map((day) => {
    day.items.sort(sortItems);

    const scheduledDay = scheduleDayItems(day.items, {
      date: day.date,
      currentDate,
      autoStartFloorMinute: currentHourMinute
    });

    return {
      ...day,
      items: scheduledDay.items,
      agenda: scheduledDay.agenda,
      counts: countItemsByKind(scheduledDay.items)
    };
  });

  const projects = summarizeProjects(projectEntries, days);
  const categories = summarizeCategories(projects);
  const months = summarizeMonths(days);
  const totals = summarizeTotals(days, categories, projects);

  return {
    meta: {
      title: "My Planner",
      currentDate,
      startDate: range.start,
      endDate: range.end,
      generatedAt: new Date().toISOString()
    },
    overview: {
      focusProjects: summarizeFocusProjects(days, currentDate)
    },
    categories,
    projects,
    months,
    totals,
    days
  };
}

async function loadProjects(todoDir) {
  const projects = [];

  for (const [categoryKey, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
    const categoryDir = path.join(todoDir, categoryKey);
    const categoryEntries = await safeReadDir(categoryDir);

    for (const entry of categoryEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const projectKey = entry.name;
      const projectDir = path.join(categoryDir, projectKey);
      const projectMetadata = await loadProjectMetadata(projectDir, projectKey);
      const projectLabel = projectMetadata.label;
      const projectFiles = await safeReadDir(projectDir);
      const recurringRules = await loadRecurringRules(projectDir);
      const days = [];

      for (const file of projectFiles) {
        if (!file.isFile()) {
          continue;
        }

        const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
        if (!match) {
          continue;
        }

        const filepath = path.join(projectDir, file.name);
        const markdown = await readFile(filepath, "utf8");

        days.push({
          date: match[1],
          filepath,
          items: parseDailyTodoFile(markdown)
        });
      }

      days.sort((left, right) => left.date.localeCompare(right.date));

      projects.push({
        categoryKey,
        categoryLabel,
        projectKey,
        projectLabel,
        days,
        recurringRules
      });
    }
  }

  return projects.sort(compareProjects);
}

async function loadProjectMetadata(projectDir, projectKey) {
  const fallbackLabel = PROJECT_LABELS[projectKey] ?? titleizeSegment(projectKey);
  const filepath = path.join(projectDir, PROJECT_METADATA_FILENAME);

  if (!fileExists(filepath)) {
    return {
      label: fallbackLabel
    };
  }

  let parsed;

  try {
    parsed = JSON.parse(await readFile(filepath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${filepath}: ${error.message}`);
  }

  return {
    label: String(parsed?.label ?? parsed?.name ?? "").trim() || fallbackLabel
  };
}

async function loadRecurringRules(projectDir) {
  const filepath = path.join(projectDir, "recurring.json");
  if (!fileExists(filepath)) {
    return [];
  }

  let parsed;

  try {
    parsed = JSON.parse(await readFile(filepath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${filepath}: ${error.message}`);
  }

  const rawRules = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(rawRules)) {
    throw new Error(`Expected ${filepath} to contain a JSON array or a "rules" array.`);
  }

  return rawRules.map((rule, index) => normalizeRecurringRule(rule, { filepath, index }));
}

function normalizeRecurringRule(rule, { filepath, index }) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error(`Recurring rule #${index + 1} in ${filepath} must be an object.`);
  }

  const text = String(rule.text ?? "").trim();
  if (!text) {
    throw new Error(`Recurring rule #${index + 1} in ${filepath} needs a non-empty "text".`);
  }

  const kind = rule.kind ? normalizeKindLabel(String(rule.kind)) : "cadence";
  if (!kind) {
    throw new Error(`Recurring rule #${index + 1} in ${filepath} uses an unsupported "kind".`);
  }

  const parsedItem = parseItemText(text, kind);

  const normalizedRule = {
    kind,
    text: parsedItem.text,
    timing: parsedItem.timing,
    schedule: normalizeRecurringSchedule(rule.schedule, { filepath, index }),
    startDate: validateOptionalIsoDate(rule.startDate, "startDate", { filepath, index }),
    endDate: validateOptionalIsoDate(rule.endDate, "endDate", { filepath, index })
  };

  return {
    ...normalizedRule,
    sourceInfo: {
      filepath,
      ruleIndex: index,
      fingerprint: createRecurringRuleFingerprint(normalizedRule)
    }
  };
}

function normalizeRecurringSchedule(schedule, context) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new Error(`Recurring rule #${context.index + 1} in ${context.filepath} needs a "schedule" object.`);
  }

  const type = String(schedule.type ?? "").trim().toLowerCase();

  switch (type) {
    case "monthly":
      return normalizeMonthlySchedule(schedule, context);
    case "weekly":
      return normalizeWeeklySchedule(schedule, context);
    default:
      throw new Error(
        `Recurring rule #${context.index + 1} in ${context.filepath} uses unsupported schedule type "${type}".`
      );
  }
}

function normalizeMonthlySchedule(schedule, { filepath, index }) {
  const rawDays = Array.isArray(schedule.days) ? schedule.days : [];
  const days = [...new Set(rawDays.map((value) => Number(value)).filter(Number.isInteger))].sort(
    (left, right) => left - right
  );

  if (!days.length || days.some((day) => day < 1 || day > 31)) {
    throw new Error(
      `Recurring rule #${index + 1} in ${filepath} needs a "schedule.days" array with values from 1 to 31.`
    );
  }

  return {
    type: "monthly",
    days,
    lastDayFallback: Boolean(schedule.lastDayFallback)
  };
}

function normalizeWeeklySchedule(schedule, { filepath, index }) {
  const rawWeekdays = Array.isArray(schedule.weekdays)
    ? schedule.weekdays
    : Array.isArray(schedule.days)
      ? schedule.days
      : schedule.day == null
        ? []
        : [schedule.day];

  const weekdays = [...new Set(rawWeekdays.map(normalizeWeekdayValue).filter(Number.isInteger))].sort(
    (left, right) => left - right
  );

  if (!weekdays.length) {
    throw new Error(
      `Recurring rule #${index + 1} in ${filepath} needs a weekly day in "schedule.weekdays".`
    );
  }

  return {
    type: "weekly",
    weekdays
  };
}

function normalizeWeekdayValue(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (Object.hasOwn(WEEKDAY_ALIASES, normalized)) {
    return WEEKDAY_ALIASES[normalized];
  }

  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) {
    return numeric;
  }

  return null;
}

function validateOptionalIsoDate(value, fieldName, { filepath, index }) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(
      `Recurring rule #${index + 1} in ${filepath} has an invalid "${fieldName}" date: ${normalized}.`
    );
  }

  return normalized;
}

function parseDailyTodoFile(markdown) {
  const items = [];
  const lines = markdown.split(/\r?\n/);
  let currentKind = "task";

  for (const [lineIndex, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const normalized = normalizeKindLabel(headingMatch[1]);
      if (normalized) {
        currentKind = normalized;
      }
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(?:\[(?: |x|X)\]\s+)?(.+)$/);
    if (!bulletMatch) {
      continue;
    }

    let text = bulletMatch[1].trim();
    let kind = currentKind;
    const prefixedKind = extractPrefixedKind(text);

    if (prefixedKind) {
      kind = prefixedKind.kind;
      text = prefixedKind.text;
    }

    if (!text) {
      continue;
    }

    const parsedItem = parseItemText(text, kind);

    items.push({
      ...parsedItem,
      sourceInfo: {
        lineNumber: lineIndex + 1,
        itemIndex: items.length,
        fingerprint: createDailyItemFingerprint(parsedItem)
      }
    });
  }

  return items;
}

function parseItemText(text, kind) {
  let normalizedText = text.trim();
  let estimateMinutes = null;
  let estimateSource = null;

  const taggedDuration = extractTaggedDuration(normalizedText);
  if (taggedDuration) {
    normalizedText = taggedDuration.text;
    estimateMinutes = taggedDuration.minutes;
    estimateSource = "tag";
  }

  const explicitSlot = extractLeadingTimeSlot(normalizedText) ?? extractInlineTimeRange(normalizedText);
  if (explicitSlot?.stripText) {
    normalizedText = explicitSlot.text;
  }

  if (estimateMinutes == null) {
    const durationHint = extractDurationHint(normalizedText);
    if (durationHint) {
      estimateMinutes = durationHint.minutes;
      estimateSource = durationHint.source;
    }
  }

  const relativeWindow = extractRelativeWindow(normalizedText);
  const windowHint = extractWindowHint(normalizedText);
  const sequenceHint = extractSequenceHint(normalizedText);
  const timing = buildTimingMetadata({
    kind,
    explicitSlot,
    relativeWindow,
    windowHint,
    sequenceHint,
    estimateMinutes,
    estimateSource
  });

  return {
    kind,
    text: normalizedText.replace(/\s{2,}/g, " ").trim(),
    timing
  };
}

function extractPrefixedKind(text) {
  const match = text.match(
    /^\[(task|tasks|todo|todos|note|notes|cadence|recurring|routine|routines|deadline|deadlines|milestone|milestones|event|events)\]\s*(.+)$/i
  );

  if (!match) {
    return null;
  }

  return {
    kind: normalizeKindLabel(match[1]),
    text: match[2].trim()
  };
}

function normalizeKindLabel(value) {
  return KIND_ALIASES[value.trim().toLowerCase()] ?? null;
}

function createDailyItemFingerprint(item) {
  return JSON.stringify({
    kind: item.kind,
    text: item.text,
    timing: item.timing
  });
}

function createRecurringRuleFingerprint(rule) {
  return JSON.stringify({
    kind: rule.kind,
    text: rule.text,
    timing: rule.timing,
    schedule: rule.schedule,
    startDate: rule.startDate,
    endDate: rule.endDate
  });
}

function buildClientSourceInfo(todoDir, filepath, sourceInfo, type) {
  return {
    type,
    relativePath: toPortablePath(path.relative(todoDir, filepath)),
    ...sourceInfo
  };
}

function normalizeProjectInput(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("Project creation needs a name and category.");
  }

  const name = String(project.name ?? "").trim();
  if (!name) {
    throw new Error("Project creation needs a non-empty name.");
  }

  const categoryKey = normalizeProjectCategoryKey(project.categoryKey ?? project.category);

  return {
    name,
    categoryKey
  };
}

function normalizeNewItemInput(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Item creation needs a day, project, kind, and title.");
  }

  const projectKey = String(item.projectKey ?? "").trim();
  if (!projectKey) {
    throw new Error("Choose a project before adding an item.");
  }

  const date = String(item.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Choose a valid day for the new item.");
  }

  const kind = normalizeKindLabel(String(item.kind ?? ""));
  if (!kind) {
    throw new Error("Choose a valid kind for the new item.");
  }

  const text = String(item.text ?? item.title ?? "").trim().replace(/\s{2,}/g, " ");
  if (!text) {
    throw new Error("New items need a title.");
  }

  const startMinute = parseOptionalTimeInput(item.startTime);
  const endMinute = parseOptionalTimeInput(item.endTime);

  if (endMinute != null && startMinute == null) {
    throw new Error("An end time needs a start time.");
  }

  if (startMinute != null && endMinute != null && endMinute <= startMinute) {
    throw new Error("The end time must be later than the start time.");
  }

  const estimateMinutes = parseOptionalEstimateMinutes(item.estimateMinutes);

  return {
    projectKey,
    date,
    kind,
    text,
    startMinute,
    endMinute,
    estimateMinutes: kind === "event" ? null : estimateMinutes
  };
}

function normalizeProjectCategoryKey(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "personal") {
    return "personnal";
  }

  if (Object.hasOwn(CATEGORY_LABELS, normalized)) {
    return normalized;
  }

  throw new Error(`Unsupported project category "${value}".`);
}

function resolveProjectPath(value) {
  const normalized = toPortablePath(String(value ?? "").trim());
  const [categoryKey, projectKey, ...rest] = normalized.split("/");

  if (rest.length || !categoryKey || !projectKey) {
    throw new Error("Projects must use the form category/project.");
  }

  return {
    categoryKey: normalizeProjectCategoryKey(categoryKey),
    projectKey
  };
}

function parseOptionalTimeInput(value) {
  if (value == null || value === "") {
    return null;
  }

  const minute = parseClockToken(String(value).trim());

  if (minute == null) {
    throw new Error(`Invalid time value "${value}".`);
  }

  return minute;
}

function parseOptionalEstimateMinutes(value) {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Task length must be a positive number of minutes.");
  }

  return normalizeDurationMinutes(numeric);
}

function buildNewItemBulletLine(item) {
  const title = item.text;

  if (item.startMinute != null && item.endMinute != null) {
    return `${formatTodoClockMinute(item.startMinute)}-${formatTodoClockMinute(item.endMinute)} ${title}`;
  }

  if (item.startMinute != null) {
    if (item.estimateMinutes != null) {
      return `${formatTodoClockMinute(item.startMinute)} ${title} @${formatTodoDurationToken(item.estimateMinutes)}`;
    }

    return `${formatTodoClockMinute(item.startMinute)} ${title}`;
  }

  if (item.estimateMinutes != null) {
    return `${title} @${formatTodoDurationToken(item.estimateMinutes)}`;
  }

  return title;
}

function createDailyMarkdown(date, kind, bulletLine) {
  return [`# ${date}`, "", `## ${KIND_SECTION_TITLES[kind]}`, `- ${bulletLine}`].join("\n");
}

function insertDailyItemIntoMarkdown(markdown, { date, kind, bulletLine }) {
  const lines = markdown ? markdown.split(/\r?\n/) : [];
  const workingLines = normalizeMarkdownLines(lines);

  if (!workingLines.length) {
    return createDailyMarkdown(date, kind, bulletLine);
  }

  if (!workingLines.some((line) => /^\s*#\s+\d{4}-\d{2}-\d{2}\s*$/.test(line))) {
    workingLines.unshift(`# ${date}`, "");
  }

  const sectionIndex = workingLines.findIndex((line) => isSectionHeadingForKind(line, kind));

  if (sectionIndex >= 0) {
    const insertIndex = findSectionInsertIndex(workingLines, sectionIndex);
    workingLines.splice(insertIndex, 0, `- ${bulletLine}`);
    return normalizeMarkdownLines(workingLines).join("\n");
  }

  const nextSectionIndex = findSectionPlacementIndex(workingLines, kind);
  const block = [`## ${KIND_SECTION_TITLES[kind]}`, `- ${bulletLine}`];

  if (nextSectionIndex === -1) {
    if (workingLines[workingLines.length - 1]?.trim() !== "") {
      workingLines.push("");
    }

    workingLines.push(...block);
    return normalizeMarkdownLines(workingLines).join("\n");
  }

  const sectionBlock = [...block, ""];
  workingLines.splice(nextSectionIndex, 0, ...sectionBlock);
  return normalizeMarkdownLines(workingLines).join("\n");
}

function isSectionHeadingForKind(line, kind) {
  const match = String(line ?? "").trim().match(/^#{2,6}\s+(.+)$/);
  return match ? normalizeKindLabel(match[1]) === kind : false;
}

function findSectionInsertIndex(lines, sectionIndex) {
  let cursor = sectionIndex + 1;

  while (cursor < lines.length && !isHeadingLine(lines[cursor])) {
    cursor += 1;
  }

  while (cursor > sectionIndex + 1 && lines[cursor - 1]?.trim() === "") {
    cursor -= 1;
  }

  return cursor;
}

function findSectionPlacementIndex(lines, kind) {
  const targetOrder = KIND_SECTION_ORDER.indexOf(kind);

  for (let index = 0; index < lines.length; index += 1) {
    const match = String(lines[index] ?? "").trim().match(/^#{2,6}\s+(.+)$/);
    if (!match) {
      continue;
    }

    const currentKind = normalizeKindLabel(match[1]);
    if (!currentKind) {
      continue;
    }

    if (KIND_SECTION_ORDER.indexOf(currentKind) > targetOrder) {
      return index;
    }
  }

  return -1;
}

function normalizeDeleteSourceInfo(sourceInfo) {
  if (!sourceInfo || typeof sourceInfo !== "object" || Array.isArray(sourceInfo)) {
    throw new Error("Delete request missing item source info.");
  }

  const type = String(sourceInfo.type ?? "").trim();
  const relativePath = toPortablePath(String(sourceInfo.relativePath ?? "").trim());
  const fingerprint = String(sourceInfo.fingerprint ?? "").trim();

  if (!type) {
    throw new Error("Delete request is missing the source type.");
  }

  if (!relativePath) {
    throw new Error("Delete request is missing the source file path.");
  }

  if (!fingerprint) {
    throw new Error("Delete request is missing the item fingerprint.");
  }

  if (type === "daily-file") {
    return {
      type,
      relativePath,
      fingerprint,
      lineNumber: Number.isInteger(sourceInfo.lineNumber) ? sourceInfo.lineNumber : null,
      itemIndex: Number.isInteger(sourceInfo.itemIndex) ? sourceInfo.itemIndex : null
    };
  }

  if (type === "recurring-rule") {
    return {
      type,
      relativePath,
      fingerprint,
      ruleIndex: Number.isInteger(sourceInfo.ruleIndex) ? sourceInfo.ruleIndex : null
    };
  }

  throw new Error(`Delete request uses an unsupported source type "${type}".`);
}

function resolveTodoChildPath(todoDir, relativePath) {
  const resolvedTodoDir = path.resolve(todoDir);
  const candidate = path.resolve(resolvedTodoDir, relativePath);

  if (candidate !== resolvedTodoDir && !candidate.startsWith(`${resolvedTodoDir}${path.sep}`)) {
    throw new Error("Delete request uses an invalid todo path.");
  }

  return candidate;
}

async function deleteDailyItemFromFile({ filepath, sourceInfo }) {
  if (path.extname(filepath).toLowerCase() !== ".md") {
    throw new Error(`Expected a markdown todo file for ${sourceInfo.relativePath}.`);
  }

  if (!fileExists(filepath)) {
    throw new Error(`Could not find ${sourceInfo.relativePath}. Refresh the planner and try again.`);
  }

  const markdown = await readFile(filepath, "utf8");
  const parsedItems = parseDailyTodoFile(markdown);
  const matchIndex = findDailyItemMatchIndex(parsedItems, sourceInfo);

  if (matchIndex === -1) {
    throw new Error(`Could not locate the requested item in ${sourceInfo.relativePath}. Refresh the planner and try again.`);
  }

  const targetLineNumber = parsedItems[matchIndex].sourceInfo.lineNumber;
  const lines = markdown.split(/\r?\n/);
  lines.splice(targetLineNumber - 1, 1);

  const cleanedMarkdown = cleanupDailyTodoMarkdown(lines);

  if (!parseDailyTodoFile(cleanedMarkdown).length) {
    await rm(filepath, { force: true });
    return {
      deletedFile: true,
      relativePath: sourceInfo.relativePath
    };
  }

  await writeFile(filepath, ensureTrailingNewline(cleanedMarkdown), "utf8");

  return {
    deletedFile: false,
    relativePath: sourceInfo.relativePath
  };
}

async function deleteRecurringRuleFromFile({ filepath, sourceInfo }) {
  if (path.extname(filepath).toLowerCase() !== ".json") {
    throw new Error(`Expected a recurring JSON file for ${sourceInfo.relativePath}.`);
  }

  if (!fileExists(filepath)) {
    throw new Error(`Could not find ${sourceInfo.relativePath}. Refresh the planner and try again.`);
  }

  let parsed;

  try {
    parsed = JSON.parse(await readFile(filepath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${sourceInfo.relativePath}: ${error.message}`);
  }

  const rawRules = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(rawRules)) {
    throw new Error(`Expected ${sourceInfo.relativePath} to contain a JSON array or a "rules" array.`);
  }

  const normalizedRules = rawRules.map((rule, index) => normalizeRecurringRule(rule, { filepath, index }));
  const matchIndex = findRecurringRuleMatchIndex(normalizedRules, sourceInfo);

  if (matchIndex === -1) {
    throw new Error(`Could not locate the requested recurring rule in ${sourceInfo.relativePath}. Refresh the planner and try again.`);
  }

  const nextRules = rawRules.filter((_rule, index) => index !== matchIndex);

  if (!nextRules.length) {
    await rm(filepath, { force: true });
    return {
      deletedFile: true,
      relativePath: sourceInfo.relativePath
    };
  }

  const nextDocument = Array.isArray(parsed) ? nextRules : { ...parsed, rules: nextRules };
  await writeFile(filepath, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");

  return {
    deletedFile: false,
    relativePath: sourceInfo.relativePath
  };
}

function findDailyItemMatchIndex(items, sourceInfo) {
  const candidates = items
    .map((item, index) => ({
      item,
      index
    }))
    .filter(({ item }) => item.sourceInfo?.fingerprint === sourceInfo.fingerprint);

  if (!candidates.length) {
    return -1;
  }

  if (sourceInfo.lineNumber != null) {
    const lineMatch = candidates.find(({ item }) => item.sourceInfo?.lineNumber === sourceInfo.lineNumber);
    if (lineMatch) {
      return lineMatch.index;
    }
  }

  if (sourceInfo.itemIndex != null) {
    const itemIndexMatch = candidates.find(({ item }) => item.sourceInfo?.itemIndex === sourceInfo.itemIndex);
    if (itemIndexMatch) {
      return itemIndexMatch.index;
    }
  }

  return candidates[0].index;
}

function findRecurringRuleMatchIndex(rules, sourceInfo) {
  const candidates = rules
    .map((rule, index) => ({
      rule,
      index
    }))
    .filter(({ rule }) => rule.sourceInfo?.fingerprint === sourceInfo.fingerprint);

  if (!candidates.length) {
    return -1;
  }

  if (sourceInfo.ruleIndex != null) {
    const ruleIndexMatch = candidates.find(({ rule }) => rule.sourceInfo?.ruleIndex === sourceInfo.ruleIndex);
    if (ruleIndexMatch) {
      return ruleIndexMatch.index;
    }
  }

  return candidates[0].index;
}

function cleanupDailyTodoMarkdown(input) {
  const lines = Array.isArray(input) ? [...input] : String(input ?? "").split(/\r?\n/);
  const output = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    if (isSectionHeadingLine(line)) {
      const block = [line];
      index += 1;

      while (index < lines.length && !isHeadingLine(lines[index])) {
        block.push(lines[index]);
        index += 1;
      }

      if (block.slice(1).some(isBulletLine)) {
        output.push(...block);
      }

      continue;
    }

    output.push(line);
    index += 1;
  }

  return normalizeMarkdownLines(output).join("\n");
}

function normalizeMarkdownLines(lines) {
  const normalized = [];

  for (const line of lines) {
    const safeLine = typeof line === "string" ? line : String(line ?? "");
    const isBlank = safeLine.trim() === "";

    if (isBlank && (!normalized.length || normalized[normalized.length - 1] === "")) {
      continue;
    }

    normalized.push(isBlank ? "" : safeLine);
  }

  while (normalized.length && normalized[0] === "") {
    normalized.shift();
  }

  while (normalized.length && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }

  return normalized;
}

function isHeadingLine(line) {
  return /^\s*#{1,6}\s+\S/.test(line);
}

function isSectionHeadingLine(line) {
  return /^\s*#{2,6}\s+\S/.test(line);
}

function isBulletLine(line) {
  return /^\s*[-*]\s+(?:\[(?: |x|X)\]\s+)?\S/.test(line);
}

function ensureTrailingNewline(text) {
  return text ? `${text}\n` : "";
}

function toPortablePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function slugifyProjectName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatTodoClockMinute(minute) {
  const safeMinute = normalizeMinute(minute);
  const hours = String(Math.floor(safeMinute / 60)).padStart(2, "0");
  const minutes = String(safeMinute % 60).padStart(2, "0");
  return `${hours}h${minutes}`;
}

function formatTodoDurationToken(minutes) {
  const safeMinutes = normalizeDurationMinutes(minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  if (!hours) {
    return `${remainder}m`;
  }

  if (!remainder) {
    return `${hours}h`;
  }

  return `${hours}h${String(remainder).padStart(2, "0")}`;
}

function buildTimingMetadata({
  kind,
  explicitSlot,
  relativeWindow,
  windowHint,
  sequenceHint,
  estimateMinutes,
  estimateSource
}) {
  let earliestStartMinute = relativeWindow?.earliestStartMinute ?? null;
  let latestEndMinute = relativeWindow?.latestEndMinute ?? null;

  if (windowHint) {
    earliestStartMinute = maxDefinedMinute(earliestStartMinute, windowHint.earliestStartMinute);
    latestEndMinute = minDefinedMinute(latestEndMinute, windowHint.latestEndMinute);
  }

  return {
    explicitStartMinute: explicitSlot?.startMinute ?? null,
    explicitEndMinute: explicitSlot?.endMinute ?? null,
    estimateMinutes: normalizeDurationMinutes(
      explicitSlot?.endMinute != null && explicitSlot.startMinute != null
        ? explicitSlot.endMinute - explicitSlot.startMinute
        : estimateMinutes ?? DEFAULT_ESTIMATE_MINUTES[kind] ?? DEFAULT_ESTIMATE_MINUTES.task
    ),
    earliestStartMinute,
    latestEndMinute,
    followPrevious: Boolean(sequenceHint?.followPrevious),
    explicitTimeSource: explicitSlot?.source ?? null,
    estimateSource:
      explicitSlot?.endMinute != null && explicitSlot.startMinute != null
        ? "explicit-range"
        : estimateSource ?? "default"
  };
}

function createEmptyDay(date) {
  const parsedDate = parseIsoDate(date);

  return {
    date,
    dayNumber: parsedDate.getUTCDate(),
    weekdayIndex: parsedDate.getUTCDay(),
    weekdayShort: WEEKDAY_NAMES[parsedDate.getUTCDay()].slice(0, 3),
    weekdayLong: WEEKDAY_NAMES[parsedDate.getUTCDay()],
    monthKey: date.slice(0, 7),
    monthLabel: `${MONTH_NAMES[parsedDate.getUTCMonth()]} ${parsedDate.getUTCFullYear()}`,
    dateLabel: formatLongDate(date),
    items: [],
    agenda: createEmptyAgendaSummary()
  };
}

function summarizeProjects(projectEntries, days) {
  const projects = new Map(
    projectEntries.map((project) => [
      `${project.categoryKey}/${project.projectKey}`,
      {
        key: `${project.categoryKey}/${project.projectKey}`,
        categoryKey: project.categoryKey,
        categoryLabel: project.categoryLabel,
        projectKey: project.projectKey,
        projectLabel: project.projectLabel,
        activeDays: 0,
        totalItems: 0,
        firstDate: null,
        lastDate: null
      }
    ])
  );

  for (const day of days) {
    const activeProjects = new Set();

    for (const item of day.items) {
      const key = `${item.categoryKey}/${item.projectKey}`;
      const project = projects.get(key);
      if (!project) {
        continue;
      }

      project.totalItems += 1;
      project.firstDate = project.firstDate && project.firstDate < day.date ? project.firstDate : day.date;
      project.lastDate = project.lastDate && project.lastDate > day.date ? project.lastDate : day.date;
      activeProjects.add(key);
    }

    for (const key of activeProjects) {
      const project = projects.get(key);
      project.activeDays += 1;
    }
  }

  return Array.from(projects.values()).sort(compareProjects);
}

function summarizeCategories(projects) {
  const groups = new Map();

  for (const [categoryKey, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
    groups.set(categoryKey, {
      key: categoryKey,
      label: categoryLabel,
      totalItems: 0,
      projectCount: 0,
      activeDays: 0
    });
  }

  for (const project of projects) {
    const category = groups.get(project.categoryKey);
    if (!category) {
      continue;
    }

    category.totalItems += project.totalItems;
    category.projectCount += 1;
    category.activeDays += project.activeDays;
  }

  return Array.from(groups.values());
}

function summarizeFocusProjects(days, currentDate) {
  const boundary = addDaysIso(currentDate, 13);
  const upcoming = days.filter((day) => day.date >= currentDate && day.date <= boundary);
  const groups = new Map();

  for (const day of upcoming) {
    for (const item of day.items) {
      const key = `${item.categoryKey}/${item.projectKey}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          categoryLabel: item.categoryLabel,
          projectLabel: item.projectLabel,
          count: 0,
          nextDate: day.date,
          highlights: []
        });
      }

      const group = groups.get(key);
      group.count += 1;
      if (day.date < group.nextDate) {
        group.nextDate = day.date;
      }
      if (group.highlights.length < 2 && !group.highlights.includes(item.text)) {
        group.highlights.push(item.text);
      }
    }
  }

  return Array.from(groups.values())
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.nextDate.localeCompare(right.nextDate) ||
        left.projectLabel.localeCompare(right.projectLabel)
    )
    .slice(0, 4);
}

function countItemsByKind(items) {
  const counts = {
    task: 0,
    cadence: 0,
    deadline: 0,
    event: 0,
    milestone: 0
  };

  for (const item of items) {
    counts[item.kind] += 1;
  }

  return counts;
}

function sortItems(left, right) {
  const order = {
    deadline: 0,
    milestone: 1,
    task: 2,
    cadence: 3,
    event: 4
  };

  return order[left.kind] - order[right.kind] || left.order - right.order;
}

function scheduleDayItems(
  items,
  {
    date = null,
    currentDate = null,
    autoStartFloorMinute = DEFAULT_SLOT_START_MINUTE
  } = {}
) {
  const scheduledItems = new Map();
  const occupied = [];
  const planningItems = [...items].sort((left, right) => left.order - right.order);
  const effectiveAutoStartFloorMinute =
    date && currentDate && date === currentDate
      ? Math.max(DEFAULT_SLOT_START_MINUTE, normalizeMinute(autoStartFloorMinute))
      : DEFAULT_SLOT_START_MINUTE;
  let cursor = effectiveAutoStartFloorMinute;
  let previousScheduledAgenda = null;

  for (const item of planningItems) {
    if (item.timing?.explicitStartMinute == null) {
      continue;
    }

    const durationMinutes = getPlannedDuration(item);
    const startMinute = item.timing.explicitStartMinute;
    const endMinute = item.timing.explicitEndMinute ?? startMinute + durationMinutes;
    const agenda = buildAgendaEntry(item, startMinute, endMinute, item.timing.explicitEndMinute != null ? "fixed" : "anchored");

    scheduledItems.set(item.order, agenda);
    occupied.push({
      key: item.order,
      startMinute,
      endMinute
    });
  }

  occupied.sort(compareOccupiedSlots);

  for (const item of planningItems) {
    if (scheduledItems.has(item.order)) {
      previousScheduledAgenda = scheduledItems.get(item.order);
      continue;
    }

    const durationMinutes = getPlannedDuration(item);
    const agenda = placeFlexibleAgendaEntry(
      item,
      durationMinutes,
      occupied,
      cursor,
      previousScheduledAgenda,
      effectiveAutoStartFloorMinute
    );

    scheduledItems.set(item.order, agenda);
    occupied.push({
      key: item.order,
      startMinute: agenda.startMinute,
      endMinute: agenda.endMinute
    });
    occupied.sort(compareOccupiedSlots);
    cursor = Math.max(cursor, agenda.endMinute);
    previousScheduledAgenda = agenda;
  }

  const itemsWithAgenda = items.map((item) => ({
    ...item,
    agenda: scheduledItems.get(item.order)
  }));

  applyAgendaLanes(itemsWithAgenda);

  return {
    items: itemsWithAgenda,
    agenda: summarizeDayAgenda(itemsWithAgenda)
  };
}

function placeFlexibleAgendaEntry(
  item,
  durationMinutes,
  occupied,
  cursor,
  previousScheduledAgenda,
  autoStartFloorMinute = DEFAULT_SLOT_START_MINUTE
) {
  const earliestStartMinute = Math.max(
    item.timing?.earliestStartMinute ?? DEFAULT_SLOT_START_MINUTE,
    autoStartFloorMinute,
    DEFAULT_SLOT_START_MINUTE
  );
  const latestEndMinute = item.timing?.latestEndMinute ?? null;
  let preferredStartMinute = Math.max(cursor, earliestStartMinute);

  if (item.timing?.followPrevious && previousScheduledAgenda) {
    preferredStartMinute = Math.max(preferredStartMinute, previousScheduledAgenda.endMinute);
  }

  if (latestEndMinute != null && preferredStartMinute + durationMinutes > latestEndMinute) {
    preferredStartMinute = earliestStartMinute;
  }

  let slot = findOpenSlot({
    occupied,
    startMinute: preferredStartMinute,
    durationMinutes,
    latestEndMinute
  });

  if (!slot && latestEndMinute != null && preferredStartMinute !== earliestStartMinute) {
    slot = findOpenSlot({
      occupied,
      startMinute: earliestStartMinute,
      durationMinutes,
      latestEndMinute
    });
  }

  if (!slot) {
    slot = findOpenSlot({
      occupied,
      startMinute: Math.max(cursor, earliestStartMinute),
      durationMinutes
    });
  }

  return buildAgendaEntry(item, slot.startMinute, slot.endMinute, "auto");
}

function findOpenSlot({ occupied, startMinute, durationMinutes, latestEndMinute = null }) {
  let candidateMinute = startMinute;

  while (true) {
    if (latestEndMinute != null && candidateMinute + durationMinutes > latestEndMinute) {
      return null;
    }

    let conflict = null;

    for (const slot of occupied) {
      if (slot.endMinute <= candidateMinute) {
        continue;
      }

      if (slot.startMinute >= candidateMinute + durationMinutes) {
        break;
      }

      conflict = slot;
      break;
    }

    if (!conflict) {
      return {
        startMinute: candidateMinute,
        endMinute: candidateMinute + durationMinutes
      };
    }

    candidateMinute = conflict.endMinute;
  }
}

function buildAgendaEntry(item, startMinute, endMinute, scheduleKind) {
  const safeStartMinute = normalizeMinute(startMinute);
  const minimumDuration = scheduleKind === "fixed" ? 1 : MIN_SLOT_MINUTES;
  const safeEndMinute = normalizeMinute(Math.max(endMinute, safeStartMinute + minimumDuration));
  const durationMinutes = safeEndMinute - safeStartMinute;

  return {
    startMinute: safeStartMinute,
    endMinute: safeEndMinute,
    durationMinutes,
    slotLabel: `${formatClockMinute(safeStartMinute)}-${formatClockMinute(safeEndMinute)}`,
    durationLabel: formatDurationMinutes(durationMinutes),
    scheduleKind,
    lane: 0,
    laneCount: 1
  };
}

function applyAgendaLanes(items) {
  const scheduledItems = [...items]
    .filter((item) => item.agenda)
    .sort(compareAgendaItems);

  let cluster = [];
  let clusterEndMinute = -1;

  for (const item of scheduledItems) {
    if (!cluster.length || item.agenda.startMinute < clusterEndMinute) {
      cluster.push(item);
      clusterEndMinute = Math.max(clusterEndMinute, item.agenda.endMinute);
      continue;
    }

    finalizeAgendaCluster(cluster);
    cluster = [item];
    clusterEndMinute = item.agenda.endMinute;
  }

  finalizeAgendaCluster(cluster);
}

function finalizeAgendaCluster(cluster) {
  if (!cluster.length) {
    return;
  }

  const laneEndMinutes = [];
  const assignments = [];

  for (const item of cluster) {
    let lane = laneEndMinutes.findIndex((endMinute) => endMinute <= item.agenda.startMinute);
    if (lane === -1) {
      lane = laneEndMinutes.length;
      laneEndMinutes.push(item.agenda.endMinute);
    } else {
      laneEndMinutes[lane] = item.agenda.endMinute;
    }

    assignments.push({
      item,
      lane
    });
  }

  const laneCount = laneEndMinutes.length || 1;

  for (const assignment of assignments) {
    assignment.item.agenda.lane = assignment.lane;
    assignment.item.agenda.laneCount = laneCount;
  }
}

function summarizeDayAgenda(items) {
  const agendaItems = items.filter((item) => item.agenda);

  if (!agendaItems.length) {
    return createEmptyAgendaSummary();
  }

  const firstStartMinute = Math.min(...agendaItems.map((item) => item.agenda.startMinute));
  const lastEndMinute = Math.max(...agendaItems.map((item) => item.agenda.endMinute));
  const windowStartMinute = Math.max(0, Math.floor(firstStartMinute / 60) * 60);
  const windowEndMinute = Math.min(24 * 60, Math.ceil(lastEndMinute / 60) * 60);
  const totalReservedMinutes = agendaItems.reduce(
    (sum, item) => sum + item.agenda.durationMinutes,
    0
  );

  return {
    firstStartMinute,
    lastEndMinute,
    windowStartMinute,
    windowEndMinute: Math.max(windowEndMinute, windowStartMinute + 60),
    totalReservedMinutes,
    windowLabel: `${formatClockMinute(firstStartMinute)}-${formatClockMinute(lastEndMinute)}`,
    autoScheduledCount: agendaItems.filter((item) => item.agenda.scheduleKind === "auto").length
  };
}

function createEmptyAgendaSummary() {
  return {
    firstStartMinute: null,
    lastEndMinute: null,
    windowStartMinute: DEFAULT_SLOT_START_MINUTE,
    windowEndMinute: DEFAULT_SLOT_END_MINUTE,
    totalReservedMinutes: 0,
    windowLabel: null,
    autoScheduledCount: 0
  };
}

function getPlannedDuration(item) {
  return normalizeDurationMinutes(
    item.timing?.explicitStartMinute != null && item.timing?.explicitEndMinute != null
      ? item.timing.explicitEndMinute - item.timing.explicitStartMinute
      : item.timing?.estimateMinutes ?? DEFAULT_ESTIMATE_MINUTES[item.kind] ?? DEFAULT_ESTIMATE_MINUTES.task
  );
}

function compareOccupiedSlots(left, right) {
  return left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.key - right.key;
}

function compareAgendaItems(left, right) {
  return (
    left.agenda.startMinute - right.agenda.startMinute ||
    left.agenda.endMinute - right.agenda.endMinute ||
    left.order - right.order
  );
}

function summarizeMonths(days) {
  const months = new Map();

  for (const day of days) {
    if (!months.has(day.monthKey)) {
      months.set(day.monthKey, {
        key: day.monthKey,
        label: day.monthLabel,
        start: day.date,
        end: day.date,
        activeDays: 0,
        totalItems: 0
      });
    }

    const month = months.get(day.monthKey);
    month.end = day.date;
    month.totalItems += day.items.length;

    if (day.items.length > 0) {
      month.activeDays += 1;
    }
  }

  return Array.from(months.values());
}

function summarizeTotals(days, categories, projects) {
  return {
    totalDays: days.length,
    activeDays: days.filter((day) => day.items.length > 0).length,
    totalItems: days.reduce((sum, day) => sum + day.items.length, 0),
    totalDeadlines: days.reduce((sum, day) => sum + day.counts.deadline, 0),
    totalProjects: projects.length,
    totalCategories: categories.filter((category) => category.projectCount > 0).length
  };
}

function compareProjects(left, right) {
  return (
    left.categoryLabel.localeCompare(right.categoryLabel) ||
    left.projectLabel.localeCompare(right.projectLabel)
  );
}

function titleizeSegment(value) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      const upperCased = part.toUpperCase();
      if (/^\d+$/.test(part) || upperCased === part) {
        return upperCased;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function extractTaggedDuration(text) {
  const match = text.match(/\s@((?:\d{1,2}h\d{1,2}|\d{1,2}h|\d{1,3}m))\b/i);
  if (!match) {
    return null;
  }

  return {
    text: text.replace(match[0], " ").replace(/\s{2,}/g, " ").trim(),
    minutes: parseCompactDurationToken(match[1])
  };
}

function extractLeadingTimeSlot(text) {
  const rangeMatch = text.match(
    /^\s*(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2}(?:s\d{0,2})?)?))(?:\s*(?:-|–|—|to)\s*)(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2}(?:s\d{0,2})?)?))\s+(.+)$/i
  );

  if (rangeMatch) {
    return {
      startMinute: parseClockToken(rangeMatch[1]),
      endMinute: parseClockToken(rangeMatch[2]),
      text: rangeMatch[3].trim(),
      source: "leading-range",
      stripText: true
    };
  }

  const singleMatch = text.match(
    /^\s*(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2}(?:s\d{0,2})?)?))\s+(.+)$/i
  );

  if (!singleMatch) {
    return null;
  }

  return {
    startMinute: parseClockToken(singleMatch[1]),
    endMinute: null,
    text: singleMatch[2].trim(),
    source: "leading-start",
    stripText: true
  };
}

function extractInlineTimeRange(text) {
  if (/\b(?:before|after)\b[^.\n]*?\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2})?)/i.test(text)) {
    return null;
  }

  const fromMatch = text.match(
    /\bfrom\s+(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2})?))\s+to\s+(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2})?))/i
  );

  if (fromMatch) {
    return {
      startMinute: parseClockToken(fromMatch[1]),
      endMinute: parseClockToken(fromMatch[2]),
      text,
      source: "inline-range",
      stripText: false
    };
  }

  const rangeMatch = text.match(
    /\b(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2})?))(?:\s*(?:-|–|—|to)\s*)(\d{1,2}(?::\d{2}|h\d{0,2}(?:m\d{0,2})?))\b/i
  );

  if (!rangeMatch) {
    return null;
  }

  return {
    startMinute: parseClockToken(rangeMatch[1]),
    endMinute: parseClockToken(rangeMatch[2]),
    text,
    source: "inline-range",
    stripText: false
  };
}

function extractDurationHint(text) {
  const unitMatch = text.match(/\b(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*(minutes?|mins?|hours?|hrs?)\b/i);
  if (!unitMatch) {
    return null;
  }

  const lowValue = Number(unitMatch[1]);
  const highValue = unitMatch[2] ? Number(unitMatch[2]) : lowValue;
  const unit = unitMatch[3].toLowerCase();
  const minutes =
    unit.startsWith("hour") || unit.startsWith("hr") ? highValue * 60 : highValue;

  return {
    minutes,
    source: "inline-duration"
  };
}

function extractRelativeWindow(text) {
  const beforeWindow = extractRelativeTimeWindow(text, "before");
  if (beforeWindow) {
    return {
      earliestStartMinute: null,
      latestEndMinute: beforeWindow.startMinute
    };
  }

  const afterWindow = extractRelativeTimeWindow(text, "after");
  if (!afterWindow) {
    return null;
  }

  return {
    earliestStartMinute: afterWindow.endMinute ?? afterWindow.startMinute,
    latestEndMinute: null
  };
}

function extractRelativeTimeWindow(text, direction) {
  const rangeFromMatch = text.match(
    new RegExp(
      `\\b${direction}\\b[^.\\n]*?from\\s+(\\d{1,2}(?::\\d{2}|h\\d{0,2}(?:m\\d{0,2})?))\\s+to\\s+(\\d{1,2}(?::\\d{2}|h\\d{0,2}(?:m\\d{0,2})?))`,
      "i"
    )
  );

  if (rangeFromMatch) {
    return {
      startMinute: parseClockToken(rangeFromMatch[1]),
      endMinute: parseClockToken(rangeFromMatch[2])
    };
  }

  const rangeMatch = text.match(
    new RegExp(
      `\\b${direction}\\b[^.\\n]*?(\\d{1,2}(?::\\d{2}|h\\d{0,2}(?:m\\d{0,2})?))(?:\\s*(?:-|–|—|to)\\s*)(\\d{1,2}(?::\\d{2}|h\\d{0,2}(?:m\\d{0,2})?))`,
      "i"
    )
  );

  if (rangeMatch) {
    return {
      startMinute: parseClockToken(rangeMatch[1]),
      endMinute: parseClockToken(rangeMatch[2])
    };
  }

  const singleMatch = text.match(
    new RegExp(
      `\\b${direction}\\b[^.\\n]*?(\\d{1,2}(?::\\d{2}|h\\d{0,2}(?:m\\d{0,2}(?:s\\d{0,2})?)?))`,
      "i"
    )
  );

  if (!singleMatch) {
    return null;
  }

  return {
    startMinute: parseClockToken(singleMatch[1]),
    endMinute: null
  };
}

function extractWindowHint(text) {
  const lowered = text.toLowerCase();

  if (/\bmorning\b/.test(lowered)) {
    return WINDOW_HINTS.morning;
  }

  if (/\bafternoon\b/.test(lowered)) {
    return WINDOW_HINTS.afternoon;
  }

  if (/\bevening\b/.test(lowered)) {
    return WINDOW_HINTS.evening;
  }

  return null;
}

function extractSequenceHint(text) {
  if (/^\s*(?:right after|afterwards|then)\b/i.test(text)) {
    return {
      followPrevious: true
    };
  }

  return null;
}

function findOverallRange(dates, currentDate, projectEntries = []) {
  const recurringRules = projectEntries.flatMap((project) => project.recurringRules ?? []);
  const allDates = [...dates, currentDate];

  for (const rule of recurringRules) {
    if (rule.startDate) {
      allDates.push(rule.startDate);
    }

    if (rule.endDate) {
      allDates.push(rule.endDate);
    }
  }

  if (recurringRules.length) {
    allDates.push(endOfMonthAfterMonthsIso(currentDate, DEFAULT_RECURRING_HORIZON_MONTHS));
  }

  allDates.sort();

  return {
    start: allDates[0],
    end: allDates[allDates.length - 1]
  };
}

function parseClockToken(value) {
  const normalized = String(value).trim().toLowerCase();
  const colonMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    return normalizeMinute(Number(colonMatch[1]) * 60 + Number(colonMatch[2]));
  }

  const hourMatch = normalized.match(/^(\d{1,2})h(?:(\d{1,2}))?(?:m\d{1,2})?(?:s\d{1,2})?$/);
  if (hourMatch) {
    return normalizeMinute(Number(hourMatch[1]) * 60 + Number(hourMatch[2] ?? 0));
  }

  return null;
}

function parseCompactDurationToken(value) {
  const normalized = String(value).trim().toLowerCase();
  const hourMinuteMatch = normalized.match(/^(\d{1,2})h(\d{1,2})$/);
  if (hourMinuteMatch) {
    return Number(hourMinuteMatch[1]) * 60 + Number(hourMinuteMatch[2]);
  }

  const hourMatch = normalized.match(/^(\d{1,2})h$/);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }

  const minuteMatch = normalized.match(/^(\d{1,3})m$/);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  return null;
}

function normalizeMinute(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SLOT_START_MINUTE;
  }

  return Math.min(Math.max(Math.round(value), 0), 24 * 60);
}

function normalizeDurationMinutes(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_ESTIMATE_MINUTES.task;
  }

  return Math.max(MIN_SLOT_MINUTES, Math.round(value));
}

function formatClockMinute(minute) {
  const safeMinute = normalizeMinute(minute);
  const hours = String(Math.floor(safeMinute / 60)).padStart(2, "0");
  const minutes = String(safeMinute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDurationMinutes(minutes) {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.round(minutes)) : DEFAULT_ESTIMATE_MINUTES.task;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  if (!hours) {
    return `${remainder} min`;
  }

  if (!remainder) {
    return `${hours}h`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}`;
}

function maxDefinedMinute(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return Math.max(left, right);
}

function minDefinedMinute(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return Math.min(left, right);
}

function matchesRecurringRule(rule, date) {
  if (rule.schedule.type === "monthly") {
    return matchesMonthlySchedule(rule.schedule, date);
  }

  if (rule.schedule.type === "weekly") {
    return matchesWeeklySchedule(rule.schedule, date);
  }

  return false;
}

function matchesMonthlySchedule(schedule, date) {
  const parsedDate = parseIsoDate(date);
  const monthLength = daysInMonth(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth() + 1);
  const matchingDays = new Set();

  for (const requestedDay of schedule.days) {
    if (requestedDay <= monthLength) {
      matchingDays.add(requestedDay);
    } else if (schedule.lastDayFallback) {
      matchingDays.add(monthLength);
    }
  }

  return matchingDays.has(parsedDate.getUTCDate());
}

function matchesWeeklySchedule(schedule, date) {
  const parsedDate = parseIsoDate(date);
  return schedule.weekdays.includes(parsedDate.getUTCDay());
}

function eachDate(start, end) {
  const dates = [];
  let cursor = parseIsoDate(start);
  const stop = parseIsoDate(end);

  while (cursor <= stop) {
    dates.push(formatIsoDate(cursor));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return dates;
}

function addDaysIso(isoDate, days) {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function endOfMonthAfterMonthsIso(isoDate, months) {
  const date = parseIsoDate(isoDate);
  date.setUTCMonth(date.getUTCMonth() + months + 1, 0);
  return formatIsoDate(date);
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatLongDate(date) {
  const parsed = parseIsoDate(date);
  return `${MONTH_NAMES[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStartOfCurrentHourMinute(date) {
  return date.getHours() * 60;
}

async function safeReadDir(dirpath) {
  try {
    return await readdir(dirpath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function fileExists(filepath) {
  return existsSync(filepath);
}
