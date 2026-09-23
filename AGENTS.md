# AR Frontend Agent Guide

## Product goal

Build a maintainable, browser-based AR Collections Command Center inspired by the provided reference build (available locally under `example/*.html` when present). The reference file is design and behavior guidance only; production code belongs in small HTML, CSS, and JavaScript modules.

## Architecture boundaries

- `index.html`, `styles.css`, and `src/app.js` own presentation and browser interactions.
- `src/api.js` is the only module that knows HTTP routes or the configured API base URL.
- `src/mock-data.js` supplies deterministic local data while the future backend URL is unspecified.
- `docs/API.md` is the source of truth for the future backend contract.
- Tests live under `tests/` and must not depend on a live service.

The API host must never be hardcoded. Runtime configuration should come from the `ar-api-base-url` meta value or another explicitly documented runtime setting. Local mock mode must remain usable until the backend exists.

## Implementation expectations

- Preserve the reference dashboard's olive, lime, cream, forest, terracotta, mint, and sage visual identity.
- Keep Executive, PM Detail, Collectors, and Client Detail as first-class views.
- All interactive controls must be keyboard reachable and visibly focused.
- Render loading, empty, and error states deliberately.
- Escape or construct DOM content safely; do not inject API strings through unsafe `innerHTML` paths.
- Keep the layout usable on narrow screens and printable on standard office paper.
- Run the complete test/check command before committing.

## Agent responsibilities for this build

- Frontend agent: visual system, responsive layout, and browser interactions.
- API agent: configurable client, endpoint contract, mock data, and API tests.
- Test agent: repeated independent review of behavior, accessibility, contract coverage, and regression checks.
- Orchestrator: integration, fixes, documentation, commits, final approval, and upstream push.

## Change log

- 2026-09-23: Initialized the modular dashboard build, API boundary, local fallback strategy, and multi-agent ownership rules.
- 2026-09-23: Implemented the four-view responsive dashboard, configurable API adapter, documented `/v1` contract, deterministic reconciled mock data, accessible interactions, print styling, and automated API/frontend contract checks.
- 2026-09-23: Replaced the temporary Python serving instructions with a JavaScript-only Vite development, production-build, and preview workflow.
