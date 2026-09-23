import {
  MOCK_CLIENTS,
  MOCK_COLLECTORS,
  MOCK_INVOICES,
  MOCK_PERIOD,
  MOCK_PROJECT_MANAGERS,
  MOCK_PROJECTS,
} from "./mock-data.js";

const ROUTES = Object.freeze({
  overview: "/v1/dashboard/overview",
  projectManagers: "/v1/project-managers",
  collectors: "/v1/collectors",
  clients: "/v1/clients",
  directorySearch: "/v1/directory/search",
});

const AGING_KEYS = Object.freeze([
  "current",
  "days31to60",
  "days61to90",
  "days91to120",
  "days121to180",
  "days181Plus",
]);

const CLIENT_SORTS = new Set([
  "name",
  "projectManagerName",
  "totalAr",
  "over90",
  "over180",
  "status",
  "lastContactDate",
]);

const DEFAULT_CLIENT_SORT = "over90";
const DEFAULT_SORT_DIRECTION = "desc";
const API_MODES = new Set(["auto", "mock", "remote"]);
const AGING_BUCKET_META = Object.freeze({
  current: { label: "Current", ageDays: 15 },
  days31to60: { label: "31-60", ageDays: 45 },
  days61to90: { label: "61-90", ageDays: 75 },
  days91to120: { label: "91-120", ageDays: 105 },
  days121to180: { label: "121-180", ageDays: 150 },
  days181Plus: { label: "181+", ageDays: 210 },
});

let overrides = {};

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.code = options.code ?? "API_ERROR";
    this.status = options.status ?? null;
    this.endpoint = options.endpoint ?? null;
    this.details = options.details ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Overrides runtime configuration. Intended for app bootstrapping and tests.
 * Calling with no arguments clears all overrides.
 */
export function configureApi(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("configureApi options must be an object.");
  }

  if (options.mode !== undefined && !API_MODES.has(options.mode)) {
    throw new TypeError('API mode must be "auto", "mock", or "remote".');
  }

  if (options.baseUrl !== undefined && typeof options.baseUrl !== "string") {
    throw new TypeError("API baseUrl must be a string.");
  }

  if (options.fetchImpl !== undefined && typeof options.fetchImpl !== "function") {
    throw new TypeError("API fetchImpl must be a function.");
  }

  overrides = { ...options };
}

export function getApiConfig() {
  const runtime = isRecord(globalThis.AR_API_CONFIG) ? globalThis.AR_API_CONFIG : {};
  const baseUrl = cleanBaseUrl(
    overrides.baseUrl ??
      runtime.baseUrl ??
      globalThis.AR_API_BASE_URL ??
      readMetaContent("ar-api-base-url") ??
      "",
  );
  const requestedMode = overrides.mode ?? runtime.mode ?? "auto";
  if (!API_MODES.has(requestedMode)) {
    throw new ApiError('Resolved API mode must be "auto", "mock", or "remote".', {
      code: "API_CONFIG_ERROR",
      details: { mode: requestedMode },
    });
  }
  const mode = requestedMode === "auto" ? (baseUrl ? "remote" : "mock") : requestedMode;

  return Object.freeze({ baseUrl, mode });
}

export async function getDashboardOverview({ division = "all", signal } = {}) {
  const normalizedDivision = normalizeDivision(division);
  return request({
    route: ROUTES.overview,
    query: { division: normalizedDivision },
    signal,
    mock: () => buildOverview(normalizedDivision),
    normalize: normalizeOverview,
  });
}

export async function getProjectManagers({ division = "all", signal } = {}) {
  const normalizedDivision = normalizeDivision(division);
  return request({
    route: ROUTES.projectManagers,
    query: { division: normalizedDivision },
    signal,
    mock: () => ({ items: buildProjectManagerSummaries(normalizedDivision) }),
    normalize: (payload, endpoint) =>
      normalizeList(payload, endpoint, "project managers", validateProjectManagerSummary),
  });
}

export async function getProjectManager(id, { division = "all", signal } = {}) {
  const entityId = requireId(id, "Project manager");
  const normalizedDivision = normalizeDivision(division);
  return request({
    route: `${ROUTES.projectManagers}/${encodeURIComponent(entityId)}`,
    query: { division: normalizedDivision },
    signal,
    mock: () => buildEntityDetail("projectManager", entityId, normalizedDivision),
    normalize: (payload, endpoint) => normalizeEntityDetail(payload, endpoint, "projectManager"),
  });
}

export async function getCollectors({ division = "all", signal } = {}) {
  const normalizedDivision = normalizeDivision(division);
  return request({
    route: ROUTES.collectors,
    query: { division: normalizedDivision },
    signal,
    mock: () => ({ items: buildCollectorSummaries(normalizedDivision) }),
    normalize: (payload, endpoint) =>
      normalizeList(payload, endpoint, "collectors", validateCollectorSummary),
  });
}

export async function getCollector(id, { division = "all", signal } = {}) {
  const entityId = requireId(id, "Collector");
  const normalizedDivision = normalizeDivision(division);
  return request({
    route: `${ROUTES.collectors}/${encodeURIComponent(entityId)}`,
    query: { division: normalizedDivision },
    signal,
    mock: () => buildEntityDetail("collector", entityId, normalizedDivision),
    normalize: (payload, endpoint) => normalizeEntityDetail(payload, endpoint, "collector"),
  });
}

export async function getClients({
  division = "all",
  search = "",
  sort = DEFAULT_CLIENT_SORT,
  direction = DEFAULT_SORT_DIRECTION,
  signal,
} = {}) {
  const normalizedDivision = normalizeDivision(division);
  const normalizedSearch = String(search ?? "").trim();
  const normalizedSort = normalizeClientSort(sort);
  const normalizedDirection = normalizeSortDirection(direction);

  return request({
    route: ROUTES.clients,
    query: {
      division: normalizedDivision,
      search: normalizedSearch || undefined,
      sort: normalizedSort,
      direction: normalizedDirection,
    },
    signal,
    mock: () =>
      buildClients(normalizedDivision, normalizedSearch, normalizedSort, normalizedDirection),
    normalize: normalizeClients,
  });
}

export async function getClient(id, { division = "all", signal } = {}) {
  const clientId = requireId(id, "Client");
  const normalizedDivision = normalizeDivision(division);
  return request({
    route: `${ROUTES.clients}/${encodeURIComponent(clientId)}`,
    query: { division: normalizedDivision },
    signal,
    mock: () => buildClientDetail(clientId, normalizedDivision),
    normalize: normalizeClientDetail,
  });
}

export async function searchDirectory(query, { division = "all", signal } = {}) {
  const normalizedDivision = normalizeDivision(division);
  const normalizedQuery = String(query ?? "").trim();

  if (!normalizedQuery) {
    throwIfAborted(signal, ROUTES.directorySearch);
    return { items: [] };
  }

  return request({
    route: ROUTES.directorySearch,
    query: { q: normalizedQuery, division: normalizedDivision },
    signal,
    mock: () => buildDirectoryResults(normalizedQuery, normalizedDivision),
    normalize: normalizeDirectoryResults,
  });
}

async function request({ route, query, signal, mock, normalize }) {
  const config = getApiConfig();
  throwIfAborted(signal, route);

  if (config.mode === "mock") {
    const payload = mock();
    throwIfAborted(signal, route);
    return clone(normalize(payload, route));
  }

  if (!config.baseUrl) {
    throw new ApiError("Remote API mode requires a configured base URL.", {
      code: "API_CONFIG_ERROR",
      endpoint: route,
    });
  }

  const url = buildUrl(config.baseUrl, route, query);
  const fetchImpl = overrides.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ApiError("No Fetch API implementation is available.", {
      code: "API_CONFIG_ERROR",
      endpoint: url,
    });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw abortedError(url, error);
    }
    throw new ApiError("The AR data service could not be reached.", {
      code: "NETWORK_ERROR",
      endpoint: url,
      retryable: true,
      cause: error,
    });
  }

  if (!response || typeof response.ok !== "boolean") {
    throw new ApiError("The AR data service returned an invalid HTTP response.", {
      code: "INVALID_HTTP_RESPONSE",
      endpoint: url,
    });
  }

  if (!response.ok) {
    const details = await readErrorBody(response);
    const message =
      (isRecord(details) && typeof details.message === "string" && details.message) ||
      `The AR data service returned HTTP ${response.status}.`;
    throw new ApiError(message, {
      code: (isRecord(details) && details.code) || "HTTP_ERROR",
      status: response.status,
      endpoint: url,
      details,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError("The AR data service did not return valid JSON.", {
      code: "INVALID_JSON",
      status: response.status,
      endpoint: url,
      cause: error,
    });
  }

  try {
    return normalize(payload, url);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("The AR data service returned an unexpected response shape.", {
      code: "INVALID_RESPONSE",
      status: response.status,
      endpoint: url,
      cause: error,
    });
  }
}

function buildOverview(division) {
  const clients = filteredClients(division);
  const projectManagers = buildProjectManagerSummaries(division);
  const collectors = buildCollectorSummaries(division);
  const current = sumAging(clients, "aging");
  const previous = sumAging(clients, "previousAging");
  const totalAr = agingTotal(current);
  const priorTotalAr = agingTotal(previous);
  const collected = projectManagers.reduce((sum, item) => sum + item.collected, 0);

  return {
    period: MOCK_PERIOD,
    division,
    metrics: {
      totalAr,
      priorTotalAr,
      collected,
      collectionRate: priorTotalAr ? collected / priorTotalAr : 0,
      over90: over90Total(current),
      over180: current.days181Plus,
      newBillings: Math.max(0, totalAr + collected - priorTotalAr),
      projectManagersAtRisk: projectManagers.filter((item) => item.status === "Needs attention")
        .length,
    },
    aging: { current, previous },
    leaders: {
      collectors: rankLeadersByCollected(collectors),
      projectManagers: rankLeadersByCollected(projectManagers),
    },
    health: healthCounts(clients),
  };
}

function rankLeadersByCollected(items) {
  return items
    .slice()
    .sort(byCollected)
    .slice(0, 3)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildProjectManagerSummaries(division) {
  const managers = MOCK_PROJECT_MANAGERS.filter((item) => matchesDivision(item, division));
  return managers
    .map((manager) => summarizeEntity(manager, clientsFor("projectManagerId", manager.id)))
    .sort(byTotalAr)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildCollectorSummaries(division) {
  const collectors = MOCK_COLLECTORS.filter((item) => matchesDivision(item, division));
  return collectors
    .map((collector) => summarizeEntity(collector, clientsFor("collectorId", collector.id)))
    .sort(byTotalAr)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function summarizeEntity(entity, clients) {
  const current = sumAging(clients, "aging");
  const previous = sumAging(clients, "previousAging");
  const totalAr = agingTotal(current);
  const priorTotalAr = agingTotal(previous);
  return {
    ...entity,
    totalAr,
    priorTotalAr,
    collectionRate: priorTotalAr ? entity.collected / priorTotalAr : 0,
    over90: over90Total(current),
    over180: current.days181Plus,
    clientCount: clients.length,
  };
}

function buildEntityDetail(type, id, division) {
  const isManager = type === "projectManager";
  const source = isManager ? buildProjectManagerSummaries(division) : buildCollectorSummaries(division);
  const entity = source.find((item) => item.id === id);
  if (!entity) throw notFound(isManager ? "Project manager" : "Collector", id);

  const foreignKey = isManager ? "projectManagerId" : "collectorId";
  const clients = MOCK_CLIENTS.filter((client) => client[foreignKey] === id).map(toClientSummary);
  const current = sumAging(clients, "aging");
  const previous = sumAging(
    MOCK_CLIENTS.filter((client) => client[foreignKey] === id),
    "previousAging",
  );

  return {
    entity,
    metrics: {
      totalAr: entity.totalAr,
      priorTotalAr: entity.priorTotalAr,
      collected: entity.collected,
      collectionRate: entity.collectionRate,
      over90: entity.over90,
      over180: entity.over180,
      newBillings: Math.max(0, entity.totalAr + entity.collected - entity.priorTotalAr),
    },
    aging: { current, previous },
    clients,
    health: healthCounts(clients),
  };
}

function buildClients(division, search, sort, direction) {
  const needle = search.toLocaleLowerCase();
  const clients = filteredClients(division)
    .map(toClientSummary)
    .filter((client) => {
      if (!needle) return true;
      return [
        client.name,
        client.projectManagerName,
        client.collectorName,
        client.billingContact,
      ].some((value) => String(value).toLocaleLowerCase().includes(needle));
    });

  clients.sort((left, right) => compareClientValues(left, right, sort, direction));
  return { items: clients, total: clients.length };
}

function buildClientDetail(id, division) {
  const source = MOCK_CLIENTS.find((item) => item.id === id && matchesDivision(item, division));
  if (!source) throw notFound("Client", id);
  const client = toClientSummary(source);
  const invoices = reconcileMockInvoices(source, MOCK_INVOICES[id] ?? []);
  const baseProjects = clone(MOCK_PROJECTS[id] ?? []);
  if (invoices.some((invoice) => invoice.inferred)) {
    baseProjects.push({
      id: unallocatedProjectId(id),
      number: "UNALLOCATED",
      name: "Unallocated AR",
      inferred: true,
    });
  }
  const projects = baseProjects.map((project) => {
    const projectInvoices = invoices.filter((invoice) => invoice.projectId === project.id);
    return {
      ...project,
      projectManagerId: client.projectManagerId,
      projectManagerName: client.projectManagerName,
      totalAr: projectInvoices.reduce((sum, invoice) => sum + invoice.balance, 0),
      over90: projectInvoices
        .filter((invoice) => invoice.ageDays > 90)
        .reduce((sum, invoice) => sum + invoice.balance, 0),
    };
  });

  return {
    client,
    aging: { current: client.aging, previous: clone(source.previousAging) },
    invoices,
    projects,
  };
}

function reconcileMockInvoices(client, sourceInvoices) {
  const invoices = clone(sourceInvoices);
  const represented = Object.fromEntries(AGING_KEYS.map((key) => [key, 0]));

  for (const invoice of invoices) {
    const key = agingKeyForLabel(invoice.agingBucket);
    if (key) represented[key] = roundMoney(represented[key] + invoice.balance);
  }

  for (const key of AGING_KEYS) {
    const difference = roundMoney(Number(client.aging[key] ?? 0) - represented[key]);
    if (difference < 0) {
      throw new ApiError(`Mock invoices exceed ${key} aging for ${client.id}.`, {
        code: "MOCK_RECONCILIATION_ERROR",
        details: { clientId: client.id, agingBucket: key, difference },
      });
    }
    if (difference === 0) continue;

    const metadata = AGING_BUCKET_META[key];
    const invoiceDate = shiftIsoDate(MOCK_PERIOD.asOf, -metadata.ageDays);
    invoices.push({
      id: `inv-${client.id}-unallocated-${key}`,
      number: `UNALLOCATED-${metadata.label.toLocaleUpperCase()}`,
      projectId: unallocatedProjectId(client.id),
      projectName: "Unallocated AR",
      invoiceDate,
      dueDate: shiftIsoDate(invoiceDate, 30),
      amount: difference,
      balance: difference,
      ageDays: metadata.ageDays,
      agingBucket: metadata.label,
      status: metadata.ageDays > 90 ? "Overdue" : "Open",
      inferred: true,
    });
  }

  return invoices;
}

function agingKeyForLabel(label) {
  return Object.entries(AGING_BUCKET_META).find(([, value]) => value.label === label)?.[0] ?? null;
}

function unallocatedProjectId(clientId) {
  return `project-${clientId}-unallocated`;
}

function shiftIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildDirectoryResults(query, division) {
  const needle = query.toLocaleLowerCase();
  const hasNeedle = (value) => value.toLocaleLowerCase().includes(needle);
  const clients = filteredClients(division)
    .filter((item) => hasNeedle(item.name))
    .map((item) => ({
      type: "client",
      id: item.id,
      name: item.name,
      detail: `${item.division} · ${item.projectManagerName}`,
    }));
  const projectManagers = MOCK_PROJECT_MANAGERS.filter(
    (item) => matchesDivision(item, division) && hasNeedle(item.name),
  ).map((item) => ({
    type: "projectManager",
    id: item.id,
    name: item.name,
    detail: `${item.division} · ${item.collectorName}`,
  }));
  const collectors = MOCK_COLLECTORS.filter(
    (item) => matchesDivision(item, division) && hasNeedle(item.name),
  ).map((item) => ({
    type: "collector",
    id: item.id,
    name: item.name,
    detail: `${item.division} · Collector`,
  }));

  return { items: [...clients, ...projectManagers, ...collectors].slice(0, 12) };
}

function toClientSummary(client) {
  const totalAr = agingTotal(client.aging);
  return {
    id: client.id,
    name: client.name,
    division: client.division,
    projectManagerId: client.projectManagerId,
    projectManagerName: client.projectManagerName,
    collectorId: client.collectorId,
    collectorName: client.collectorName,
    totalAr,
    over90: over90Total(client.aging),
    over180: client.aging.days181Plus,
    status: client.status,
    lastContactDate: client.lastContactDate,
    billingContact: client.billingContact,
    aging: clone(client.aging),
  };
}

function normalizeOverview(payload, endpoint) {
  const value = unwrap(payload);
  assertRecord(value, endpoint, "dashboard overview");
  assertRecord(value.period, endpoint, "dashboard overview.period");
  for (const key of ["asOf", "comparisonDate", "label"]) {
    assertString(value.period, key, endpoint, "dashboard overview.period");
  }
  assertString(value, "division", endpoint, "dashboard overview");
  assertRecord(value.metrics, endpoint, "dashboard overview.metrics");
  for (const key of [
    "totalAr",
    "priorTotalAr",
    "collected",
    "collectionRate",
    "over90",
    "over180",
    "newBillings",
    "projectManagersAtRisk",
  ]) {
    assertFiniteNumber(value.metrics, key, endpoint, "dashboard overview.metrics");
  }
  assertNonNegativeInteger(
    value.metrics,
    "projectManagersAtRisk",
    endpoint,
    "dashboard overview.metrics",
  );
  validateAgingComparison(value.aging, endpoint, "dashboard overview.aging");
  assertRecord(value.leaders, endpoint, "dashboard overview.leaders");
  validateArray(
    value.leaders.collectors,
    endpoint,
    "dashboard overview.leaders.collectors",
    validateCollectorSummary,
  );
  validateArray(
    value.leaders.projectManagers,
    endpoint,
    "dashboard overview.leaders.projectManagers",
    validateProjectManagerSummary,
  );
  validateHealth(value.health, endpoint, "dashboard overview.health");
  return value;
}

function normalizeList(payload, endpoint, label, validator) {
  const value = unwrap(payload);
  const envelope = Array.isArray(value) ? { items: value } : value;
  assertRecord(envelope, endpoint, label);
  validateArray(envelope.items, endpoint, `${label}.items`, validator);
  return { ...envelope, items: envelope.items };
}

function normalizeClients(payload, endpoint) {
  const envelope = normalizeList(payload, endpoint, "clients", validateClientSummary);
  const total = envelope.total === undefined ? envelope.items.length : Number(envelope.total);
  if (!Number.isInteger(total) || total < envelope.items.length) {
    invalidResponse(endpoint, "clients.total must be an integer at least as large as items.length.");
  }
  return { ...envelope, total };
}

function normalizeEntityDetail(payload, endpoint, type) {
  const value = unwrap(payload);
  assertRecord(value, endpoint, "entity detail");
  const entityValidator =
    type === "projectManager" ? validateProjectManagerSummary : validateCollectorSummary;
  entityValidator(value.entity, endpoint, "entity detail.entity");
  assertRecord(value.metrics, endpoint, "entity detail.metrics");
  for (const key of [
    "totalAr",
    "priorTotalAr",
    "collected",
    "collectionRate",
    "over90",
    "over180",
    "newBillings",
  ]) {
    assertFiniteNumber(value.metrics, key, endpoint, "entity detail.metrics");
  }
  validateAgingComparison(value.aging, endpoint, "entity detail.aging");
  validateArray(value.clients, endpoint, "entity detail.clients", validateClientSummary);
  validateHealth(value.health, endpoint, "entity detail.health");
  return value;
}

function normalizeClientDetail(payload, endpoint) {
  const value = unwrap(payload);
  assertRecord(value, endpoint, "client detail");
  validateClientSummary(value.client, endpoint, "client detail.client");
  validateAgingComparison(value.aging, endpoint, "client detail.aging");
  validateArray(value.invoices, endpoint, "client detail.invoices", validateInvoice);
  validateArray(value.projects, endpoint, "client detail.projects", validateProject);
  return value;
}

function normalizeDirectoryResults(payload, endpoint) {
  return normalizeList(payload, endpoint, "directory results", validateDirectoryResult);
}

function validateProjectManagerSummary(value, endpoint, label = "project manager") {
  validateEntitySummary(value, endpoint, label);
  assertString(value, "collectorId", endpoint, label);
  assertString(value, "collectorName", endpoint, label);
}

function validateCollectorSummary(value, endpoint, label = "collector") {
  validateEntitySummary(value, endpoint, label);
}

function validateEntitySummary(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  for (const key of ["id", "name", "division", "status"]) {
    assertString(value, key, endpoint, label);
  }
  for (const key of [
    "totalAr",
    "priorTotalAr",
    "collected",
    "collectionRate",
    "over90",
    "over180",
    "clientCount",
    "rank",
  ]) {
    assertFiniteNumber(value, key, endpoint, label);
  }
  assertNonNegativeInteger(value, "clientCount", endpoint, label);
  assertNonNegativeInteger(value, "rank", endpoint, label);
}

function validateClientSummary(value, endpoint, label = "client") {
  assertRecord(value, endpoint, label);
  for (const key of [
    "id",
    "name",
    "division",
    "projectManagerId",
    "projectManagerName",
    "collectorId",
    "collectorName",
    "status",
    "lastContactDate",
    "billingContact",
  ]) {
    assertString(value, key, endpoint, label);
  }
  for (const key of ["totalAr", "over90", "over180"]) {
    assertFiniteNumber(value, key, endpoint, label);
  }
  validateAging(value.aging, endpoint, `${label}.aging`);
}

function validateInvoice(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  for (const key of [
    "id",
    "number",
    "projectId",
    "projectName",
    "invoiceDate",
    "dueDate",
    "agingBucket",
    "status",
  ]) {
    assertString(value, key, endpoint, label);
  }
  for (const key of ["amount", "balance", "ageDays"]) {
    assertFiniteNumber(value, key, endpoint, label);
  }
  assertNonNegativeInteger(value, "ageDays", endpoint, label);
  assertOptionalBoolean(value, "inferred", endpoint, label);
}

function validateProject(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  for (const key of ["id", "number", "name", "projectManagerId", "projectManagerName"]) {
    assertString(value, key, endpoint, label);
  }
  for (const key of ["totalAr", "over90"]) {
    assertFiniteNumber(value, key, endpoint, label);
  }
  assertOptionalBoolean(value, "inferred", endpoint, label);
}

function validateDirectoryResult(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  for (const key of ["id", "name", "detail"]) assertString(value, key, endpoint, label);
  assertString(value, "type", endpoint, label);
  if (!["client", "projectManager", "collector"].includes(value.type)) {
    invalidResponse(endpoint, `${label}.type has an unsupported value.`);
  }
}

function validateAgingComparison(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  validateAging(value.current, endpoint, `${label}.current`);
  validateAging(value.previous, endpoint, `${label}.previous`);
}

function validateAging(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  for (const key of AGING_KEYS) assertFiniteNumber(value, key, endpoint, label);
}

function validateHealth(value, endpoint, label) {
  assertRecord(value, endpoint, label);
  for (const key of ["onTrack", "dueSoon", "missed", "escalation"]) {
    assertFiniteNumber(value, key, endpoint, label);
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      invalidResponse(endpoint, `${label}.${key} must be a non-negative integer.`);
    }
  }
}

function validateArray(value, endpoint, label, validator) {
  if (!Array.isArray(value)) invalidResponse(endpoint, `${label} must be an array.`);
  value.forEach((item, index) => validator(item, endpoint, `${label}[${index}]`));
}

function assertString(value, key, endpoint, label) {
  if (typeof value[key] !== "string" || !value[key].trim()) {
    invalidResponse(endpoint, `${label}.${key} must be a non-empty string.`);
  }
}

function assertFiniteNumber(value, key, endpoint, label) {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
    invalidResponse(endpoint, `${label}.${key} must be a finite number.`);
  }
}

function assertOptionalBoolean(value, key, endpoint, label) {
  if (value[key] !== undefined && typeof value[key] !== "boolean") {
    invalidResponse(endpoint, `${label}.${key} must be a boolean when present.`);
  }
}

function assertNonNegativeInteger(value, key, endpoint, label) {
  if (!Number.isInteger(value[key]) || value[key] < 0) {
    invalidResponse(endpoint, `${label}.${key} must be a non-negative integer.`);
  }
}

function unwrap(payload) {
  return isRecord(payload) && Object.hasOwn(payload, "data") ? payload.data : payload;
}

function buildUrl(baseUrl, route, query) {
  const url = `${baseUrl}${route}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  return search.size ? `${url}?${search.toString()}` : url;
}

function cleanBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function readMetaContent(name) {
  try {
    return globalThis.document?.querySelector?.(`meta[name="${name}"]`)?.content;
  } catch {
    return undefined;
  }
}

function normalizeDivision(value) {
  const division = String(value ?? "all").trim();
  if (!division || division.toLocaleLowerCase() === "all") return "all";
  return division.toLocaleUpperCase();
}

function normalizeClientSort(value) {
  const sort = String(value ?? DEFAULT_CLIENT_SORT).trim();
  if (!CLIENT_SORTS.has(sort)) {
    throw new TypeError(`Unsupported client sort: ${sort}.`);
  }
  return sort;
}

function normalizeSortDirection(value) {
  const direction = String(value ?? DEFAULT_SORT_DIRECTION).trim().toLocaleLowerCase();
  if (direction !== "asc" && direction !== "desc") {
    throw new TypeError('Sort direction must be "asc" or "desc".');
  }
  return direction;
}

function requireId(value, label) {
  const id = String(value ?? "").trim();
  if (!id) throw new TypeError(`${label} id is required.`);
  return id;
}

function filteredClients(division) {
  return MOCK_CLIENTS.filter((item) => matchesDivision(item, division));
}

function matchesDivision(item, division) {
  return division === "all" || item.division === division;
}

function clientsFor(key, id) {
  return MOCK_CLIENTS.filter((client) => client[key] === id);
}

function emptyAging() {
  return Object.fromEntries(AGING_KEYS.map((key) => [key, 0]));
}

function sumAging(items, field) {
  return items.reduce((totals, item) => {
    for (const key of AGING_KEYS) totals[key] += Number(item[field]?.[key] ?? 0);
    return totals;
  }, emptyAging());
}

function agingTotal(value) {
  return AGING_KEYS.reduce((sum, key) => sum + Number(value[key] ?? 0), 0);
}

function over90Total(value) {
  return (
    Number(value.days91to120 ?? 0) +
    Number(value.days121to180 ?? 0) +
    Number(value.days181Plus ?? 0)
  );
}

function healthCounts(clients) {
  const result = { onTrack: 0, dueSoon: 0, missed: 0, escalation: 0 };
  for (const client of clients) {
    const key =
      {
        "On track": "onTrack",
        "Due soon": "dueSoon",
        Missed: "missed",
        Escalation: "escalation",
      }[client.status] ?? "missed";
    result[key] += 1;
  }
  return result;
}

function compareClientValues(left, right, sort, direction) {
  const leftValue = left[sort];
  const rightValue = right[sort];
  let result;
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    result = leftValue - rightValue;
  } else {
    result = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }
  if (result === 0) result = left.name.localeCompare(right.name);
  return direction === "asc" ? result : -result;
}

function byCollected(left, right) {
  return right.collected - left.collected || left.name.localeCompare(right.name);
}

function byTotalAr(left, right) {
  return right.totalAr - left.totalAr || left.name.localeCompare(right.name);
}

function throwIfAborted(signal, endpoint) {
  if (signal?.aborted) throw abortedError(endpoint, signal.reason);
}

function abortedError(endpoint, cause) {
  return new ApiError("The AR data request was cancelled.", {
    code: "ABORTED",
    endpoint,
    cause: cause instanceof Error ? cause : undefined,
  });
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function notFound(label, id) {
  return new ApiError(`${label} was not found.`, {
    code: "NOT_FOUND",
    status: 404,
    details: { id },
  });
}

function invalidResponse(endpoint, message) {
  throw new ApiError(message, { code: "INVALID_RESPONSE", endpoint });
}

function assertRecord(value, endpoint, label) {
  if (!isRecord(value)) invalidResponse(endpoint, `${label} must be an object.`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readErrorBody(response) {
  try {
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) return await response.json();
    const text = await response.text();
    return text ? { message: text } : null;
  } catch {
    return null;
  }
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
