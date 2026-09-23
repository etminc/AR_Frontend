import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "vite";

const root = path.resolve(new URL("..", import.meta.url).pathname.slice(1));

test("production build embeds VITE_API_BASE_URL and selects remote mode", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "ar-api-build-"));
  const configuredBaseUrl = "https://function.example.test/ar-api";
  const previousBaseUrl = process.env.VITE_API_BASE_URL;

  try {
    process.env.VITE_API_BASE_URL = configuredBaseUrl;
    await build({
      root,
      logLevel: "silent",
      build: {
        emptyOutDir: true,
        outDir: outputDirectory,
        lib: {
          entry: path.join(root, "src", "api.js"),
          formats: ["es"],
          fileName: "api",
        },
      },
    });

    const builtFile = path.join(outputDirectory, "api.js");
    const builtSource = await readFile(builtFile, "utf8");
    const builtApi = await import(`${pathToFileURL(builtFile).href}?test=${Date.now()}`);

    assert.match(builtSource, /https:\/\/function\.example\.test\/ar-api/);
    assert.deepEqual(builtApi.getApiConfig(), {
      baseUrl: configuredBaseUrl,
      mode: "remote",
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL = previousBaseUrl;
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("Static Web Apps build receives the repository API URL variable", async () => {
  const workflow = await readFile(
    new URL(
      "../.github/workflows/azure-static-web-apps-delightful-plant-0963da40f.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(
    workflow,
    /VITE_API_BASE_URL:\s*\$\{\{\s*vars\.VITE_API_BASE_URL\s*\}\}/,
  );

  const exampleLine = envExample
    .split(/\r?\n/)
    .find((line) => line.startsWith("VITE_API_BASE_URL="));
  assert.ok(exampleLine, ".env.example documents VITE_API_BASE_URL");
  const exampleUrl = new URL(exampleLine.slice("VITE_API_BASE_URL=".length));
  assert.equal(exampleUrl.pathname, "/", "the configured value is a base host without /v1");
});
