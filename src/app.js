import {
  getDashboardOverview,
  getProjectManagers,
  getProjectManager,
  getCollectors,
  getCollector,
  getClients,
  getClient,
  searchDirectory,
} from "./api.js";
import { formatDate, nextOptionIndex } from "./format.js";

const state = {
  view: "executive",
  division: "All",
  projectManagers: [],
  collectors: [],
  clientSort: "name",
  clientDirection: "asc",
  search: "",
  openClientId: null,
  openClientVersion: 0,
  searchTimer: null,
  searchActiveIndex: -1,
  loadingCount: 0,
  controllers: new Map(),
};

const dom = {
  tabs: [...document.querySelectorAll("[role='tab']")],
  views: [...document.querySelectorAll("[role='tabpanel']")],
  divisionButtons: [...document.querySelectorAll(".division-button")],
  staticDataBanner: document.querySelector("#static-data-banner"),
  loadingBanner: document.querySelector("#loading-banner"),
  errorBanner: document.querySelector("#error-banner"),
  errorMessage: document.querySelector("#error-message"),
  retryButton: document.querySelector("#retry-button"),
  search: document.querySelector("#global-search"),
  searchResults: document.querySelector("#search-results"),
  projectManagerSelect: document.querySelector("#pm-select"),
  collectorSelect: document.querySelector("#collector-select"),
  clientTableBody: document.querySelector("#client-table-body"),
  clientDialog: document.querySelector("#client-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogContent: document.querySelector("#dialog-content"),
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const bucketDefinitions = [
  { key: "current", label: "0–30", className: "bucket-current" },
  { key: "days31to60", label: "31–60", className: "bucket-31" },
  { key: "days61to90", label: "61–90", className: "bucket-61" },
  { key: "days91to120", label: "91–120", className: "bucket-91" },
  { key: "days121to180", label: "121–180", className: "bucket-121" },
  { key: "days181Plus", label: "181+", className: "bucket-181" },
];

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.id) node.id = options.id;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([name, value]) => {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    });
  }
  if (options.dataset) Object.assign(node.dataset, options.dataset);
  const childList = Array.isArray(children) ? children : [children];
  childList.filter(Boolean).forEach((child) => node.append(child));
  return node;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function formatMoney(value, compact = false) {
  const numeric = numberOrNull(value);
  if (numeric === null) return "—";
  return (compact ? compactMoney : money).format(numeric);
}

function formatPercent(value) {
  const numeric = numberOrNull(value);
  return numeric === null ? "—" : percent.format(numeric);
}

function setLoading(active) {
  state.loadingCount = Math.max(0, state.loadingCount + (active ? 1 : -1));
  dom.loadingBanner.hidden = state.loadingCount === 0;
}

function clearError() {
  dom.errorBanner.hidden = true;
}

function showError(error) {
  if (error?.name === "AbortError" || error?.code === "ABORTED") return;
  dom.errorMessage.textContent = error?.message || "The dashboard could not be loaded.";
  dom.errorBanner.hidden = false;
}

function cancelRequest(key) {
  state.controllers.get(key)?.abort();
  state.controllers.delete(key);
}

async function request(key, callback) {
  state.controllers.get(key)?.abort();
  const controller = new AbortController();
  state.controllers.set(key, controller);
  setLoading(true);
  clearError();
  try {
    const result = await callback(controller.signal);
    return state.controllers.get(key) === controller ? result : null;
  } catch (error) {
    if (state.controllers.get(key) === controller) showError(error);
    return null;
  } finally {
    if (state.controllers.get(key) === controller) state.controllers.delete(key);
    setLoading(false);
  }
}

function metricCard({ label, value, note, tone = "" }) {
  return element("article", { className: `kpi-card ${tone}`.trim() }, [
    element("p", { className: "kpi-label", text: label }),
    element("p", { className: "kpi-value", text: value }),
    element("p", { className: "kpi-note", text: note }),
  ]);
}

function renderKpis(container, metrics = {}) {
  const total = numberOrNull(metrics.totalAr);
  const prior = numberOrNull(metrics.priorTotalAr);
  const totalChange = total !== null && prior !== null ? total - prior : null;
  const over90 = numberOrNull(metrics.over90);
  const over90Share = total && over90 !== null ? over90 / total : null;
  const cards = [
    { label: "Total AR", value: formatMoney(total, true), note: totalChange === null ? "Open receivables" : `${totalChange >= 0 ? "+" : ""}${formatMoney(totalChange, true)} vs prior`, tone: "accent" },
    { label: "Collected", value: formatMoney(metrics.collected, true), note: "During comparison period", tone: "good" },
    { label: "Collection rate", value: formatPercent(metrics.collectionRate), note: "Prior-balance conversion", tone: "good" },
    { label: "91+ days", value: formatMoney(metrics.over90, true), note: over90Share === null ? "Aged exposure" : `${formatPercent(over90Share)} of total AR`, tone: "alert" },
    { label: "181+ days", value: formatMoney(metrics.over180, true), note: "Highest-risk balance", tone: "alert" },
    { label: "New billings", value: formatMoney(metrics.newBillings, true), note: "Added during period" },
  ];
  container.replaceChildren(...cards.map(metricCard));
}

function renderAging(container, aging = {}) {
  const current = aging.current || aging;
  const values = bucketDefinitions.map((bucket) => Math.max(0, numberOrNull(current?.[bucket.key]) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) {
    container.replaceChildren(element("p", { className: "empty-state", text: "No aging balances are available for this selection." }));
    return;
  }

  const bar = element("div", {
    className: "aging-bar",
    attrs: { role: "img", "aria-label": `Aging composition totaling ${formatMoney(total)}` },
  });
  values.forEach((value, index) => {
    const share = value / total;
    const segment = element("div", {
      className: `aging-segment ${bucketDefinitions[index].className}`,
      attrs: { title: `${bucketDefinitions[index].label}: ${formatMoney(value)} (${formatPercent(share)})` },
    });
    segment.style.flexBasis = `${share * 100}%`;
    if (share >= 0.085) segment.append(element("span", { text: formatPercent(share) }));
    bar.append(segment);
  });

  const legend = element("div", { className: "aging-legend" });
  bucketDefinitions.forEach((bucket, index) => {
    legend.append(element("div", { className: "legend-item" }, [
      element("span", { className: `legend-swatch ${bucket.className}`, attrs: { "aria-hidden": "true" } }),
      element("span", { text: bucket.label }),
      element("strong", { text: formatMoney(values[index], true) }),
    ]));
  });
  container.replaceChildren(element("div", { className: "aging-chart" }, [bar, legend]));
}

function renderHealth(container, health = {}) {
  const definitions = [
    { key: "onTrack", label: "On track", className: "" },
    { key: "dueSoon", label: "Due soon", className: "warn" },
    { key: "missed", label: "Missed", className: "alert" },
    { key: "escalation", label: "Escalation", className: "alert" },
  ];
  container.replaceChildren(element("div", { className: "health-grid" }, definitions.map((item) =>
    element("div", { className: `health-card ${item.className}`.trim() }, [
      element("span", { className: "health-label", text: item.label }),
      element("strong", { className: "health-value", text: numberOrNull(health[item.key]) ?? 0 }),
    ]),
  )));
}

function renderLeaders(container, leaders = {}) {
  const groups = [
    { label: "Collectors", items: leaders.collectors || [] },
    { label: "Project managers", items: leaders.projectManagers || [] },
  ];
  const wrapper = element("div", { className: "leader-groups" });
  groups.forEach((group) => {
    const section = element("section", { className: "leader-group" }, [element("h4", { text: group.label })]);
    group.items.slice(0, 3).forEach((leader, index) => {
      section.append(element("div", { className: "leader-row" }, [
        element("span", { className: "leader-rank", text: leader.rank || index + 1 }),
        element("span", { className: "leader-name", text: leader.name || "Unnamed" }),
        element("span", { className: "leader-value", text: formatMoney(leader.collected, true) }),
      ]));
    });
    if (!group.items.length) section.append(element("p", { className: "kpi-note", text: "No ranking data available." }));
    wrapper.append(section);
  });
  container.replaceChildren(wrapper);
}

function statusClass(status = "") {
  return String(status).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function statusPill(status) {
  return element("span", { className: `health-pill ${statusClass(status)}`.trim(), text: status || "Unknown" });
}

function clientSummaryButton(client) {
  const button = element("button", {
    className: "client-summary",
    type: "button",
    dataset: { clientId: client.id },
    attrs: { "aria-label": `Open details for ${client.name}` },
  }, [
    element("strong", { text: client.name || "Unnamed client" }),
    element("span", { className: "amount", text: formatMoney(client.totalAr, true) }),
    element("span", { text: `${client.projectManagerName || "Unassigned PM"} · ${client.status || "No status"}` }),
  ]);
  button.addEventListener("click", () => openClientDialog(client.id));
  return button;
}

function renderCompactClients(container, clients = []) {
  if (!clients.length) {
    container.replaceChildren(element("p", { className: "empty-state", text: "No clients are assigned to this selection." }));
    return;
  }
  container.replaceChildren(...clients.map(clientSummaryButton));
}

async function loadOverview() {
  const data = await request("overview", (signal) => getDashboardOverview({ division: state.division, signal }));
  if (!data) return;
  dom.staticDataBanner.hidden = data.dataSource !== "static-placeholder";
  renderKpis(document.querySelector("#executive-kpis"), data.metrics);
  renderAging(document.querySelector("#executive-aging"), data.aging);
  renderLeaders(document.querySelector("#executive-leaders"), data.leaders);
  renderHealth(document.querySelector("#executive-health"), data.health);
  document.querySelector("#header-total-ar").textContent = formatMoney(data.metrics?.totalAr, true);
  document.querySelector("#header-collected").textContent = formatMoney(data.metrics?.collected, true);
  document.querySelector("#header-rate").textContent = formatPercent(data.metrics?.collectionRate);
  const period = data.period || {};
  document.querySelector("#period-label").textContent = period.label || (period.asOf ? `As of ${formatDate(period.asOf)}` : "Current receivables snapshot");
}

function populateSelect(select, items, placeholder) {
  const selected = select.value;
  const options = [element("option", { text: placeholder, attrs: { value: "" } })];
  items.forEach((item) => options.push(element("option", { text: item.name, attrs: { value: item.id } })));
  select.replaceChildren(...options);
  if (items.some((item) => String(item.id) === selected)) select.value = selected;
}

async function ensureProjectManagers(force = false) {
  if (state.projectManagers.length && !force) return;
  const data = await request("project-managers", (signal) => getProjectManagers({ division: state.division, signal }));
  if (!data) return;
  state.projectManagers = data.items || [];
  populateSelect(dom.projectManagerSelect, state.projectManagers, "Choose a project manager");
}

async function ensureCollectors(force = false) {
  if (state.collectors.length && !force) return;
  const data = await request("collectors", (signal) => getCollectors({ division: state.division, signal }));
  if (!data) return;
  state.collectors = data.items || [];
  populateSelect(dom.collectorSelect, state.collectors, "Choose a collector");
}

function renderEntityDetail(prefix, data) {
  const empty = document.querySelector(`#${prefix}-empty`);
  const content = document.querySelector(`#${prefix}-content`);
  empty.hidden = true;
  content.hidden = false;
  renderKpis(document.querySelector(`#${prefix}-kpis`), data.metrics || data.entity || {});
  renderAging(document.querySelector(`#${prefix}-aging`), data.aging);
  renderHealth(document.querySelector(`#${prefix}-health`), data.health);
  renderCompactClients(document.querySelector(`#${prefix}-clients`), data.clients || []);
}

async function loadProjectManager(id) {
  if (!id) {
    cancelRequest("project-manager-detail");
    document.querySelector("#pm-empty").hidden = false;
    document.querySelector("#pm-content").hidden = true;
    return;
  }
  const data = await request("project-manager-detail", (signal) => getProjectManager(id, { division: state.division, signal }));
  if (data) renderEntityDetail("pm", data);
}

async function loadCollector(id) {
  if (!id) {
    cancelRequest("collector-detail");
    document.querySelector("#collector-empty").hidden = false;
    document.querySelector("#collector-content").hidden = true;
    return;
  }
  const data = await request("collector-detail", (signal) => getCollector(id, { division: state.division, signal }));
  if (data) renderEntityDetail("collector", data);
}

function makeCell(value, children = null) {
  const cell = element("td");
  if (children) cell.append(children);
  else cell.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
  return cell;
}

function clientRow(client) {
  const clientButton = element("button", {
    className: "client-row-button",
    type: "button",
    text: client.name,
    attrs: { "aria-label": `Open details for ${client.name}` },
  });
  const row = element("tr", {
    dataset: { clientId: client.id },
  }, [
    makeCell(null, clientButton),
    makeCell(client.projectManagerName || "Unassigned"),
    makeCell(formatMoney(client.totalAr)),
    makeCell(formatMoney(client.over90)),
    makeCell(formatDate(client.lastContactDate)),
    makeCell(null, statusPill(client.status)),
  ]);
  row.addEventListener("click", () => openClientDialog(client.id));
  return row;
}

function updateSortHeaders() {
  document.querySelectorAll(".client-table th[data-sort]").forEach((header) => {
    const active = header.dataset.sort === state.clientSort;
    header.setAttribute("aria-sort", active ? (state.clientDirection === "asc" ? "ascending" : "descending") : "none");
    const indicator = header.querySelector("span");
    if (indicator) indicator.textContent = active ? (state.clientDirection === "asc" ? "↑" : "↓") : "↕";
  });
}

async function loadClients() {
  const data = await request("clients", (signal) => getClients({
    division: state.division,
    search: state.search,
    sort: state.clientSort,
    direction: state.clientDirection,
    signal,
  }));
  if (!data) return;
  const clients = data.items || [];
  dom.clientTableBody.replaceChildren(...clients.map(clientRow));
  document.querySelector("#clients-empty").hidden = clients.length > 0;
  document.querySelector("#client-count").textContent = `${data.total ?? clients.length} open-balance client${(data.total ?? clients.length) === 1 ? "" : "s"}.`;
  updateSortHeaders();
}

function detailTable(headers, rows) {
  const table = element("table", { className: "detail-table" });
  const headerRow = element("tr", {}, headers.map((header) => element("th", { text: header, attrs: { scope: "col" } })));
  table.append(element("thead", {}, [headerRow]));
  const body = element("tbody");
  rows.forEach((cells) => {
    body.append(element("tr", {}, cells.map((cell) => element("td", { text: cell }))));
  });
  table.append(body);
  return table;
}

function showDialog() {
  if (typeof dom.clientDialog.showModal === "function") dom.clientDialog.showModal();
  else dom.clientDialog.setAttribute("open", "");
}

async function openClientDialog(id) {
  if (!id) return;
  state.openClientId = id;
  const dialogVersion = ++state.openClientVersion;
  dom.dialogTitle.textContent = "Loading client…";
  dom.dialogContent.replaceChildren(element("p", { className: "empty-state", text: "Loading account details…" }));
  showDialog();
  const data = await request("client-detail", (signal) => getClient(id, { division: state.division, signal }));
  if (state.openClientId !== id || state.openClientVersion !== dialogVersion) return;
  if (!data) {
    const retry = element("button", { className: "dialog-retry", type: "button", text: "Try loading this client again" });
    retry.addEventListener("click", () => openClientDialog(id));
    dom.dialogTitle.textContent = "Client detail unavailable";
    dom.dialogContent.replaceChildren(element("div", { className: "dialog-error" }, [
      element("p", { text: "This client could not be loaded. Check the connection, then try again." }),
      retry,
    ]));
    return;
  }
  const client = data.client || {};
  dom.dialogTitle.textContent = client.name || "Client detail";

  const meta = element("div", { className: "dialog-meta" }, [
    element("span", { text: `Division: ${client.division || "—"}` }),
    element("span", { text: `Project manager: ${client.projectManagerName || "Unassigned"}` }),
    element("span", { text: `Collector: ${client.collectorName || "Unassigned"}` }),
    element("span", { text: `Last contact: ${formatDate(client.lastContactDate)}` }),
  ]);
  const dialogKpis = element("div", { className: "kpi-grid" });
  dialogKpis.replaceChildren(
    metricCard({ label: "Total AR", value: formatMoney(client.totalAr, true), note: "Open balance", tone: "accent" }),
    metricCard({ label: "91+ days", value: formatMoney(client.over90, true), note: "Aged exposure", tone: "alert" }),
    metricCard({ label: "181+ days", value: formatMoney(client.over180, true), note: "Highest risk", tone: "alert" }),
    metricCard({ label: "Health", value: client.status || "—", note: client.billingContact || "No billing contact" }),
  );
  const agingSection = element("section", { className: "dialog-section" }, [element("h3", { text: "Aging composition" })]);
  const agingContainer = element("div");
  renderAging(agingContainer, data.aging);
  agingSection.append(agingContainer);

  const invoices = data.invoices || [];
  const projects = data.projects || [];
  const invoiceSection = element("section", { className: "dialog-section" }, [
    element("h3", { text: `Invoices (${invoices.length})` }),
    invoices.length
      ? detailTable(["Invoice", "Project", "Due", "Balance"], invoices.map((invoice) => [invoice.number || invoice.id, invoice.projectName || invoice.projectId || "—", formatDate(invoice.dueDate), formatMoney(invoice.balance)]))
      : element("p", { className: "kpi-note", text: "No open invoices." }),
  ]);
  const projectSection = element("section", { className: "dialog-section" }, [
    element("h3", { text: `Projects (${projects.length})` }),
    projects.length
      ? detailTable(["Project", "Total AR", "91+"], projects.map((project) => [project.name || project.number || project.id, formatMoney(project.totalAr), formatMoney(project.over90)]))
      : element("p", { className: "kpi-note", text: "No open projects." }),
  ]);

  dom.dialogContent.replaceChildren(meta, dialogKpis, agingSection, element("div", { className: "dialog-tables" }, [invoiceSection, projectSection]));
}

function closeSearchResults() {
  state.searchActiveIndex = -1;
  dom.searchResults.hidden = true;
  dom.search.setAttribute("aria-expanded", "false");
  dom.search.removeAttribute("aria-activedescendant");
}

function searchResultButton(item, index) {
  const readableType = item.type === "projectManager" ? "Project manager" : item.type;
  const button = element("button", {
    className: "search-result",
    type: "button",
    id: `search-option-${index}`,
    attrs: { role: "option", "aria-selected": "false" },
  }, [
    element("span", { className: "search-type", text: readableType }),
    element("span", { className: "search-name", text: item.name }),
    element("span", { className: "search-detail", text: item.detail || "" }),
  ]);
  button.addEventListener("click", async () => {
    closeSearchResults();
    dom.search.value = item.name || "";
    state.search = "";
    if (item.type === "client") {
      activateView("clients");
      await loadClients();
      openClientDialog(item.id);
    } else if (item.type === "projectManager") {
      activateView("pm");
      await ensureProjectManagers();
      dom.projectManagerSelect.value = item.id;
      loadProjectManager(item.id);
    } else if (item.type === "collector") {
      activateView("collectors");
      await ensureCollectors();
      dom.collectorSelect.value = item.id;
      loadCollector(item.id);
    }
  });
  return button;
}

function moveSearchSelection(direction) {
  const options = [...dom.searchResults.querySelectorAll("[role='option']")];
  if (!options.length || dom.searchResults.hidden) return;
  state.searchActiveIndex = nextOptionIndex(state.searchActiveIndex, direction, options.length);
  options.forEach((option, index) => {
    option.setAttribute("aria-selected", String(index === state.searchActiveIndex));
  });
  const active = options[state.searchActiveIndex];
  dom.search.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

async function runSearch() {
  const query = dom.search.value.trim();
  state.search = query;
  if (state.view === "clients") loadClients();
  if (query.length < 2) {
    state.controllers.get("directory-search")?.abort();
    closeSearchResults();
    return;
  }
  const data = await request("directory-search", (signal) => searchDirectory(query, { division: state.division, signal }));
  if (!data || dom.search.value.trim() !== query) return;
  const items = data.items || [];
  dom.searchResults.replaceChildren(...(items.length
    ? items.map(searchResultButton)
    : [element("p", { className: "search-result", text: "No directory matches found.", attrs: { role: "status" } })]));
  state.searchActiveIndex = -1;
  dom.searchResults.hidden = false;
  dom.search.setAttribute("aria-expanded", "true");
}

function activateView(view) {
  state.view = view;
  dom.tabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  dom.views.forEach((panel) => {
    const active = panel.id === `view-${view}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function closeClientDialog() {
  state.openClientId = null;
  state.openClientVersion += 1;
  cancelRequest("client-detail");
  if (dom.clientDialog.open && typeof dom.clientDialog.close === "function") {
    dom.clientDialog.close();
  } else {
    dom.clientDialog.removeAttribute("open");
  }
}

async function loadActiveView(force = false) {
  if (state.view === "executive") return loadOverview();
  if (state.view === "pm") {
    await ensureProjectManagers(force);
    return loadProjectManager(dom.projectManagerSelect.value);
  }
  if (state.view === "collectors") {
    await ensureCollectors(force);
    return loadCollector(dom.collectorSelect.value);
  }
  return loadClients();
}

function bindEvents() {
  dom.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      activateView(tab.dataset.view);
      loadActiveView();
    });
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = dom.tabs[(index + offset + dom.tabs.length) % dom.tabs.length];
      next.focus();
      next.click();
    });
  });

  dom.divisionButtons.forEach((button) => button.addEventListener("click", async () => {
    cancelRequest("project-manager-detail");
    cancelRequest("collector-detail");
    closeClientDialog();
    state.division = button.dataset.division;
    dom.divisionButtons.forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    state.projectManagers = [];
    state.collectors = [];
    dom.projectManagerSelect.value = "";
    dom.collectorSelect.value = "";
    closeSearchResults();
    await loadOverview();
    if (state.view !== "executive") await loadActiveView(true);
  }));

  dom.projectManagerSelect.addEventListener("change", () => loadProjectManager(dom.projectManagerSelect.value));
  dom.collectorSelect.addEventListener("change", () => loadCollector(dom.collectorSelect.value));
  dom.search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(runSearch, 220);
  });
  dom.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearchResults();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchSelection(event.key === "ArrowDown" ? 1 : -1);
    }
    if (event.key === "Enter" && state.searchActiveIndex >= 0) {
      event.preventDefault();
      dom.searchResults.querySelectorAll("[role='option']")[state.searchActiveIndex]?.click();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-control")) closeSearchResults();
  });
  document.querySelector("#print-button").addEventListener("click", () => window.print());
  dom.retryButton.addEventListener("click", () => loadActiveView(true));

  document.querySelectorAll(".client-table th[data-sort] button").forEach((button) => {
    button.addEventListener("click", () => {
      const sort = button.closest("th").dataset.sort;
      if (state.clientSort === sort) state.clientDirection = state.clientDirection === "asc" ? "desc" : "asc";
      else {
        state.clientSort = sort;
        state.clientDirection = sort === "name" ? "asc" : "desc";
      }
      loadClients();
    });
  });

  document.querySelector("#dialog-close").addEventListener("click", closeClientDialog);
  dom.clientDialog.addEventListener("click", (event) => {
    if (event.target === dom.clientDialog) closeClientDialog();
  });
  dom.clientDialog.addEventListener("close", () => {
    state.openClientId = null;
    cancelRequest("client-detail");
  });
}

async function init() {
  bindEvents();
  activateView("executive");
  await loadOverview();
}

init();
