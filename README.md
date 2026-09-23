# ETM AR Collections Command Center

A modular, browser-based accounts-receivable dashboard inspired by the provided reference build. It keeps the reference's olive/lime/cream visual system while separating presentation, API access, and temporary mock data.

## Run locally

1. From this repository, start a static server:

   ```powershell
   py -m http.server 4173 --bind 127.0.0.1
   ```

2. Open `http://127.0.0.1:4173/`.
3. Confirm that Executive, PM Detail, Collectors, and Client Detail all open; the All/ETM/Survey filters change the totals; and a client row opens invoice/project detail.

Opening `index.html` directly is not supported because browser ES modules require HTTP delivery.

## Data modes

The application defaults to deterministic local mock data, so no backend is required today. The sample invoice data is incomplete; clearly marked `Unallocated AR` placeholders reconcile the mock aging, invoice, project, and client totals.

When the future service exists, set its base URL in `index.html`:

```html
<meta name="ar-api-base-url" content="https://service.example/ar-api" />
```

The host above is illustrative only. Do not include `/v1`; the client adds versioned paths. A configured base URL switches auto mode to remote data. Runtime alternatives and every required route/response are documented in [docs/API.md](docs/API.md).

## Verify changes

Requires Node.js 20 or newer.

```powershell
npm run check
```

The command syntax-checks the browser/API/data modules and runs the full Node test suite. A complete local smoke test is:

1. Run `npm run check` with no failures.
2. Serve the repository over HTTP.
3. Exercise all four tabs, all three division filters, global search, both detail selectors, every client-table sort, a client dialog, and Print.
4. Resize to a narrow viewport and confirm only the client table scrolls horizontally.

## Structure

- `index.html` — semantic dashboard shell.
- `styles.css` — responsive, accessible, and print styling.
- `src/app.js` — browser state, rendering, and interactions.
- `src/api.js` — the only module that knows future HTTP routes.
- `src/mock-data.js` — deterministic development data.
- `src/format.js` — small date and keyboard-navigation utilities with isolated tests.
- `docs/API.md` — future backend contract and runtime configuration.
- `tests/` — API, reconciliation, and frontend contract smoke tests.
