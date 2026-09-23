import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ApiError,
  configureApi,
  getClient,
  getClients,
  getCollector,
  getCollectors,
  getApiConfig,
  getDashboardOverview,
  getProjectManager,
  getProjectManagers,
  searchDirectory,
} from "../src/api.js";

const originalRuntimeConfig = globalThis.AR_API_CONFIG;
const originalBaseUrl = globalThis.AR_API_BASE_URL;
const originalDocument = globalThis.document;

afterEach(() => {
  configureApi();
  restoreGlobal("AR_API_CONFIG", originalRuntimeConfig);
  restoreGlobal("AR_API_BASE_URL", originalBaseUrl);
  restoreGlobal("document", originalDocument);
});

test("mock mode exposes deterministic data for every API function", async () => {
  configureApi({ mode: "mock" });

  const overview = await getDashboardOverview({ division: "ETM" });
  const managers = await getProjectManagers({ division: "ETM" });
  const manager = await getProjectManager(managers.items[0].id, { division: "ETM" });
  const collectors = await getCollectors({ division: "ETM" });
  const collector = await getCollector(collectors.items[0].id, { division: "ETM" });
  const clients = await getClients({ division: "ETM" });
  const client = await getClient(clients.items[0].id, { division: "ETM" });
  const directory = await searchDirectory("holley", { division: "ETM" });

  assert.equal(overview.division, "ETM");
  assert.ok(overview.metrics.totalAr > 0);
  for (const leaders of [overview.leaders.collectors, overview.leaders.projectManagers]) {
    assert.deepEqual(leaders.map((item) => item.rank), leaders.map((_, index) => index + 1));
    assert.deepEqual(
      leaders.map((item) => item.collected),
      leaders.map((item) => item.collected).toSorted((left, right) => right - left),
    );
  }
  assert.ok(managers.items.every((item) => item.division === "ETM"));
  assert.equal(manager.entity.id, managers.items[0].id);
  assert.ok(collectors.items.every((item) => item.division === "ETM"));
  assert.equal(collector.entity.id, collectors.items[0].id);
  assert.equal(clients.total, clients.items.length);
  assert.equal(client.client.id, clients.items[0].id);
  assert.ok(Array.isArray(client.invoices));
  assert.deepEqual(directory.items.map((item) => item.type), ["projectManager"]);
});

test("client mock filtering and sorting are stable and do not leak mutable data", async () => {
  configureApi({ mode: "mock" });
  const result = await getClients({
    division: "sur",
    search: "Jordan",
    sort: "name",
    direction: "asc",
  });

  assert.deepEqual(
    result.items.map((item) => item.name),
    ["Arcadis U.S., Inc.", "City of Palm Coast", "Osiris 9 Consulting, LLC"],
  );

  result.items[0].name = "changed";
  const fresh = await getClients({ division: "SUR", sort: "name", direction: "asc" });
  assert.equal(fresh.items[0].name, "Arcadis U.S., Inc.");
});

test("every mock client reconciles aging, invoice balances, and project totals", async () => {
  configureApi({ mode: "mock" });
  const clients = await getClients({ sort: "name", direction: "asc" });
  let inferredEntries = 0;

  for (const summary of clients.items) {
    const detail = await getClient(summary.id);
    const invoiceTotal = detail.invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
    const projectTotal = detail.projects.reduce((sum, project) => sum + project.totalAr, 0);
    const projectsById = new Map(detail.projects.map((project) => [project.id, project]));

    assert.equal(toCents(invoiceTotal), toCents(detail.client.totalAr), `${summary.name} invoices`);
    assert.equal(toCents(projectTotal), toCents(detail.client.totalAr), `${summary.name} projects`);

    for (const invoice of detail.invoices) {
      assert.ok(projectsById.has(invoice.projectId), `${invoice.id} has a project`);
      if (invoice.inferred) inferredEntries += 1;
    }

    for (const project of detail.projects) {
      const allocated = detail.invoices
        .filter((invoice) => invoice.projectId === project.id)
        .reduce((sum, invoice) => sum + invoice.balance, 0);
      assert.equal(toCents(project.totalAr), toCents(allocated), `${project.id} allocation`);
    }

    const invoiceAging = Object.fromEntries(
      ["Current", "31-60", "61-90", "91-120", "121-180", "181+"].map((key) => [key, 0]),
    );
    for (const invoice of detail.invoices) invoiceAging[invoice.agingBucket] += invoice.balance;
    assert.deepEqual(
      Object.values(invoiceAging).map(toCents),
      Object.values(detail.aging.current).map(toCents),
      `${summary.name} aging buckets`,
    );
  }

  assert.ok(inferredEntries > 0, "mock details identify inferred unallocated entries");
});

test("mock details return a normalized not-found error", async () => {
  configureApi({ mode: "mock" });
  await assert.rejects(
    () => getClient("missing-client"),
    (error) =>
      error instanceof ApiError && error.code === "NOT_FOUND" && error.status === 404,
  );
});

test("pre-aborted signals stop mock work", async () => {
  configureApi({ mode: "mock" });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => getDashboardOverview({ signal: controller.signal }),
    (error) => error instanceof ApiError && error.code === "ABORTED",
  );
});

test("remote mode encodes path and query values and forwards abort signals", async () => {
  let request;
  const controller = new AbortController();
  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test/ar-data/",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        client: clientSummary({ id: "client/a & b", division: "SPECIAL & WEST" }),
        aging: { current: aging(), previous: aging() },
        invoices: [],
        projects: [],
      });
    },
  });

  await getClient("client/a & b", { division: "special & west", signal: controller.signal });

  assert.equal(
    request.url,
    "https://api.example.test/ar-data/v1/clients/client%2Fa%20%26%20b?division=SPECIAL+%26+WEST",
  );
  assert.equal(request.options.signal, controller.signal);
  assert.equal(request.options.headers.Accept, "application/json");
});

test("remote list responses accept a data wrapper and normalize a missing total", async () => {
  const remoteClient = clientSummary({ id: "one", name: "One" });
  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse({ data: [remoteClient] }),
  });

  const clients = await getClients();
  assert.deepEqual(clients, { items: [remoteClient], total: 1 });
});

test("remote HTTP errors are normalized with service details", async () => {
  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () =>
      jsonResponse(
        { code: "SERVICE_BUSY", message: "Try again later", details: { wait: 10 } },
        503,
      ),
  });

  await assert.rejects(
    () => getCollectors(),
    (error) =>
      error instanceof ApiError &&
      error.code === "SERVICE_BUSY" &&
      error.status === 503 &&
      error.retryable === true &&
      error.message === "Try again later",
  );
});

test("remote contract violations are rejected before reaching the UI", async () => {
  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse({ items: "not-an-array" }),
  });

  await assert.rejects(
    () => getProjectManagers(),
    (error) => error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );
});

test("nested aging, numeric, and child-array contract violations are rejected", async () => {
  configureApi({ mode: "mock" });
  const badOverview = await getDashboardOverview();
  badOverview.aging.current.days181Plus = "unknown";

  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse(badOverview),
  });
  await assert.rejects(
    () => getDashboardOverview(),
    (error) => error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );

  configureApi({ mode: "mock" });
  const [clientSummaryValue] = (await getClients()).items;
  const badClientDetail = await getClient(clientSummaryValue.id);
  badClientDetail.invoices[0].balance = Number.NaN;

  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse(badClientDetail),
  });
  await assert.rejects(
    () => getClient(clientSummaryValue.id),
    (error) => error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );

  configureApi({ mode: "mock" });
  const managerSummary = (await getProjectManagers()).items[0];
  const badManagerDetail = await getProjectManager(managerSummary.id);
  badManagerDetail.clients = "not-an-array";

  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse(badManagerDetail),
  });
  await assert.rejects(
    () => getProjectManager(managerSummary.id),
    (error) => error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );

  configureApi({ mode: "mock" });
  const badManagers = await getProjectManagers();
  badManagers.items[0].totalAr = Number.POSITIVE_INFINITY;

  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse(badManagers),
  });
  await assert.rejects(
    () => getProjectManagers(),
    (error) => error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );
});

test("auto mode without a base URL resolves to mock mode", async () => {
  let fetchCalls = 0;
  delete globalThis.AR_API_CONFIG;
  delete globalThis.AR_API_BASE_URL;
  delete globalThis.document;
  configureApi({
    mode: "auto",
    baseUrl: "",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("should not fetch");
    },
  });

  assert.deepEqual(getApiConfig(), { baseUrl: "", mode: "mock" });
  assert.ok((await getDashboardOverview()).metrics.totalAr > 0);
  assert.equal(fetchCalls, 0);
});

test("explicit, runtime, global, and meta base URL precedence is deterministic", () => {
  globalThis.document = {
    querySelector: () => ({ content: "https://meta.example.test/root/" }),
  };
  globalThis.AR_API_BASE_URL = "https://global.example.test/root/";
  globalThis.AR_API_CONFIG = {
    baseUrl: "https://runtime.example.test/root/",
    mode: "remote",
  };

  configureApi();
  assert.deepEqual(getApiConfig(), {
    baseUrl: "https://runtime.example.test/root",
    mode: "remote",
  });

  configureApi({ baseUrl: "https://override.example.test/root/", mode: "mock" });
  assert.deepEqual(getApiConfig(), {
    baseUrl: "https://override.example.test/root",
    mode: "mock",
  });

  configureApi();
  delete globalThis.AR_API_CONFIG;
  assert.equal(getApiConfig().baseUrl, "https://global.example.test/root");
  delete globalThis.AR_API_BASE_URL;
  assert.equal(getApiConfig().baseUrl, "https://meta.example.test/root");
});

test("an invalid runtime mode is rejected as a configuration error", () => {
  configureApi();
  globalThis.AR_API_CONFIG = { mode: "sometimes", baseUrl: "" };

  assert.throws(
    () => getApiConfig(),
    (error) => error instanceof ApiError && error.code === "API_CONFIG_ERROR",
  );
});

test("blank directory searches avoid unnecessary remote requests", async () => {
  let calls = 0;
  configureApi({
    mode: "remote",
    baseUrl: "https://api.example.test",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ items: [] });
    },
  });

  assert.deepEqual(await searchDirectory("   "), { items: [] });
  assert.equal(calls, 0);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => structuredClone(payload),
    text: async () => JSON.stringify(payload),
  };
}

function aging() {
  return {
    current: 100,
    days31to60: 90,
    days61to90: 80,
    days91to120: 70,
    days121to180: 60,
    days181Plus: 50,
  };
}

function clientSummary(overrides = {}) {
  return {
    id: "client-one",
    name: "Client One",
    division: "ETM",
    projectManagerId: "pm-one",
    projectManagerName: "Manager, One",
    collectorId: "collector-one",
    collectorName: "Collector One",
    totalAr: 450,
    over90: 180,
    over180: 50,
    status: "On track",
    lastContactDate: "2026-09-12",
    billingContact: "billing@example.test",
    aging: aging(),
    ...overrides,
  };
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function restoreGlobal(key, value) {
  if (value === undefined) delete globalThis[key];
  else globalThis[key] = value;
}
