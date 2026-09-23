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

The project is frontend-only. It has no Python server and no application backend. In production, publish the generated `dist/` directory to a static web host.

## Data modes

The application defaults to deterministic local mock data, so no backend is required today. The sample invoice data is incomplete; clearly marked `Unallocated AR` placeholders reconcile the mock aging, invoice, project, and client totals.

When the future service exists, set its base URL in `index.html`:

```html
<meta name="ar-api-base-url" content="https://service.example/ar-api" />
```

The host above is illustrative only. Do not include `/v1`; the client adds versioned paths. A configured base URL switches auto mode to remote data. Runtime alternatives and every required route/response are documented in [docs/API.md](docs/API.md).

## Verify changes

```powershell
npm run check
```

The command syntax-checks the browser/API/data modules, runs the full Node test suite, and creates a production Vite build. A complete local smoke test is:

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
- `src/api.js` — the only module that knows future HTTP routes.
- `src/mock-data.js` — deterministic development data.
- `src/format.js` — small date and keyboard-navigation utilities with isolated tests.
- `docs/API.md` — future backend contract and runtime configuration.
- `tests/` — API, reconciliation, and frontend contract smoke tests.
- `scripts/visual-smoke.mjs` — real-browser navigation, geometry assertions, and screenshot capture.
- `dist/` — generated production bundle (ignored by Git).
