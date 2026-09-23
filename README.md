# ETM AR Collections Command Center

A modular, browser-based accounts-receivable dashboard inspired by the provided reference build. It keeps the reference's olive/lime/cream visual system while separating presentation, API access, and temporary mock data.

## Run locally

Requires Node.js 20.19+ or Node.js 22.12+.

1. Install the JavaScript dependencies:

   ```powershell
   npm install
   ```

2. Start the Vite development server:

   ```powershell
   npm run dev
   ```

3. Open the local URL printed by Vite, normally `http://localhost:5173/`.
4. Confirm that Executive, PM Detail, Collectors, and Client Detail all open; the All/ETM/Survey filters change the totals; and a client row opens invoice/project detail.

`npm start` is available as an alias for `npm run dev`.

## Build and preview

Create the deployable production bundle:

```powershell
npm run build
```

Vite writes the optimized static application to `dist/`. Preview that exact production bundle locally with:

```powershell
npm run preview
```

The generated `dist/` directory is the Azure Static Web Apps artifact. The API is a separately deployed Azure Function App; it is not bundled into the Static Web App.

## Data modes

`VITE_API_BASE_URL` is public build-time configuration. Set it to the Function App origin only, for example `https://your-function-app.azurewebsites.net`. Do not include `/v1`; `src/api.js` adds the existing versioned routes.

- When the URL is absent, auto mode deliberately uses the bundled deterministic mock data.
- When the URL is present, auto mode uses the remote Function App.
- A configured remote request that fails is shown as an error. It never silently falls back to mock data.
- An overview response containing `"dataSource": "static-placeholder"` displays the accessible `STATIC PLACEHOLDER DATA` notice. The bundled mock overview always includes that marker.

For local remote-mode development, copy [.env.example](.env.example) to `.env.local`, replace the sample host, and restart Vite:

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Leave `VITE_API_BASE_URL` unset to exercise mock mode. The sample invoice data is incomplete; clearly marked `Unallocated AR` entries reconcile the mock aging, invoice, project, and client totals. Runtime overrides for tests and specialized hosting are documented in [docs/API.md](docs/API.md).

## Configure Azure Static Web Apps

1. Deploy the Function App with the API routes at `/v1/...`. Its Function host routing must not add a second prefix such as `/api`.
2. In the Function App CORS settings, allow the production Static Web App origin (and any preview origins that need API access).
3. In the frontend GitHub repository, open **Settings → Secrets and variables → Actions → Variables**.
4. Create the repository variable `VITE_API_BASE_URL` with the Function App origin, such as `https://your-function-app.azurewebsites.net`. This is a public URL, not a secret. Do not add `/v1`.
5. Run the `Azure Static Web Apps CI/CD` workflow. Its build step forwards `${{ vars.VITE_API_BASE_URL }}` to Vite; changing the variable requires a new build/deployment.
6. In the deployed browser, confirm the network request targets `https://<function-app-host>/v1/dashboard/overview?division=all`. If the backend is still serving placeholder data, also confirm the `STATIC PLACEHOLDER DATA` notice is visible.

## Verify changes

```powershell
npm run check
```

The command syntax-checks the browser/API/data modules, runs the full Node test suite (including a production-build API URL check), and creates a production Vite build. A complete local smoke test is:

1. Run `npm run check` with no failures.
2. Run `npm run preview`.
3. Exercise all four tabs, all three division filters, global search, both detail selectors, every client-table sort, a client dialog, and Print.
4. Resize to a narrow viewport and confirm only the client table scrolls horizontally.

Run the real-browser visual suite separately:

```powershell
npm run test:visual
```

The visual suite launches the Vite app in installed Edge or Chrome, opens every dashboard view, selects representative PM/collector data, opens a client dialog, checks desktop and mobile layout geometry, and saves screenshots plus `report.json` under the ignored `test-results/visual/` directory. Set `BROWSER_PATH` if the browser is installed outside the standard Windows locations.

## Structure

- `index.html` — semantic dashboard shell.
- `styles.css` — responsive, accessible, and print styling.
- `src/app.js` — browser state, rendering, and interactions.
- `src/api.js` — the only module that knows Function App HTTP routes and configuration.
- `src/mock-data.js` — deterministic development data.
- `src/format.js` — small date and keyboard-navigation utilities with isolated tests.
- `docs/API.md` — Function App contract and frontend configuration.
- `tests/` — API, reconciliation, and frontend contract smoke tests.
- `scripts/visual-smoke.mjs` — real-browser navigation, geometry assertions, and screenshot capture.
- `dist/` — generated production bundle (ignored by Git).
