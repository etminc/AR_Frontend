import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultDir = path.join(root, "test-results", "visual");
const appPort = 5199;
const browserPort = 9333;
const appUrl = `http://127.0.0.1:${appPort}/`;
const browserProfile = await mkdtemp(path.join(tmpdir(), "ar-visual-browser-"));

await mkdir(resultDir, { recursive: true });

const browserPath = await findBrowser();
const vite = spawn(
  process.execPath,
  [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);

let browser;
let client;
let target;
let runError;
let browserStderr = "";
const browserErrors = [];

try {
  await waitForHttp(appUrl);
  browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${browserProfile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  browser.stderr.on("data", (chunk) => {
    browserStderr += chunk.toString();
  });

  await waitForBrowser(browserPort);
  const targets = await CDP.List({ port: browserPort });
  target = targets.find((candidate) => candidate.type === "page");
  client = await CDP({ target: target?.webSocketDebuggerUrl });

  const { Emulation, Log, Page, Runtime } = client;
  await Promise.all([Page.enable(), Runtime.enable(), Log.enable()]);
  Runtime.exceptionThrown(({ exceptionDetails }) => {
    browserErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
  });
  Log.entryAdded(({ entry }) => {
    if (entry.level === "error") browserErrors.push(`${entry.url || "browser"}: ${entry.text}`);
  });

  await setViewport(Emulation, 1440, 900);
  await Page.navigate({ url: appUrl });
  await waitFor(() => evaluate(Runtime, "document.readyState === 'complete' && document.querySelectorAll('#executive-kpis .kpi-card').length === 6"));

  const results = [];
  results.push(await inspectAndCapture({ Page, Runtime }, "executive-desktop"));

  await activateAndPopulate(Runtime, "pm");
  await waitFor(() => evaluate(Runtime, "!document.querySelector('#pm-content').hidden && document.querySelectorAll('#pm-kpis .kpi-card').length === 6"));
  results.push(await inspectAndCapture({ Page, Runtime }, "pm-desktop"));

  await activateAndPopulate(Runtime, "collectors");
  await waitFor(() => evaluate(Runtime, "!document.querySelector('#collector-content').hidden && document.querySelectorAll('#collector-kpis .kpi-card').length === 6"));
  results.push(await inspectAndCapture({ Page, Runtime }, "collectors-desktop"));

  await activateAndPopulate(Runtime, "clients");
  await waitFor(() => evaluate(Runtime, "document.querySelectorAll('#client-table-body tr').length > 0"));
  results.push(await inspectAndCapture({ Page, Runtime }, "clients-desktop"));

  await evaluate(Runtime, "document.querySelector('#client-table-body .client-row-button').click(); true");
  await waitFor(() => evaluate(Runtime, "document.querySelector('#client-dialog').open && document.querySelectorAll('#dialog-content .kpi-card').length > 0"));
  await capture(Page, "client-dialog-desktop");
  await evaluate(Runtime, "document.querySelector('#dialog-close').click(); true");

  await setViewport(Emulation, 390, 844);
  await activateAndPopulate(Runtime, "executive");
  await waitFor(() => evaluate(Runtime, "!document.querySelector('#view-executive').hidden"));
  results.push(await inspectAndCapture({ Page, Runtime }, "executive-mobile"));

  await activateAndPopulate(Runtime, "clients");
  await waitFor(() => evaluate(Runtime, "document.querySelectorAll('#client-table-body tr').length > 0"));
  results.push(await inspectAndCapture({ Page, Runtime }, "clients-mobile"));

  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.name}: ${failure}`));
  if (browserErrors.length) failures.push(...browserErrors.map((error) => `browser error: ${error}`));

  const report = { browserPath, appUrl, results, browserErrors, screenshots: resultDir };
  await writeFile(path.join(resultDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (failures.length) {
    throw new Error(`Visual smoke test failed:\n- ${failures.join("\n- ")}`);
  }
} catch (error) {
  runError = error;
  if (browserStderr && error.message === "WebSocket connection closed") {
    error.message += `\nBrowser diagnostics:\n${browserStderr}`;
  }
} finally {
  if (client) {
    await client.close().catch(() => {});
  }
  browser?.kill();
  vite.kill();
  const safeProfilePrefix = path.join(tmpdir(), "ar-visual-browser-");
  if (path.resolve(browserProfile).startsWith(path.resolve(safeProfilePrefix))) {
    await delay(100);
    await rm(browserProfile, { recursive: true, force: true }).catch(() => {});
  }
}

if (runError) throw runError;

async function inspectAndCapture({ Page, Runtime }, name) {
  const metrics = await evaluate(Runtime, `(() => {
    const toolbar = document.querySelector('.toolbar');
    const header = document.querySelector('.site-header');
    const main = document.querySelector('main');
    const activeView = document.querySelector('.view.active');
    const pseudo = getComputedStyle(toolbar, '::before');
    const toolbarRect = toolbar.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const pseudoHeight = Number.parseFloat(pseudo.height) || 0;
    const staticDataBanner = document.querySelector('#static-data-banner');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      toolbar: { height: toolbarRect.height, bottom: toolbarRect.bottom },
      header: { height: headerRect.height, bottom: headerRect.bottom },
      main: { top: mainRect.top, height: mainRect.height },
      activeView: activeView?.id || null,
      pseudo: { position: pseudo.position, height: pseudoHeight, backgroundColor: pseudo.backgroundColor, content: pseudo.content },
      leaderRanks: [...document.querySelectorAll('#executive-leaders .leader-group')].map((group) =>
        [...group.querySelectorAll('.leader-rank')].map((rank) => rank.textContent.trim())
      ),
      staticDataBanner: staticDataBanner ? {
        hidden: staticDataBanner.hidden,
        role: staticDataBanner.getAttribute('role'),
        text: staticDataBanner.textContent.trim(),
      } : null,
      bodyScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.documentElement.clientWidth,
    };
  })()`);

  const failures = [];
  if (metrics.pseudo.position === "fixed" && metrics.pseudo.height > metrics.toolbar.height + 4) {
    failures.push(`toolbar ribbon is ${metrics.pseudo.height}px tall while the toolbar is ${metrics.toolbar.height}px`);
  }
  if (metrics.header.bottom > metrics.viewport.height * 0.45) {
    failures.push(`header occupies ${Math.round((metrics.header.bottom / metrics.viewport.height) * 100)}% of the viewport`);
  }
  if (metrics.main.height < 100) failures.push("main dashboard content is not visibly laid out");
  if (metrics.bodyScrollWidth > metrics.bodyClientWidth + 1) {
    failures.push(`page overflows horizontally (${metrics.bodyScrollWidth}px > ${metrics.bodyClientWidth}px)`);
  }
  if (!metrics.staticDataBanner || metrics.staticDataBanner.hidden) {
    failures.push("static placeholder data indicator is not visible");
  } else {
    if (metrics.staticDataBanner.role !== "status") {
      failures.push("static placeholder data indicator does not expose status semantics");
    }
    if (!metrics.staticDataBanner.text.includes("STATIC PLACEHOLDER DATA")) {
      failures.push("static placeholder data indicator is missing its explicit label");
    }
  }
  for (const ranks of metrics.leaderRanks) {
    const expected = ranks.map((_, index) => String(index + 1));
    if (JSON.stringify(ranks) !== JSON.stringify(expected)) {
      failures.push(`leaderboard ranks are ${ranks.join(", ")} instead of ${expected.join(", ")}`);
    }
  }

  await capture(Page, name);
  return { name, metrics, failures };
}

async function activateAndPopulate(Runtime, view) {
  await evaluate(Runtime, `document.querySelector('[data-view="${view}"]').click(); true`);
  if (view === "pm") {
    await waitFor(() => evaluate(Runtime, "document.querySelector('#pm-select').options.length > 1"));
    await evaluate(Runtime, `(() => { const select = document.querySelector('#pm-select'); select.selectedIndex = 1; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  }
  if (view === "collectors") {
    await waitFor(() => evaluate(Runtime, "document.querySelector('#collector-select').options.length > 1"));
    await evaluate(Runtime, `(() => { const select = document.querySelector('#collector-select'); select.selectedIndex = 1; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  }
}

async function capture(Page, name) {
  const { data } = await Page.captureScreenshot({ format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(resultDir, `${name}.png`), Buffer.from(data, "base64"));
}

async function evaluate(Runtime, expression) {
  const response = await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function setViewport(Emulation, width, height) {
  await Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: 1, mobile: false });
}

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(75);
  }
  throw lastError || new Error(`Timed out after ${timeoutMs}ms.`);
}

async function waitForHttp(url) {
  await waitFor(async () => {
    const response = await fetch(url);
    return response.ok;
  }, 8000);
}

async function waitForBrowser(port) {
  await waitFor(async () => {
    try {
      await CDP.Version({ port });
      return true;
    } catch {
      return false;
    }
  }, 8000);
}

async function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known browser location.
    }
  }
  throw new Error("No supported Edge or Chrome executable was found. Set BROWSER_PATH to run visual smoke tests.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
