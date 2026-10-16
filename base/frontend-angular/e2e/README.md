# Isolated integrated beneficiary QA

This suite builds the existing production API and nginx frontend Dockerfiles and starts
PostgreSQL 17 in a uniquely named disposable Compose project. It does not use, stop, reset,
or bind the development services at ports 4200 and 9999. Existing Karma tests remain separate.

## Prerequisites and commands

Use Node `^20.19.0 || ^22.12.0 || >=24.0.0` (Angular engine requirement), Docker with Compose v2, and Chromium. Install from the frontend directory:

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

To use an already installed Chrome binary instead of Playwright Chromium:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

Optional `E2E_OUTPUT_DIR` selects an existing or creatable directory **outside the repository**.
The runner creates a unique child directory there; the default is the OS temporary directory.
The command runs infrastructure guard tests before building images and prints the exact artifact directory. Reports, screenshots, failure traces, build
output, Compose logs, ownership state and exit status remain there after cleanup.

Only project/filter/discovery/max-failures arguments are accepted: `--project` (desktop/mobile),
`--grep`/`-g`, `--grep-invert`, `--list`, `--max-failures` and `-x`. Options that change config,
workers, retries, reports, output or missing-test failure behavior fail before artifact or Docker
creation. For example:

```sh
npm run test:e2e -- --project=mobile --grep 'UI CRUD'
node --test e2e/infrastructure.test.mjs
node --test e2e/lifecycle.test.mjs
```

Do not run `playwright test` directly or provide live URLs: configuration requires the state
created by this runner. Do not run the delivery `verificar.sh` against development resources.

## Isolation and cleanup

The runner generates a random project name and ownership token. Containers, volumes and the
private Compose network carry project and ownership labels. API and web ports are assigned
randomly on `127.0.0.1` once, then published explicitly for the project lifetime; ports4200/9999
are rejected. A race with another process claiming a selected port fails safely during Compose
startup. Tests compare actual owned containers' loopback bindings with runner state before HTTP
setup/mutations and after restarts. Tests validate
ownership before all Docker mutations. Each test stops only its owned API, truncates only the
owned database's beneficiary/plan tables, and starts its API, waiting for health200 and the
normal startup seed. Tests have one worker and no retries, so database resets cannot race.
Each test has independent browser context and data; desktop1440x1000 and mobile390x844 run
the same flows.

A local HTTP forward proxy accepts only the exact browser origins `http://localhost:4200`
and `http://localhost:9999`. It routes TCP destinations to disposable ports and preserves
method, body, headers, Origin, status, response body and CORS headers. CONNECT and other
origins are rejected. Chromium's localhost proxy bypass is disabled explicitly. Thus the
browser really executes the production frontend at4200 and enforces native CORS for9999,
even when the user's actual4200/9999 ports are occupied. No Origin or ACAO adaptation occurs.
Direct API setup/assertions use only the validated disposable API; they do not prove CORS.

On success, failure, SIGINT or SIGTERM, the runner captures logs, closes its proxy, validates
all project containers/networks/volumes, and runs `down -v --rmi local` only for that exact
project. Failed build, test, log capture or cleanup returns nonzero; interrupted runs preserve
130/143. Label mismatches refuse cleanup and report the remaining project instead of deleting
unverified resources. SIGKILL, host failure or Docker daemon failure cannot guarantee cleanup;
use the printed project and external ownership file for manual inspection. There is no prune,
shared database reset, or arbitrary container/endpoint option.

## Coverage and proof limits

The suite covers fresh health/migrations, five fixed plans, Swagger routes and UI availability,
restart persistence and idempotent seed after plan deletion; UI POST/PUT exact payloads and
GET persistence; immutable CPF, edit/inactivate/reactivate/reopen; actual backend400/409/422
with preserved form input; real frozen409 and inactive historical-plan422; more than ten rows,
pagination traversal, repeated combined status/plan filters and clearing; cancel/noDELETE,
retry204 followed by GET404 and reservedCPF409, and last-page repair. All browser flows check
page errors and document overflow, semantic labels/actions, and actual4200 CORS headers.
The CRUD scenario also verifies basic Enter activation of the new-record button.
A passing CRUD screenshot is retained for each viewport. Infrastructure unit tests cover
proxy allowlists/pass-through and fail-closed container/resource ownership validation.

The one response deliberately injected with Playwright routing is named **synthetic DELETE500**.
It proves the UI retains the row, reports failure and retries; it does not prove the real
backend's exception handler or native CORS on that response. All successful CRUD responses and
400/409/422 cases come from the real API and PostgreSQL. Synthetic records use generated valid
CPF check digits and QA names; no personal data is required.

Backend204-case and Karma40-case suites, log privacy review, broader accessibility/keyboard
coverage and final review evidence are recorded separately by the phase owner. This suite does
not establish published Docker Hub images, delivery-compose functionality, performance budgets,
or production readiness. Those release checks remain F10.

Configuration and proxy behavior follow the official Playwright
[configuration](https://playwright.dev/docs/test-configuration) and
[HTTP proxy](https://playwright.dev/docs/network#http-proxy) documentation.


Lifecycle controller tests use a temporary fake Docker executable to prove SIGINT130,
SIGTERM143, streaming artifact-write failure and cleanup-failure handling. They verify the
runner invokes exact-project cleanup and preserves a nonzero result, without contacting Docker.
They run separately from automatic infrastructure guards to avoid recursive runner invocation.
Real Docker resource removal and occupied development ports require the integrated run; the
phase owner separately observed actual SIGTERM143 and owned Docker removal during a failed run.
Persistence comparisons retain all record fields and validate creation timestamps at millisecond
precision, accommodating .NET seven-digit fractions stored by PostgreSQL at microsecond precision.
