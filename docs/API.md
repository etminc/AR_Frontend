# AR Collections API Contract

This document defines the future read-only backend expected by `src/api.js`. No backend host is selected yet. The frontend runs against deterministic mock data until a base URL is configured.

## Runtime configuration

Configuration is resolved in this order:

1. `configureApi({ baseUrl, mode })` during application bootstrap.
2. `globalThis.AR_API_CONFIG = { baseUrl, mode }` before `src/api.js` is used.
3. `globalThis.AR_API_BASE_URL`.
4. `<meta name="ar-api-base-url" content="">` in the document head.

`mode` is `"auto"` (default), `"mock"`, or `"remote"`. Auto mode uses remote data only when a non-empty base URL exists. Otherwise it uses bundled mock data. A configured remote service failure is surfaced to the UI; it does not silently fall back to sample data.

An unsupported mode from runtime globals is rejected as an `API_CONFIG_ERROR`; it is never treated as remote or mock implicitly.

The base URL may include a path prefix, such as `https://service.example/ar-api`. It must not include `/v1`. The repository intentionally contains no real host.

All routes return JSON and use `Accept: application/json`. Responses may be the documented payload directly or wrapped as `{ "data": <payload> }`. Monetary values are JSON numbers denominated in US dollars. Rates are decimals (`0.25` means 25%). Dates are `YYYY-MM-DD`. IDs are opaque strings and callers URL-encode them.

The client validates required nested objects, arrays, identifiers, aging buckets, and finite numeric values before returning remote data to the UI. A structurally invalid successful response is reported as `INVALID_RESPONSE`.

### Mock reconciliation

The source dashboard does not contain a complete invoice ledger for every client. Mock client details therefore add deterministic `inferred: true` invoice rows for amounts not represented by the sample invoices. They are grouped under an `inferred: true` project named `Unallocated AR`. These rows are placeholders, not real invoices. Their balances reconcile each aging bucket, the client total, and project totals exactly. A future backend should return real allocation data and does not need to emit inferred rows.

## Common query parameters

- `division`: `all`, `ETM`, `SUR`, or a future division code. Defaults to `all`.
- Requests may be cancelled with an `AbortSignal`; the client reports cancellation as `ApiError` with code `ABORTED`.

## Routes

### `GET /v1/dashboard/overview?division={division}`

Response:

```json
{
  "period": {
    "asOf": "2026-09-12",
    "comparisonDate": "2026-08-29",
    "label": "August 29 to September 12, 2026"
  },
  "division": "all",
  "metrics": {
    "totalAr": 1000000,
    "priorTotalAr": 950000,
    "collected": 250000,
    "collectionRate": 0.2632,
    "over90": 300000,
    "over180": 100000,
    "newBillings": 300000,
    "projectManagersAtRisk": 2
  },
  "aging": {
    "current": { "current": 1, "days31to60": 2, "days61to90": 3, "days91to120": 4, "days121to180": 5, "days181Plus": 6 },
    "previous": { "current": 1, "days31to60": 2, "days61to90": 3, "days91to120": 4, "days121to180": 5, "days181Plus": 6 }
  },
  "leaders": {
    "collectors": ["collector summary"],
    "projectManagers": ["project manager summary"]
  },
  "health": { "onTrack": 10, "dueSoon": 4, "missed": 2, "escalation": 1 }
}
```

### `GET /v1/project-managers?division={division}`

Response: `{ "items": [<project manager summary>] }`.

A project manager summary is:

```json
{
  "id": "pm-andrew-holley",
  "name": "Holley, Andrew",
  "division": "ETM",
  "collectorId": "collector-avery-morgan",
  "collectorName": "Avery Morgan",
  "totalAr": 1000000,
  "priorTotalAr": 900000,
  "collected": 200000,
  "collectionRate": 0.2222,
  "over90": 300000,
  "over180": 100000,
  "status": "Strong",
  "clientCount": 8,
  "rank": 1
}
```

### `GET /v1/project-managers/{id}?division={division}`

Response:

```json
{
  "entity": "project manager summary",
  "metrics": {
    "totalAr": 1000000,
    "priorTotalAr": 900000,
    "collected": 200000,
    "collectionRate": 0.2222,
    "over90": 300000,
    "over180": 100000,
    "newBillings": 300000
  },
  "aging": { "current": "aging buckets", "previous": "aging buckets" },
  "clients": ["client summary"],
  "health": { "onTrack": 4, "dueSoon": 2, "missed": 1, "escalation": 1 }
}
```

### `GET /v1/collectors?division={division}`

Response: `{ "items": [<collector summary>] }`. A collector summary uses the same numeric/status fields as a project manager summary, excluding `collectorId` and `collectorName`.

### `GET /v1/collectors/{id}?division={division}`

Response uses the same detail envelope as a project manager: `{ entity, metrics, aging, clients, health }`.

### `GET /v1/clients?division={division}&search={text}&sort={field}&direction={asc|desc}`

`search` is optional and matches client, PM, collector, or billing-contact text. Supported sorts are `name`, `projectManagerName`, `totalAr`, `over90`, `over180`, `status`, and `lastContactDate`. Defaults are `over90` and `desc`.

Response: `{ "items": [<client summary>], "total": 42 }`.

A client summary is:

```json
{
  "id": "client-example",
  "name": "Example Client",
  "division": "ETM",
  "projectManagerId": "pm-example",
  "projectManagerName": "Manager, Example",
  "collectorId": "collector-example",
  "collectorName": "Example Collector",
  "totalAr": 100000,
  "over90": 30000,
  "over180": 10000,
  "status": "On track",
  "lastContactDate": "2026-09-12",
  "billingContact": "billing@example.test",
  "aging": { "current": 1, "days31to60": 2, "days61to90": 3, "days91to120": 4, "days121to180": 5, "days181Plus": 6 }
}
```

### `GET /v1/clients/{id}?division={division}`

Response:

```json
{
  "client": "client summary",
  "aging": { "current": "aging buckets", "previous": "aging buckets" },
  "invoices": [
    {
      "id": "invoice-id",
      "number": "1042-07",
      "projectId": "project-id",
      "projectName": "Project name",
      "invoiceDate": "2026-02-18",
      "dueDate": "2026-03-20",
      "amount": 12000,
      "balance": 4000,
      "ageDays": 206,
      "agingBucket": "181+",
      "status": "Overdue",
      "inferred": false
    }
  ],
  "projects": [
    {
      "id": "project-id",
      "number": "24-1042",
      "name": "Project name",
      "projectManagerId": "pm-example",
      "projectManagerName": "Manager, Example",
      "totalAr": 4000,
      "over90": 4000,
      "inferred": false
    }
  ]
}
```

`inferred` is optional and defaults to `false`. The bundled mock layer uses it only for the reconciliation placeholders described above.

### `GET /v1/directory/search?q={query}&division={division}`

Response:

```json
{
  "items": [
    {
      "type": "client",
      "id": "client-example",
      "name": "Example Client",
      "detail": "ETM · Manager, Example"
    }
  ]
}
```

`type` is `client`, `projectManager`, or `collector`. The frontend returns an empty result without making a network request when `q` is blank.

## Errors

Non-2xx responses should use:

```json
{
  "code": "NOT_FOUND",
  "message": "Client was not found.",
  "details": { "id": "client-example" }
}
```

The client normalizes failures to `ApiError` with `code`, `status`, `endpoint`, `details`, and `retryable`. HTTP `429` and `5xx` responses are considered retryable. Network failures use `NETWORK_ERROR`; malformed JSON uses `INVALID_JSON`; contract violations use `INVALID_RESPONSE`.
