// Client runtime for the generated planner bundle. Parsing and initial agenda
// placement live in `scripts/planner-data.mjs`; the browser mostly renders,
// filters, and lightly reflows the current day against the live clock.
const DAY_PREVIEW_LIMIT = 3;
const DEFAULT_SLOT_START_MINUTE = 8 * 60;
const DEFAULT_SLOT_END_MINUTE = 18 * 60;
const MIN_SLOT_MINUTES = 15;
const DEFAULT_ESTIMATE_MINUTES = {
  task: 60,
  cadence: 45,
  deadline: 30,
  event: 60,
  milestone: 45
};
const TIMELINE_MINUTE_HEIGHT = 1.4;
const TIMELINE_MIN_HEIGHT = 520;
const TIMELINE_MARKER_MIN_GAP = 18;
const ITEM_KIND_OPTIONS = [
  { value: "event", label: "Event" },
  { value: "task", label: "Task" },
  { value: "cadence", label: "Cadence" },
  { value: "deadline", label: "Deadline" },
  { value: "milestone", label: "Milestone" }
];
const PROJECT_CATEGORY_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "personnal", label: "Personal" }
];

const state = {
  data: null,
  selectedDate: null,
  query: "",
  showQuietDays: false,
  clockTimer: null,
  deletingItemKeys: new Set(),
  editingItemKeys: new Set(),
  itemComposer: {
    mode: "create",
    itemKey: null,
    sourceInfo: null,
    sourceType: null,
    originalPayload: null,
    originalDate: "",
    text: "",
    date: "",
    kind: "event",
    projectKey: "",
    startTime: "",
    endTime: "",
    estimateMinutes: ""
  },
  projectComposer: {
    name: "",
    categoryKey: "professional"
  },
  itemComposerStatus: null,
  projectComposerStatus: null,
  isCreatingItem: false,
  isCreatingProject: false,
  isItemComposerOpen: false,
  isProjectComposerOpen: false,
  openComposerPicker: null
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  dateInput: document.querySelector("#date-input"),
  quietToggle: document.querySelector("#quiet-toggle"),
  todayButton: document.querySelector("#today-button"),
  newItemPanelToggle: document.querySelector("#new-item-panel-toggle"),
  newItemDialog: document.querySelector("#new-item-dialog"),
  newItemDialogEyebrow: document.querySelector("#new-item-dialog-eyebrow"),
  newItemDialogTitle: document.querySelector("#new-item-dialog-title"),
  newItemDialogClose: document.querySelector("#new-item-dialog-close"),
  newItemForm: document.querySelector("#new-item-form"),
  newItemText: document.querySelector("#new-item-text"),
  newItemDate: document.querySelector("#new-item-date"),
  newItemKindTrigger: document.querySelector("#new-item-kind-trigger"),
  newItemKindOptions: document.querySelector("#new-item-kind-options"),
  newItemProjectTrigger: document.querySelector("#new-item-project-trigger"),
  newItemProjectOptions: document.querySelector("#new-item-project-options"),
  newItemStartTime: document.querySelector("#new-item-start-time"),
  newItemEndTime: document.querySelector("#new-item-end-time"),
  newItemEstimateField: document.querySelector("#new-item-estimate-field"),
  newItemEstimate: document.querySelector("#new-item-estimate"),
  newItemFeedback: document.querySelector("#new-item-feedback"),
  newItemSubmit: document.querySelector("#new-item-submit"),
  newProjectPanelToggle: document.querySelector("#new-project-panel-toggle"),
  newProjectDialog: document.querySelector("#new-project-dialog"),
  newProjectDialogClose: document.querySelector("#new-project-dialog-close"),
  newProjectForm: document.querySelector("#new-project-form"),
  newProjectName: document.querySelector("#new-project-name"),
  newProjectCategoryTrigger: document.querySelector("#new-project-category-trigger"),
  newProjectCategoryOptions: document.querySelector("#new-project-category-options"),
  newProjectFeedback: document.querySelector("#new-project-feedback"),
  newProjectSubmit: document.querySelector("#new-project-submit"),
  agendaList: document.querySelector("#agenda-list"),
  detailTitle: document.querySelector("#detail-title"),
  detailWeek: document.querySelector("#detail-week"),
  detailGroups: document.querySelector("#detail-groups"),
  prevButton: document.querySelector("#prev-button"),
  nextButton: document.querySelector("#next-button"),
  agendaDialog: document.querySelector("#agenda-dialog"),
  agendaDialogMeta: document.querySelector("#agenda-dialog-meta"),
  agendaDialogTitle: document.querySelector("#agenda-dialog-title"),
  agendaDialogContext: document.querySelector("#agenda-dialog-context")
};

initialize();

async function initialize() {
  try {
    state.data = await loadPlannerData();
    state.selectedDate = pickInitialDate(state.data);
    ensureComposerDefaults();

    wireEvents();
    scheduleCurrentTimeRefresh();
    render();
  } catch (error) {
    console.error(error);
    renderStartupError(error);
  }
}

async function loadPlannerData() {
  const response = await fetch(`./planner-data.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Planner data request failed (${response.status})`);
  }

  return response.json();
}

async function readApiResult(response, actionLabel = "Request") {
  const raw = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (_error) {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `${actionLabel} failed (${response.status}).`);
  }

  if (!payload || payload.ok !== true) {
    const normalizedBody = raw.trim().toLowerCase();
    if (contentType.includes("text/html") || normalizedBody.startsWith("<!doctype html")) {
      throw new Error(
        "The planner server returned the app page instead of API data. Restart the local planner server and try again."
      );
    }

    throw new Error(`${actionLabel} returned an unexpected response.`);
  }

  return payload;
}

function ensureComposerDefaults() {
  if (!state.itemComposer.date) {
    state.itemComposer.date = state.selectedDate ?? state.data?.meta?.currentDate ?? "";
  }

  const availableProjectKeys = new Set((state.data?.projects ?? []).map((project) => project.key));
  if (!availableProjectKeys.has(state.itemComposer.projectKey)) {
    state.itemComposer.projectKey = getOrderedProjects()[0]?.key ?? "";
  }
}

function prepareItemComposerForCreate() {
  if (state.itemComposer.mode !== "edit") {
    clearComposerStatus("item");
    return;
  }

  resetItemComposerAfterEdit();
  clearComposerStatus("item");
}

function resetItemComposerAfterEdit() {
  state.itemComposer.mode = "create";
  state.itemComposer.itemKey = null;
  state.itemComposer.sourceInfo = null;
  state.itemComposer.sourceType = null;
  state.itemComposer.originalPayload = null;
  state.itemComposer.originalDate = "";
  state.itemComposer.text = "";
  state.itemComposer.startTime = "";
  state.itemComposer.endTime = "";
  state.itemComposer.estimateMinutes = "";
}

function buildItemComposerPayloadFromItem(item, day) {
  const timing = item.timing ?? {};
  const fullProjectKey =
    item.categoryKey && item.projectKey ? `${item.categoryKey}/${item.projectKey}` : item.projectKey ?? "";

  return {
    text: String(item.text ?? "").trim(),
    date: day.date,
    kind: item.kind ?? "event",
    projectKey: fullProjectKey,
    startTime:
      timing.explicitStartMinute != null ? formatClock(timing.explicitStartMinute) : "",
    endTime:
      timing.explicitEndMinute != null ? formatClock(timing.explicitEndMinute) : "",
    estimateMinutes:
      item.kind !== "event" &&
      timing.explicitEndMinute == null &&
      timing.estimateSource !== "default" &&
      Number.isFinite(timing.estimateMinutes)
        ? String(timing.estimateMinutes)
        : ""
  };
}

function applyItemComposerPayload(
  payload,
  { mode = "create", itemKey = null, sourceInfo = null, sourceType = null, originalDate = "" } = {}
) {
  state.itemComposer.mode = mode;
  state.itemComposer.itemKey = itemKey;
  state.itemComposer.sourceInfo = sourceInfo;
  state.itemComposer.sourceType = sourceType;
  state.itemComposer.originalPayload =
    mode === "edit" ? normalizeComparableItemPayload(payload) : null;
  state.itemComposer.originalDate = originalDate;
  state.itemComposer.text = payload.text;
  state.itemComposer.date = payload.date;
  state.itemComposer.kind = payload.kind;
  state.itemComposer.projectKey = payload.projectKey;
  state.itemComposer.startTime = payload.startTime;
  state.itemComposer.endTime = payload.endTime;
  state.itemComposer.estimateMinutes = payload.estimateMinutes;
}

function buildItemComposerSubmissionPayload() {
  return {
    text: state.itemComposer.text.trim(),
    date: state.itemComposer.date,
    kind: state.itemComposer.kind,
    projectKey: state.itemComposer.projectKey,
    startTime: state.itemComposer.startTime || null,
    endTime: state.itemComposer.endTime || null,
    estimateMinutes:
      shouldShowItemEstimateField() && state.itemComposer.estimateMinutes
        ? Number(state.itemComposer.estimateMinutes)
        : null,
    originalDate: state.itemComposer.originalDate || state.itemComposer.date
  };
}

function normalizeComparableItemPayload(payload) {
  return {
    text: String(payload?.text ?? "").trim(),
    date: String(payload?.date ?? "").trim(),
    kind: String(payload?.kind ?? "").trim(),
    projectKey: String(payload?.projectKey ?? "").trim(),
    startTime: payload?.startTime ? String(payload.startTime) : null,
    endTime: payload?.endTime ? String(payload.endTime) : null,
    estimateMinutes:
      payload?.estimateMinutes == null || payload?.estimateMinutes === ""
        ? null
        : Number(payload.estimateMinutes)
  };
}

function areItemPayloadsEqual(left, right) {
  return JSON.stringify(normalizeComparableItemPayload(left)) === JSON.stringify(normalizeComparableItemPayload(right));
}

function getOrderedProjects() {
  return [...(state.data?.projects ?? [])].sort(
    (left, right) =>
      left.projectLabel.localeCompare(right.projectLabel, undefined, { sensitivity: "base" }) ||
      left.categoryLabel.localeCompare(right.categoryLabel, undefined, { sensitivity: "base" }) ||
      left.key.localeCompare(right.key, undefined, { sensitivity: "base" })
  );
}

function renderStartupError(error) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The planner could not finish loading.";

  const errorBox = document.createElement("div");
  errorBox.className = "fatal-state";
  errorBox.innerHTML = `
    <h3>Planner load failed</h3>
    <p>${escapeHtml(message)}</p>
    <p>Try refreshing once. If it keeps happening, restart the local planner server.</p>
  `;

  elements.agendaList.replaceChildren(errorBox);
  elements.detailTitle.textContent = "Planner unavailable";
  elements.detailWeek.textContent = "The planner data could not be loaded.";
  elements.detailGroups.replaceChildren(errorBox.cloneNode(true));
}

function wireEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    syncSelectedDateToVisibleDays();
    render();
  });

  elements.dateInput.addEventListener("change", (event) => {
    if (!event.target.value) {
      return;
    }

    state.selectedDate = clampDateToPlanner(event.target.value);
    renderDetail();
    highlightSelection();
  });

  elements.quietToggle.addEventListener("change", (event) => {
    state.showQuietDays = event.target.checked;
    syncSelectedDateToVisibleDays();
    render();
  });

  elements.todayButton.addEventListener("click", () => {
    state.selectedDate = pickInitialDate(state.data, true);
    render();
  });

  elements.newItemPanelToggle.addEventListener("click", () => {
    prepareItemComposerForCreate();
    openComposerDialog("item");
  });

  elements.newProjectPanelToggle.addEventListener("click", () => {
    openComposerDialog("project");
  });

  elements.newItemDialogClose.addEventListener("click", () => {
    requestComposerDialogClose("item");
  });

  elements.newProjectDialogClose.addEventListener("click", () => {
    requestComposerDialogClose("project");
  });

  elements.prevButton.addEventListener("click", () => stepSelectedDate(-1));
  elements.nextButton.addEventListener("click", () => stepSelectedDate(1));
  elements.newItemDialog.addEventListener("click", (event) => {
    if (event.target === elements.newItemDialog) {
      requestComposerDialogClose("item");
    }
  });
  elements.newProjectDialog.addEventListener("click", (event) => {
    if (event.target === elements.newProjectDialog) {
      requestComposerDialogClose("project");
    }
  });
  elements.newItemDialog.addEventListener("cancel", (event) => {
    if (state.isCreatingItem) {
      event.preventDefault();
    }
  });
  elements.newProjectDialog.addEventListener("cancel", (event) => {
    if (state.isCreatingProject) {
      event.preventDefault();
    }
  });
  elements.newItemDialog.addEventListener("close", () => {
    handleComposerDialogClosed("item");
  });
  elements.newProjectDialog.addEventListener("close", () => {
    handleComposerDialogClosed("project");
  });
  elements.agendaDialog.addEventListener("click", (event) => {
    if (event.target === elements.agendaDialog) {
      elements.agendaDialog.close();
    }
  });

  elements.newItemText.addEventListener("input", (event) => {
    state.itemComposer.text = event.target.value;
    clearComposerStatus("item");
  });

  elements.newItemDate.addEventListener("change", (event) => {
    state.itemComposer.date = event.target.value;
    clearComposerStatus("item");
  });

  elements.newItemStartTime.addEventListener("input", (event) => {
    state.itemComposer.startTime = event.target.value;
    clearComposerStatus("item");
    renderComposerPanels();
  });

  elements.newItemEndTime.addEventListener("input", (event) => {
    state.itemComposer.endTime = event.target.value;
    clearComposerStatus("item");
    renderComposerPanels();
  });

  elements.newItemEstimate.addEventListener("input", (event) => {
    state.itemComposer.estimateMinutes = event.target.value;
    clearComposerStatus("item");
  });

  elements.newItemKindTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleComposerPicker("kind");
  });

  elements.newItemKindOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-kind]");
    if (!button) {
      return;
    }

    state.itemComposer.kind = button.dataset.kind;
    state.openComposerPicker = null;
    clearComposerStatus("item");
    renderComposerPanels();
  });

  elements.newItemProjectTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleComposerPicker("project");
  });

  elements.newItemProjectOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-project-key]");
    if (!button) {
      return;
    }

    state.itemComposer.projectKey = button.dataset.projectKey;
    state.openComposerPicker = null;
    clearComposerStatus("item");
    renderComposerPanels();
  });

  elements.newItemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.itemComposer.mode === "edit") {
      await handleUpdateItem();
      return;
    }

    await handleCreateItem();
  });

  elements.newProjectName.addEventListener("input", (event) => {
    state.projectComposer.name = event.target.value;
    clearComposerStatus("project");
  });

  elements.newProjectCategoryTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleComposerPicker("project-category");
  });

  elements.newProjectCategoryOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-category-key]");
    if (!button) {
      return;
    }

    state.projectComposer.categoryKey = button.dataset.categoryKey;
    clearComposerStatus("project");
    renderComposerPanels();
  });

  elements.newProjectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleCreateProject();
  });

  document.addEventListener("click", (event) => {
    if (!state.openComposerPicker) {
      return;
    }

    if (event.target.closest(".picker")) {
      return;
    }

    state.openComposerPicker = null;
    renderComposerPanels();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.openComposerPicker) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    state.openComposerPicker = null;
    renderComposerPanels();
  });
}

function scheduleCurrentTimeRefresh() {
  const delay = 60000 - (Date.now() % 60000) + 50;

  window.clearTimeout(state.clockTimer);
  state.clockTimer = window.setTimeout(() => {
    if (state.data && isCurrentDay(state.selectedDate)) {
      renderDetail();
    }

    scheduleCurrentTimeRefresh();
  }, delay);
}

function render() {
  renderControls();
  renderComposerPanels();
  renderAgenda();
  renderDetail();
}

function renderControls() {
  elements.dateInput.min = state.data.meta.startDate;
  elements.dateInput.max = state.data.meta.endDate;
  elements.dateInput.value = state.selectedDate;
}

function renderComposerPanels() {
  ensureComposerDefaults();
  const isEditingItem = state.itemComposer.mode === "edit";

  if (
    !state.isItemComposerOpen &&
    (state.openComposerPicker === "kind" || state.openComposerPicker === "project")
  ) {
    state.openComposerPicker = null;
  }

  if (!state.isProjectComposerOpen && state.openComposerPicker === "project-category") {
    state.openComposerPicker = null;
  }

  elements.newItemPanelToggle.setAttribute("aria-expanded", String(state.isItemComposerOpen));
  elements.newProjectPanelToggle.setAttribute("aria-expanded", String(state.isProjectComposerOpen));

  if (!state.isItemComposerOpen && elements.newItemDialog.open) {
    elements.newItemDialog.close();
  }

  if (!state.isProjectComposerOpen && elements.newProjectDialog.open) {
    elements.newProjectDialog.close();
  }

  if (state.isItemComposerOpen && !elements.newItemDialog.open) {
    elements.newItemDialog.showModal();
  }

  if (state.isProjectComposerOpen && !elements.newProjectDialog.open) {
    elements.newProjectDialog.showModal();
  }

  elements.newItemDialogEyebrow.textContent =
    state.itemComposer.sourceType === "recurring-rule" && isEditingItem
      ? "Edit recurring item"
      : isEditingItem
        ? "Edit item"
        : "Add an item";
  elements.newItemDialogTitle.textContent = isEditingItem
    ? "Update this planner item"
    : "Create a new planner item";
  elements.newItemText.value = state.itemComposer.text;
  elements.newItemDate.min = state.data.meta.startDate;
  elements.newItemDate.max = state.data.meta.endDate;
  elements.newItemDate.value = state.itemComposer.date;
  elements.newItemStartTime.value = state.itemComposer.startTime;
  elements.newItemEndTime.value = state.itemComposer.endTime;
  elements.newItemEstimate.value = state.itemComposer.estimateMinutes;
  elements.newItemText.disabled = state.isCreatingItem;
  elements.newItemDate.disabled = state.isCreatingItem;
  elements.newItemKindTrigger.disabled = state.isCreatingItem;
  elements.newItemProjectTrigger.disabled = state.isCreatingItem || !state.data.projects.length;
  elements.newItemStartTime.disabled = state.isCreatingItem;
  elements.newItemEndTime.disabled = state.isCreatingItem;
  elements.newItemEstimate.disabled = state.isCreatingItem || !shouldShowItemEstimateField();
  elements.newItemSubmit.disabled = state.isCreatingItem || !state.data.projects.length;
  elements.newItemDialogClose.disabled = state.isCreatingItem;
  elements.newItemSubmit.textContent = state.isCreatingItem
    ? isEditingItem
      ? "Saving..."
      : "Adding..."
    : isEditingItem
      ? "Save changes"
      : "Add item";
  elements.newItemKindTrigger.innerHTML = buildPickerTriggerMarkup("Kind", getSelectedItemKindLabel());
  elements.newItemProjectTrigger.innerHTML = buildPickerTriggerMarkup(
    "Project",
    getSelectedProjectLabel()
  );
  elements.newItemKindTrigger.setAttribute("aria-expanded", String(state.openComposerPicker === "kind"));
  elements.newItemProjectTrigger.setAttribute(
    "aria-expanded",
    String(state.openComposerPicker === "project")
  );
  elements.newItemKindOptions.hidden = state.openComposerPicker !== "kind";
  elements.newItemProjectOptions.hidden = state.openComposerPicker !== "project";

  elements.newProjectName.value = state.projectComposer.name;
  elements.newProjectName.disabled = state.isCreatingProject;
  elements.newProjectCategoryTrigger.disabled = state.isCreatingProject;
  elements.newProjectSubmit.disabled = state.isCreatingProject;
  elements.newProjectDialogClose.disabled = state.isCreatingProject;
  elements.newProjectSubmit.textContent = state.isCreatingProject ? "Creating..." : "Create project";
  elements.newProjectCategoryTrigger.innerHTML = buildPickerTriggerMarkup(
    "Category",
    getSelectedProjectCategoryLabel()
  );
  elements.newProjectCategoryTrigger.setAttribute(
    "aria-expanded",
    String(state.openComposerPicker === "project-category")
  );
  elements.newProjectCategoryOptions.hidden = state.openComposerPicker !== "project-category";

  renderChoiceButtons({
    container: elements.newItemKindOptions,
    options: ITEM_KIND_OPTIONS,
    selectedValue: state.itemComposer.kind,
    attributeName: "kind"
  });
  renderProjectChoices();
  renderChoiceButtons({
    container: elements.newProjectCategoryOptions,
    options: PROJECT_CATEGORY_OPTIONS,
    selectedValue: state.projectComposer.categoryKey,
    attributeName: "category-key"
  });

  const showEstimateField = shouldShowItemEstimateField();
  elements.newItemEstimateField.hidden = !showEstimateField;
  renderComposerStatus(elements.newItemFeedback, state.itemComposerStatus);
  renderComposerStatus(elements.newProjectFeedback, state.projectComposerStatus);
}

function renderChoiceButtons({ container, options, selectedValue, attributeName }) {
  container.replaceChildren();
  container.setAttribute("role", "listbox");

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice-button ${option.value === selectedValue ? "is-selected" : ""}`;
    button.setAttribute(`data-${attributeName}`, option.value);
    button.textContent = option.label;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.value === selectedValue));
    button.setAttribute("aria-pressed", String(option.value === selectedValue));
    container.append(button);
  }
}

function renderProjectChoices() {
  elements.newItemProjectOptions.replaceChildren();
  elements.newItemProjectOptions.setAttribute("role", "listbox");
  const orderedProjects = getOrderedProjects();

  if (!orderedProjects.length) {
    const empty = document.createElement("div");
    empty.className = "choice-empty";
    empty.textContent = "Create a project first.";
    elements.newItemProjectOptions.append(empty);
    return;
  }

  for (const project of orderedProjects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-choice ${project.key === state.itemComposer.projectKey ? "is-selected" : ""}`;
    button.dataset.projectKey = project.key;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(project.key === state.itemComposer.projectKey));
    button.setAttribute("aria-pressed", String(project.key === state.itemComposer.projectKey));
    button.innerHTML = `
      <span class="project-choice__title">${escapeHtml(project.projectLabel)}</span>
      <span class="project-choice__meta">${escapeHtml(project.categoryLabel)}</span>
    `;
    elements.newItemProjectOptions.append(button);
  }
}

function shouldShowItemEstimateField() {
  return (
    state.itemComposer.kind !== "event" &&
    (!state.itemComposer.startTime || !state.itemComposer.endTime)
  );
}

function renderComposerStatus(element, status) {
  element.textContent = status?.message ?? "";
  element.dataset.tone = status?.tone ?? "";
  element.hidden = !status?.message;
}

function buildPickerTriggerMarkup(label, value) {
  return `
    <span class="picker-trigger__label">${escapeHtml(label)}</span>
    <span class="picker-trigger__value">${escapeHtml(value)}</span>
    <span class="picker-trigger__caret" aria-hidden="true">+</span>
  `;
}

function getSelectedItemKindLabel() {
  return ITEM_KIND_OPTIONS.find((option) => option.value === state.itemComposer.kind)?.label ?? "Kind";
}

function getSelectedProjectLabel() {
  return state.data.projects.find((project) => project.key === state.itemComposer.projectKey)?.projectLabel ?? "Choose project";
}

function getSelectedProjectCategoryLabel() {
  return (
    PROJECT_CATEGORY_OPTIONS.find((option) => option.value === state.projectComposer.categoryKey)?.label ??
    "Choose category"
  );
}

function openComposerDialog(name) {
  if (name === "item") {
    state.isItemComposerOpen = true;
    state.isProjectComposerOpen = false;
    if (state.openComposerPicker === "project-category") {
      state.openComposerPicker = null;
    }
    clearComposerStatus("item");
  }

  if (name === "project") {
    state.isProjectComposerOpen = true;
    state.isItemComposerOpen = false;
    if (state.openComposerPicker === "kind" || state.openComposerPicker === "project") {
      state.openComposerPicker = null;
    }
    clearComposerStatus("project");
  }

  renderComposerPanels();

  window.requestAnimationFrame(() => {
    if (name === "item" && state.isItemComposerOpen) {
      elements.newItemText.focus();
    }

    if (name === "project" && state.isProjectComposerOpen) {
      elements.newProjectName.focus();
    }
  });
}

function requestComposerDialogClose(name) {
  if (
    (name === "item" && state.isCreatingItem) ||
    (name === "project" && state.isCreatingProject)
  ) {
    return;
  }

  closeComposerDialog(name);
}

function closeComposerDialog(name) {
  if (name === "item") {
    state.isItemComposerOpen = false;
    if (state.openComposerPicker === "kind" || state.openComposerPicker === "project") {
      state.openComposerPicker = null;
    }
    if (state.itemComposer.mode === "edit") {
      resetItemComposerAfterEdit();
    }
    clearComposerStatus("item");
  }

  if (name === "project") {
    state.isProjectComposerOpen = false;
    if (state.openComposerPicker === "project-category") {
      state.openComposerPicker = null;
    }
    clearComposerStatus("project");
  }

  renderComposerPanels();
}

function handleComposerDialogClosed(name) {
  if (name === "item") {
    state.isItemComposerOpen = false;
    if (state.openComposerPicker === "kind" || state.openComposerPicker === "project") {
      state.openComposerPicker = null;
    }
    if (state.itemComposer.mode === "edit") {
      resetItemComposerAfterEdit();
    }
    clearComposerStatus("item");
  }

  if (name === "project") {
    state.isProjectComposerOpen = false;
    if (state.openComposerPicker === "project-category") {
      state.openComposerPicker = null;
    }
    clearComposerStatus("project");
  }

  renderComposerPanels();
}

function toggleComposerPicker(name) {
  if (
    (name === "kind" && elements.newItemKindTrigger.disabled) ||
    (name === "project" && elements.newItemProjectTrigger.disabled) ||
    (name === "project-category" && elements.newProjectCategoryTrigger.disabled)
  ) {
    return;
  }

  if (
    (name === "kind" || name === "project") &&
    !state.isItemComposerOpen
  ) {
    return;
  }

  if (name === "project-category" && !state.isProjectComposerOpen) {
    return;
  }

  state.openComposerPicker = state.openComposerPicker === name ? null : name;
  renderComposerPanels();
}

function clearComposerStatus(type) {
  if (type === "item") {
    state.itemComposerStatus = null;
    return;
  }

  if (type === "project") {
    state.projectComposerStatus = null;
  }
}

function setComposerStatus(type, tone, message) {
  const status = message
    ? {
        tone,
        message
      }
    : null;

  if (type === "item") {
    state.itemComposerStatus = status;
    return;
  }

  if (type === "project") {
    state.projectComposerStatus = status;
  }
}

function getItemComposerValidationMessage(payload) {
  if (!payload.text) {
    return "Add a title before saving the item.";
  }

  if (!payload.projectKey) {
    return "Choose a project before saving the item.";
  }

  if (!payload.date) {
    return "Choose the day for this item.";
  }

  return null;
}

async function handleUpdateItem() {
  if (state.isCreatingItem) {
    return;
  }

  if (!state.itemComposer.sourceInfo) {
    setComposerStatus("item", "error", "This item cannot be edited because its source metadata is missing.");
    renderComposerPanels();
    return;
  }

  const payload = buildItemComposerSubmissionPayload();
  const validationMessage = getItemComposerValidationMessage(payload);
  if (validationMessage) {
    setComposerStatus("item", "error", validationMessage);
    renderComposerPanels();
    return;
  }

  if (state.itemComposer.originalPayload && areItemPayloadsEqual(state.itemComposer.originalPayload, payload)) {
    closeComposerDialog("item");
    return;
  }

  const itemKey = state.itemComposer.itemKey ?? getItemDeletionKey({ sourceInfo: state.itemComposer.sourceInfo });
  if (state.deletingItemKeys.has(itemKey) || state.editingItemKeys.has(itemKey)) {
    return;
  }

  state.isCreatingItem = true;
  state.editingItemKeys.add(itemKey);
  clearComposerStatus("item");
  renderComposerPanels();

  try {
    const response = await fetch("./api/items/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceInfo: state.itemComposer.sourceInfo,
        item: payload
      })
    });
    const result = await readApiResult(response, "Update request");

    state.selectedDate = payload.date;
    state.isItemComposerOpen = false;
    resetItemComposerAfterEdit();
    await refreshPlannerData(payload.date, result?.plannerData);
  } catch (error) {
    console.error(error);
    setComposerStatus(
      "item",
      "error",
      error instanceof Error ? error.message : "The planner could not update that item."
    );
  } finally {
    state.isCreatingItem = false;
    state.editingItemKeys.delete(itemKey);
    renderComposerPanels();
  }
}

async function handleCreateItem() {
  if (state.isCreatingItem) {
    return;
  }

  const payload = buildItemComposerSubmissionPayload();
  const validationMessage = getItemComposerValidationMessage(payload);
  if (validationMessage) {
    setComposerStatus("item", "error", validationMessage.replace("saving", "creating").replace("this item", "the new item"));
    renderComposerPanels();
    return;
  }

  state.isCreatingItem = true;
  clearComposerStatus("item");
  renderComposerPanels();

  try {
    const response = await fetch("./api/items/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        item: payload
      })
    });
    const result = await readApiResult(response, "Item creation");

    state.selectedDate = payload.date;
    state.itemComposer.mode = "create";
    state.itemComposer.itemKey = null;
    state.itemComposer.sourceInfo = null;
    state.itemComposer.sourceType = null;
    state.itemComposer.originalPayload = null;
    state.itemComposer.originalDate = "";
    state.itemComposer.text = "";
    state.itemComposer.startTime = "";
    state.itemComposer.endTime = "";
    state.itemComposer.estimateMinutes = "";
    state.isItemComposerOpen = false;
    clearComposerStatus("item");
    await refreshPlannerData(payload.date, result?.plannerData);
  } catch (error) {
    console.error(error);
    setComposerStatus(
      "item",
      "error",
      error instanceof Error ? error.message : "The planner could not create the item."
    );
  } finally {
    state.isCreatingItem = false;
    renderComposerPanels();
  }
}

async function handleCreateProject() {
  if (state.isCreatingProject) {
    return;
  }

  const payload = {
    name: state.projectComposer.name.trim(),
    categoryKey: state.projectComposer.categoryKey
  };

  if (!payload.name) {
    setComposerStatus("project", "error", "Add a project name first.");
    renderComposerPanels();
    return;
  }

  state.isCreatingProject = true;
  clearComposerStatus("project");
  renderComposerPanels();

  try {
    const response = await fetch("./api/projects/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        project: payload
      })
    });
    const result = await readApiResult(response, "Project creation");

    state.projectComposer.name = "";
    state.itemComposer.projectKey = result?.project?.key ?? state.itemComposer.projectKey;
    state.isProjectComposerOpen = false;
    clearComposerStatus("project");
    await refreshPlannerData(state.selectedDate, result?.plannerData);
  } catch (error) {
    console.error(error);
    setComposerStatus(
      "project",
      "error",
      error instanceof Error ? error.message : "The planner could not create the project."
    );
  } finally {
    state.isCreatingProject = false;
    renderComposerPanels();
  }
}

function renderAgenda() {
  const filteredDays = getFilteredDays();
  const filteredMonths = groupDaysByMonth(filteredDays);

  elements.agendaList.replaceChildren();

  if (!filteredDays.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No days match the current search.";
    elements.agendaList.append(empty);
    return;
  }

  for (const [monthKey, days] of filteredMonths.entries()) {
    const block = document.createElement("section");
    block.className = "month-block";
    block.dataset.month = monthKey;

    for (const day of days) {
      block.append(renderDayCard(day));
    }

    elements.agendaList.append(block);
  }

  highlightSelection();
}

function renderDayCard(day) {
  const card = document.createElement("article");
  card.className = `day-card ${day.date === state.selectedDate ? "is-selected" : ""}`;
  card.dataset.date = day.date;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  const previewItems = getPreviewItems(day.visibleItems);
  const overflowCount = Math.max(day.visibleItems.length - DAY_PREVIEW_LIMIT, 0);
  const countChips = [];
  const agendaSummary = day.visibleAgenda;

  for (const [kind, count] of Object.entries(day.visibleCounts)) {
    if (count > 0) {
      countChips.push(
        `<span class="chip chip--${kind}">${count} ${kind}${count > 1 ? "s" : ""}</span>`
      );
    }
  }

  card.innerHTML = `
    <div class="day-card__date">
      <span class="day-card__weekday">${escapeHtml(day.weekdayShort)}</span>
      <span class="day-card__number">${day.dayNumber}</span>
      <span class="day-card__month">${escapeHtml(day.monthLabel.slice(0, 3))}</span>
    </div>
    <div class="day-card__content">
      <h3 class="day-card__title">${escapeHtml(day.dateLabel)}</h3>
      <p class="day-card__meta">${escapeHtml(buildDaySubtitle(day))}</p>
      <p class="day-card__schedule">${
        agendaSummary.windowLabel
          ? `${escapeHtml(agendaSummary.windowLabel)} | ${escapeHtml(formatDuration(agendaSummary.totalReservedMinutes))} reserved`
          : "No reserved agenda yet"
      }</p>
      <div class="chip-row">${countChips.join("")}</div>
    </div>
  `;

  const content = card.querySelector(".day-card__content");

  if (day.visibleItems.length) {
    const previewList = document.createElement("ul");
    previewList.className = "preview-list";

    for (const item of previewItems) {
      previewList.append(renderPreviewItem(item, day));
    }

    content.append(previewList);

    if (overflowCount) {
      const overflow = document.createElement("div");
      overflow.className = "day-card__overflow";
      overflow.textContent = `+${overflowCount} more item${overflowCount === 1 ? "" : "s"} in the day agenda`;
      content.append(overflow);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No items are scheduled for this day yet.";
    content.append(empty);
  }

  wireDayCardSelection(card, day);
  return card;
}

function wireDayCardSelection(card, day) {
  card.addEventListener("click", (event) => {
    if (event.target.closest(".item-action-button")) {
      return;
    }

    state.selectedDate = day.date;
    renderDetail();
    highlightSelection();
  });

  card.addEventListener("keydown", (event) => {
    if (event.target !== card) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      state.selectedDate = day.date;
      renderDetail();
      highlightSelection();
    }
  });
}

function renderPreviewItem(item, day) {
  const durationLabel = item.agenda?.durationLabel ?? "";
  const entry = document.createElement("li");
  entry.className = "preview-item";
  entry.innerHTML = `
    <div class="preview-item__line">
      <span class="item-badge item-badge--${item.kind}">${item.kind}</span>
    </div>
    <div class="preview-item__text">${escapeHtml(item.text)}</div>
    <div class="preview-item__context">${escapeHtml(item.contextLabel)}${durationLabel ? ` | ${escapeHtml(durationLabel)}` : ""}</div>
  `;
  entry.append(createItemActionButtons(item, day));

  return entry;
}

function renderDetail() {
  const displayDay = getDisplayDayByDate(state.selectedDate);
  if (!displayDay) {
    return;
  }

  const agendaSummary = displayDay.visibleAgenda;
  const currentMarker = getCurrentDayMarker(displayDay.date);

  elements.detailTitle.textContent = displayDay.dateLabel;
  elements.detailWeek.textContent = agendaSummary.windowLabel
    ? `${agendaSummary.windowLabel} | ${formatDuration(agendaSummary.totalReservedMinutes)} reserved${
        currentMarker ? ` | now ${formatClock(currentMarker.minute)}` : ""
      }`
    : `No reserved time yet${currentMarker ? ` | now ${formatClock(currentMarker.minute)}` : ""}`;

  elements.detailGroups.replaceChildren();

  if (!displayDay.visibleItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.query
      ? `No items match "${state.query}" on this day.`
      : "Nothing is assigned to this day yet.";
    elements.detailGroups.append(empty);
    elements.dateInput.value = state.selectedDate;
    elements.detailGroups.scrollTop = 0;
    return;
  }

  elements.detailGroups.append(
    shouldUseCompactAgenda() ? renderAgendaStack(displayDay) : renderTimeline(displayDay)
  );
  elements.dateInput.value = state.selectedDate;
  elements.detailGroups.scrollTop = 0;
}

function shouldUseCompactAgenda() {
  return window.matchMedia("(max-width: 860px)").matches;
}

function renderAgendaStack(day) {
  const wrapper = document.createElement("div");
  wrapper.className = "agenda-stack";
  const currentMarker = getCurrentDayMarker(day.date);

  if (currentMarker) {
    const marker = document.createElement("div");
    marker.className = "agenda-now";
    marker.textContent = `Now ${formatClock(currentMarker.minute)}`;
    wrapper.append(marker);
  }

  for (const item of day.visibleItems) {
    const entry = document.createElement("article");
    entry.className = `agenda-card agenda-card--${item.kind}`;
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    wireAgendaInteraction(entry, item, day);
    entry.innerHTML = `
      <div class="agenda-card__title">${escapeHtml(item.text)}</div>
    `;
    entry.append(createItemActionButtons(item, day));
    wrapper.append(entry);
  }

  return wrapper;
}

function renderTimeline(day) {
  const currentMarker = getCurrentDayMarker(day.date);
  const summary = extendAgendaSummaryWithCurrentMarker(day.visibleAgenda, currentMarker?.minute ?? null);
  const totalMinutes = Math.max(summary.windowEndMinute - summary.windowStartMinute, 60);
  const height = Math.max(totalMinutes * TIMELINE_MINUTE_HEIGHT, TIMELINE_MIN_HEIGHT);
  const wrapper = document.createElement("div");
  wrapper.className = "timeline";

  const rail = document.createElement("div");
  rail.className = "timeline__rail";
  rail.style.height = `${height}px`;

  const canvas = document.createElement("div");
  canvas.className = "timeline__canvas";
  canvas.style.height = `${height}px`;

  for (let hour = summary.windowStartMinute; hour <= summary.windowEndMinute; hour += 60) {
    const top = (hour - summary.windowStartMinute) * TIMELINE_MINUTE_HEIGHT;

    const label = document.createElement("div");
    label.className = "timeline__hour";
    label.style.top = `${top}px`;
    label.textContent = formatClock(hour);
    rail.append(label);

    const line = document.createElement("div");
    line.className = "timeline__line";
    line.style.top = `${top}px`;
    canvas.append(line);
  }

  for (const markerMinute of getTimelineMarkers(day.visibleItems, summary, currentMarker?.minute ?? null)) {
    const top = (markerMinute - summary.windowStartMinute) * TIMELINE_MINUTE_HEIGHT;

    const marker = document.createElement("div");
    marker.className = "timeline__marker";
    marker.style.top = `${top}px`;
    marker.textContent = formatClock(markerMinute);
    rail.append(marker);

    const tick = document.createElement("div");
    tick.className = "timeline__marker-tick";
    tick.style.top = `${top}px`;
    canvas.append(tick);
  }

  if (currentMarker) {
    const top = (currentMarker.minute - summary.windowStartMinute) * TIMELINE_MINUTE_HEIGHT;

    const marker = document.createElement("div");
    marker.className = "timeline__now";
    marker.style.top = `${top}px`;
    marker.textContent = `Now ${formatClock(currentMarker.minute)}`;
    rail.append(marker);

    const line = document.createElement("div");
    line.className = "timeline__now-line";
    line.style.top = `${top}px`;
    canvas.append(line);
  }

  for (const item of day.visibleItems) {
    const entry = document.createElement("article");
    const top = (item.agenda.startMinute - summary.windowStartMinute) * TIMELINE_MINUTE_HEIGHT;
    const entryHeight = Math.max(item.agenda.durationMinutes * TIMELINE_MINUTE_HEIGHT, 34);
    const titleLineClamp = getAgendaEntryTitleLines(item.agenda.durationMinutes);

    entry.className = `agenda-entry agenda-entry--${item.kind} agenda-entry--${item.agenda.scheduleKind}`;
    entry.style.top = `${top}px`;
    entry.style.height = `${entryHeight}px`;
    entry.style.setProperty("--lane", String(item.agenda.lane ?? 0));
    entry.style.setProperty("--lane-count", String(item.agenda.laneCount ?? 1));
    entry.style.setProperty("--agenda-title-lines", String(titleLineClamp));
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    wireAgendaInteraction(entry, item, day);
    entry.innerHTML = `
      <div class="agenda-entry__title">${escapeHtml(item.text)}</div>
    `;
    entry.append(createItemActionButtons(item, day));
    canvas.append(entry);
  }

  wrapper.append(rail, canvas);
  return wrapper;
}

function getAgendaEntryTitleLines(durationMinutes) {
  if (durationMinutes >= 150) {
    return 9;
  }

  if (durationMinutes >= 120) {
    return 7;
  }

  if (durationMinutes >= 90) {
    return 6;
  }

  if (durationMinutes >= 60) {
    return 4;
  }

  return 3;
}

function buildAgendaTooltip(item) {
  return [item.agenda.slotLabel, item.kind, item.contextLabel, item.agenda.durationLabel]
    .filter(Boolean)
    .join(" | ");
}

function wireAgendaInteraction(element, item, day) {
  element.addEventListener("click", (event) => {
    if (event.target.closest(".item-action-button")) {
      return;
    }

    openAgendaDialog(item, day);
  });
  element.addEventListener("keydown", (event) => {
    if (event.target !== element) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAgendaDialog(item, day);
    }
  });
}

function createItemActionButtons(item, day) {
  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(createEditButton(item, day), createDeleteButton(item, day));
  return actions;
}

function createEditButton(item, day) {
  const button = document.createElement("button");
  const itemKey = getItemDeletionKey(item);
  const isMutating =
    state.deletingItemKeys.has(itemKey) || state.editingItemKeys.has(itemKey);

  button.type = "button";
  button.className = "item-action-button item-edit-button";
  button.textContent = "\u270E";
  button.title = `Edit "${item.text}"`;
  button.setAttribute("aria-label", `Edit ${item.text}`);
  button.disabled = isMutating;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    openItemComposerForEdit(item, day);
  });

  return button;
}

function createDeleteButton(item, day) {
  const button = document.createElement("button");
  const deletionKey = getItemDeletionKey(item);
  const isMutating =
    state.deletingItemKeys.has(deletionKey) || state.editingItemKeys.has(deletionKey);

  button.type = "button";
  button.className = "item-action-button item-delete-button";
  button.textContent = "x";
  button.title = `Delete "${item.text}"`;
  button.setAttribute("aria-label", `Delete ${item.text}`);
  button.disabled = isMutating;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await confirmAndDeleteItem(item, day);
  });

  return button;
}

function getItemDeletionKey(item) {
  const sourceInfo = item.sourceInfo ?? {};

  return [
    sourceInfo.type ?? item.source ?? "item",
    sourceInfo.relativePath ?? item.projectKey ?? "",
    sourceInfo.lineNumber ?? sourceInfo.ruleIndex ?? "",
    sourceInfo.itemIndex ?? "",
    sourceInfo.fingerprint ?? item.text
  ].join("::");
}

function openItemComposerForEdit(item, day) {
  if (!item.sourceInfo) {
    window.alert("This item cannot be edited because its source metadata is missing.");
    return;
  }

  const itemKey = getItemDeletionKey(item);
  if (state.deletingItemKeys.has(itemKey) || state.editingItemKeys.has(itemKey)) {
    return;
  }

  applyItemComposerPayload(buildItemComposerPayloadFromItem(item, day), {
    mode: "edit",
    itemKey,
    sourceInfo: item.sourceInfo,
    sourceType: item.source ?? item.sourceInfo.type ?? "daily-file",
    originalDate: day.date
  });
  clearComposerStatus("item");

  if (elements.agendaDialog.open) {
    elements.agendaDialog.close();
  }

  openComposerDialog("item");
}

async function confirmAndDeleteItem(item, day) {
  if (!item.sourceInfo) {
    window.alert("This item cannot be deleted because its source metadata is missing.");
    return;
  }

  const deletionKey = getItemDeletionKey(item);
  if (state.deletingItemKeys.has(deletionKey) || state.editingItemKeys.has(deletionKey)) {
    return;
  }

  const confirmed = window.confirm(`Delete "${item.text}" from ${day.dateLabel}?`);
  if (!confirmed) {
    return;
  }

  const previousSelectedDate = state.selectedDate;
  state.deletingItemKeys.add(deletionKey);
  render();

  try {
    const response = await fetch("./api/items/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceInfo: item.sourceInfo
      })
    });
    const payload = await readApiResult(response, "Delete request");

    if (elements.agendaDialog.open) {
      elements.agendaDialog.close();
    }

    await refreshPlannerData(previousSelectedDate, payload?.plannerData);
  } catch (error) {
    console.error(error);
    window.alert(
      error instanceof Error && error.message
        ? error.message
        : "The planner could not delete that item."
    );
  } finally {
    state.deletingItemKeys.delete(deletionKey);
    render();
  }
}

async function refreshPlannerData(preferredDate = state.selectedDate, fallbackData = null) {
  try {
    state.data = await loadPlannerData();
  } catch (error) {
    if (!fallbackData) {
      throw error;
    }

    state.data = fallbackData;
  }

  state.openComposerPicker = null;
  ensureComposerDefaults();
  syncSelectionAfterDataRefresh(preferredDate);
  render();
}

function syncSelectionAfterDataRefresh(preferredDate = state.selectedDate) {
  if (!state.data?.days?.length) {
    state.selectedDate = null;
    return;
  }

  const safeDate = preferredDate
    ? clampDate(preferredDate, state.data.meta.startDate, state.data.meta.endDate)
    : pickInitialDate(state.data);

  state.selectedDate = state.data.days.some((day) => day.date === safeDate)
    ? safeDate
    : pickInitialDate(state.data);

  syncSelectedDateToVisibleDays();
}

function openAgendaDialog(item, day) {
  elements.agendaDialogMeta.textContent = `${day.dateLabel} | ${item.agenda.slotLabel}`;
  elements.agendaDialogTitle.textContent = item.text;
  elements.agendaDialogContext.textContent = [item.contextLabel, capitalize(item.kind), item.agenda.durationLabel]
    .filter(Boolean)
    .join(" | ");
  elements.agendaDialog.showModal();
}

function getTimelineMarkers(items, summary, currentMarkerMinute = null) {
  const uniqueMinutes = [
    ...new Set(
      items.flatMap((item) => {
        if (item.agenda.scheduleKind === "auto") {
          return [];
        }

        return [item.agenda.startMinute, item.agenda.endMinute];
      })
    )
  ]
    .filter(
      (minute) =>
        minute > summary.windowStartMinute &&
        minute < summary.windowEndMinute &&
        minute % 60 !== 0 &&
        (currentMarkerMinute == null ||
          Math.abs(minute - currentMarkerMinute) * TIMELINE_MINUTE_HEIGHT >= TIMELINE_MARKER_MIN_GAP)
    )
    .sort((left, right) => left - right);
  const markers = [];
  let lastTop = Number.NEGATIVE_INFINITY;

  for (const minute of uniqueMinutes) {
    const top = (minute - summary.windowStartMinute) * TIMELINE_MINUTE_HEIGHT;
    if (top - lastTop < TIMELINE_MARKER_MIN_GAP) {
      continue;
    }

    markers.push(minute);
    lastTop = top;
  }

  return markers;
}

function highlightSelection() {
  for (const card of document.querySelectorAll(".day-card")) {
    card.classList.toggle("is-selected", card.dataset.date === state.selectedDate);
  }

  const selected = document.querySelector(`.day-card[data-date="${state.selectedDate}"]`);
  if (selected) {
    selected.scrollIntoView({ block: "nearest" });
  }
}

function getPreviewItems(items) {
  return [...items]
    .sort(compareAgendaItems)
    .slice(0, DAY_PREVIEW_LIMIT);
}

function getFilteredDays() {
  const displayDays = state.data.days.map(buildDisplayDay);

  return displayDays.filter((day) => {
    if (state.query) {
      return day.visibleItems.length > 0;
    }

    if (!state.showQuietDays && day.visibleItems.length === 0) {
      return false;
    }

    return true;
  });
}

function groupDaysByMonth(days) {
  const groups = new Map();

  for (const day of days) {
    if (!groups.has(day.monthKey)) {
      groups.set(day.monthKey, []);
    }
    groups.get(day.monthKey).push(day);
  }

  return groups;
}

function stepSelectedDate(direction) {
  const days = getFilteredDays();
  const index = days.findIndex((day) => day.date === state.selectedDate);

  if (index === -1) {
    state.selectedDate = days[0]?.date ?? state.selectedDate;
  } else {
    const nextIndex = Math.min(Math.max(index + direction, 0), days.length - 1);
    state.selectedDate = days[nextIndex].date;
  }

  renderDetail();
  highlightSelection();
}

function pickInitialDate(data, forceToday = false) {
  const today = getTodayIsoDate();
  const preferred = clampDate(today, data.meta.startDate, data.meta.endDate);
  const hasToday = data.days.some((day) => day.date === preferred);

  if (forceToday && hasToday) {
    return preferred;
  }

  if (hasToday) {
    return preferred;
  }

  return data.days.find((day) => day.items.length > 0)?.date ?? data.meta.startDate;
}

function clampDateToPlanner(date) {
  return clampDate(date, state.data.meta.startDate, state.data.meta.endDate);
}

function syncSelectedDateToVisibleDays() {
  const visibleDays = getFilteredDays();
  if (!visibleDays.length) {
    return;
  }

  if (!visibleDays.some((day) => day.date === state.selectedDate)) {
    state.selectedDate = visibleDays[0].date;
  }
}

function getDisplayDayByDate(date) {
  const rawDay = state.data.days.find((entry) => entry.date === date);
  return rawDay ? buildDisplayDay(rawDay) : buildVirtualDay(date);
}

function getDisplayItemsForDay(day) {
  if (!isCurrentDay(day.date)) {
    return day.items;
  }

  return rescheduleCurrentDayItems(day.items, getCurrentHourFloorMinute());
}

// The generated JSON already contains a schedule. Recompute only today's
// auto-placed items so the timeline keeps pace with the current hour.
function rescheduleCurrentDayItems(items, autoStartFloorMinute) {
  const effectiveAutoStartFloorMinute = Math.max(
    DEFAULT_SLOT_START_MINUTE,
    normalizeMinute(autoStartFloorMinute)
  );
  const scheduledItems = new Map();
  const occupied = [];
  const planningItems = [...items].sort((left, right) => left.order - right.order);
  let cursor = effectiveAutoStartFloorMinute;
  let previousScheduledAgenda = null;

  for (const item of planningItems) {
    if (!item.agenda || item.agenda.scheduleKind === "auto") {
      continue;
    }

    const agenda = cloneAgendaEntry(item.agenda);
    scheduledItems.set(item.order, agenda);
    occupied.push({
      key: item.order,
      startMinute: agenda.startMinute,
      endMinute: agenda.endMinute
    });
  }

  occupied.sort(compareOccupiedSlots);

  for (const item of planningItems) {
    if (scheduledItems.has(item.order)) {
      previousScheduledAgenda = scheduledItems.get(item.order);
      continue;
    }

    const durationMinutes = getDisplayPlannedDuration(item);
    const agenda = placeFlexibleDisplayAgendaEntry(
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

  return items.map((item) => ({
    ...item,
    agenda: scheduledItems.get(item.order) ?? cloneAgendaEntry(item.agenda)
  }));
}

function placeFlexibleDisplayAgendaEntry(
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

  let slot = findDisplayOpenSlot({
    occupied,
    startMinute: preferredStartMinute,
    durationMinutes,
    latestEndMinute
  });

  if (!slot && latestEndMinute != null && preferredStartMinute !== earliestStartMinute) {
    slot = findDisplayOpenSlot({
      occupied,
      startMinute: earliestStartMinute,
      durationMinutes,
      latestEndMinute
    });
  }

  if (!slot) {
    slot = findDisplayOpenSlot({
      occupied,
      startMinute: Math.max(cursor, earliestStartMinute),
      durationMinutes
    });
  }

  return buildDisplayAgendaEntry(item, slot.startMinute, slot.endMinute, "auto");
}

function findDisplayOpenSlot({ occupied, startMinute, durationMinutes, latestEndMinute = null }) {
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

function buildDisplayAgendaEntry(item, startMinute, endMinute, scheduleKind) {
  const safeStartMinute = normalizeMinute(startMinute);
  const minimumDuration = scheduleKind === "fixed" ? 1 : MIN_SLOT_MINUTES;
  const safeEndMinute = normalizeMinute(Math.max(endMinute, safeStartMinute + minimumDuration));
  const durationMinutes = safeEndMinute - safeStartMinute;

  return {
    startMinute: safeStartMinute,
    endMinute: safeEndMinute,
    durationMinutes,
    slotLabel: `${formatClock(safeStartMinute)}-${formatClock(safeEndMinute)}`,
    durationLabel: formatDuration(durationMinutes),
    scheduleKind
  };
}

function getDisplayPlannedDuration(item) {
  return normalizeDurationMinutes(
    item.timing?.explicitStartMinute != null && item.timing?.explicitEndMinute != null
      ? item.timing.explicitEndMinute - item.timing.explicitStartMinute
      : item.timing?.estimateMinutes ??
          item.agenda?.durationMinutes ??
          DEFAULT_ESTIMATE_MINUTES[item.kind] ??
          DEFAULT_ESTIMATE_MINUTES.task
  );
}

function cloneAgendaEntry(agenda) {
  return agenda ? { ...agenda } : agenda;
}

function buildDisplayDay(day) {
  const scheduledItems = getDisplayItemsForDay(day);
  const agenda = summarizeAgenda(scheduledItems, day.agenda);
  const visibleItems = addVisibleAgendaLanes(sortVisibleItems(getVisibleItems(scheduledItems)));
  const visibleAgenda = summarizeAgenda(visibleItems, agenda);

  return {
    ...day,
    items: scheduledItems,
    agenda,
    visibleItems,
    visibleAgenda,
    visibleCounts: countItemsByKind(visibleItems),
    projectLabels: [...new Set(visibleItems.map((item) => item.contextLabel))]
  };
}

function buildVirtualDay(date) {
  const safeDate = clampDate(date, state.data.meta.startDate, state.data.meta.endDate);
  const [year, month, day] = safeDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return {
    date: safeDate,
    dayNumber: day,
    weekdayShort: parsed.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC"
    }),
    monthKey: safeDate.slice(0, 7),
    monthLabel: parsed.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }),
    dateLabel: formatDate(safeDate),
    items: [],
    agenda: {
      windowStartMinute: DEFAULT_SLOT_START_MINUTE,
      windowEndMinute: DEFAULT_SLOT_END_MINUTE,
      totalReservedMinutes: 0,
      windowLabel: null
    },
    visibleItems: [],
    visibleAgenda: {
      windowStartMinute: DEFAULT_SLOT_START_MINUTE,
      windowEndMinute: DEFAULT_SLOT_END_MINUTE,
      totalReservedMinutes: 0,
      windowLabel: null
    },
    visibleCounts: countItemsByKind([]),
    projectLabels: []
  };
}

function getVisibleItems(items) {
  if (!state.query) {
    return items;
  }

  return items.filter((item) => itemMatchesQuery(item, state.query));
}

function sortVisibleItems(items) {
  return [...items].sort(compareAgendaItems);
}

function compareAgendaItems(left, right) {
  const leftStart = left.agenda?.startMinute ?? Number.MAX_SAFE_INTEGER;
  const rightStart = right.agenda?.startMinute ?? Number.MAX_SAFE_INTEGER;
  const leftEnd = left.agenda?.endMinute ?? Number.MAX_SAFE_INTEGER;
  const rightEnd = right.agenda?.endMinute ?? Number.MAX_SAFE_INTEGER;

  return leftStart - rightStart || leftEnd - rightEnd || left.order - right.order;
}

function addVisibleAgendaLanes(items) {
  const assignments = new Map();
  let cluster = [];
  let clusterEndMinute = -1;

  for (const item of items) {
    if (!cluster.length || item.agenda.startMinute < clusterEndMinute) {
      cluster.push(item);
      clusterEndMinute = Math.max(clusterEndMinute, item.agenda.endMinute);
      continue;
    }

    assignClusterLanes(cluster, assignments);
    cluster = [item];
    clusterEndMinute = item.agenda.endMinute;
  }

  assignClusterLanes(cluster, assignments);

  return items.map((item) => {
    const assignment = assignments.get(item.order) ?? { lane: 0, laneCount: 1 };
    return {
      ...item,
      agenda: {
        ...item.agenda,
        lane: assignment.lane,
        laneCount: assignment.laneCount
      }
    };
  });
}

function assignClusterLanes(cluster, assignments) {
  if (!cluster.length) {
    return;
  }

  const laneEndMinutes = [];
  const localAssignments = [];

  for (const item of cluster) {
    let lane = laneEndMinutes.findIndex((endMinute) => endMinute <= item.agenda.startMinute);
    if (lane === -1) {
      lane = laneEndMinutes.length;
      laneEndMinutes.push(item.agenda.endMinute);
    } else {
      laneEndMinutes[lane] = item.agenda.endMinute;
    }

    localAssignments.push({
      order: item.order,
      lane
    });
  }

  const laneCount = laneEndMinutes.length || 1;

  for (const assignment of localAssignments) {
    assignments.set(assignment.order, {
      lane: assignment.lane,
      laneCount
    });
  }
}

function summarizeAgenda(items, fallbackAgenda) {
  if (!items.length) {
    return fallbackAgenda ?? {
      windowStartMinute: DEFAULT_SLOT_START_MINUTE,
      windowEndMinute: DEFAULT_SLOT_END_MINUTE,
      totalReservedMinutes: 0,
      windowLabel: null
    };
  }

  const firstStartMinute = Math.min(...items.map((item) => item.agenda.startMinute));
  const lastEndMinute = Math.max(...items.map((item) => item.agenda.endMinute));

  return {
    firstStartMinute,
    lastEndMinute,
    windowStartMinute: Math.floor(firstStartMinute / 60) * 60,
    windowEndMinute: Math.max(Math.ceil(lastEndMinute / 60) * 60, Math.floor(firstStartMinute / 60) * 60 + 60),
    totalReservedMinutes: items.reduce((sum, item) => sum + item.agenda.durationMinutes, 0),
    windowLabel: `${formatClock(firstStartMinute)}-${formatClock(lastEndMinute)}`
  };
}

function itemMatchesQuery(item, query) {
  const haystack = [
    item.text,
    item.contextLabel,
    item.projectLabel,
    item.categoryLabel,
    item.kind,
    item.agenda?.slotLabel,
    item.agenda?.durationLabel
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
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

function buildDaySubtitle(day) {
  if (!day.projectLabels.length) {
    return "No projects scheduled";
  }

  if (day.projectLabels.length <= 2) {
    return day.projectLabels.join(" | ");
  }

  return `${day.projectLabels[0]} | ${day.projectLabels[1]} | +${day.projectLabels.length - 2} more`;
}

function clampDate(value, min, max) {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function compareOccupiedSlots(left, right) {
  return left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.key - right.key;
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

function getTodayIsoDate() {
  return toIsoDate(new Date());
}

function getCurrentMinuteOfDay() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function getCurrentHourFloorMinute() {
  return Math.floor(getCurrentMinuteOfDay() / 60) * 60;
}

function isCurrentDay(date) {
  return date === getTodayIsoDate();
}

function getCurrentDayMarker(date) {
  if (!isCurrentDay(date)) {
    return null;
  }

  return {
    minute: normalizeMinute(getCurrentMinuteOfDay())
  };
}

function extendAgendaSummaryWithCurrentMarker(summary, currentMarkerMinute) {
  if (currentMarkerMinute == null) {
    return summary;
  }

  const markerWindowStartMinute = Math.floor(currentMarkerMinute / 60) * 60;
  const markerWindowEndMinute = Math.max(
    Math.ceil(currentMarkerMinute / 60) * 60,
    markerWindowStartMinute + 60
  );

  return {
    ...summary,
    windowStartMinute: Math.min(summary.windowStartMinute, markerWindowStartMinute),
    windowEndMinute: Math.max(summary.windowEndMinute, markerWindowEndMinute)
  };
}

function formatDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatClock(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatTodoClock(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}h${minutes}`;
}

function formatTodoDurationToken(minutes) {
  const safeMinutes = Math.max(Math.round(minutes ?? 0), MIN_SLOT_MINUTES);
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

function formatDuration(minutes) {
  const safeMinutes = Math.max(Math.round(minutes ?? 0), 0);
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

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}
