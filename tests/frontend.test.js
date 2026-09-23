import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  configureApi,
  getClients,
  getCollector,
  getCollectors,
  getDashboardOverview,
  getProjectManager,
  getProjectManagers,
} from "../src/api.js";
import { formatDate, nextOptionIndex } from "../src/format.js";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("frontend exposes all four requested views and valid divisions", async () => {
  for (const view of ["executive", "pm", "collectors", "clients"]) {
    assert.match(indexHtml, new RegExp(`id="view-${view}"`));
    assert.match(indexHtml, new RegExp(`data-view="${view}"`));
  }

  const divisions = [...indexHtml.matchAll(/data-division="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(divisions, ["All", "ETM", "SUR"]);

  configureApi({ mode: "mock" });
  const [all, etm, survey] = await Promise.all(
    divisions.map((division) => getDashboardOverview({ division })),
  );
  assert.ok(all.metrics.totalAr > 0);
  assert.ok(etm.metrics.totalAr > 0);
  assert.ok(survey.metrics.totalAr > 0);
  assert.equal(toCents(all.metrics.totalAr), toCents(etm.metrics.totalAr + survey.metrics.totalAr));
});

test("every client-table sort control is accepted by the API", async () => {
  configureApi({ mode: "mock" });
  const sorts = [...indexHtml.matchAll(/data-sort="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sorts.length > 0);

  for (const sort of sorts) {
    const [ascending, descending] = await Promise.all([
      getClients({ sort, direction: "asc" }),
      getClients({ sort, direction: "desc" }),
    ]);
    assert.equal(ascending.total, descending.total, sort);
    assert.equal(ascending.items.length, descending.items.length, sort);
  }
});

test("entity details include the complete KPI set rendered by the frontend", async () => {
  configureApi({ mode: "mock" });
  const managers = await getProjectManagers();
  const collectors = await getCollectors();
  const details = await Promise.all([
    getProjectManager(managers.items[0].id),
    getCollector(collectors.items[0].id),
  ]);

  for (const detail of details) {
    for (const key of ["totalAr", "priorTotalAr", "collected", "collectionRate", "over90", "over180", "newBillings"]) {
      assert.ok(Number.isFinite(detail.metrics[key]), key);
    }
  }
});

test("date-only contract values do not shift across time zones", () => {
  assert.equal(formatDate("2026-09-12"), "Sep 12, 2026");
  assert.equal(formatDate("not-a-date"), "not-a-date");
  assert.equal(formatDate(null), "—");
});

test("search option navigation starts at the expected edge and wraps", () => {
  assert.equal(nextOptionIndex(-1, 1, 4), 0);
  assert.equal(nextOptionIndex(-1, -1, 4), 3);
  assert.equal(nextOptionIndex(3, 1, 4), 0);
  assert.equal(nextOptionIndex(0, -1, 4), 3);
  assert.equal(nextOptionIndex(0, 1, 0), -1);
});

test("frontend uses safe DOM construction and the official check covers app syntax", () => {
  for (const unsafe of [".innerHTML", "insertAdjacentHTML", "eval("]) {
    assert.equal(appSource.includes(unsafe), false, unsafe);
  }
  assert.match(packageJson.scripts.check, /node --check src\/app\.js/);
  assert.match(indexHtml, /role="combobox"/);
  assert.match(appSource, /aria-activedescendant/);
  assert.match(appSource, /error\?\.code === "ABORTED"/);
  assert.match(appSource, /cancelRequest\("project-manager-detail"\)/);
  assert.match(appSource, /cancelRequest\("collector-detail"\)/);
  assert.match(appSource, /cancelRequest\("client-detail"\)/);
  assert.match(appSource, /Try loading this client again/);

  const referencedIds = [...appSource.matchAll(/querySelector\("#([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  for (const id of new Set(referencedIds)) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});

function toCents(value) {
  return Math.round(Number(value) * 100);
}
