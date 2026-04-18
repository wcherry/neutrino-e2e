# neutrino-e2e

End-to-end tests for the Neutrino platform using [Playwright](https://playwright.dev/).

Each test run spins up a fully isolated Docker stack, captures all observable state, and tears everything down when done.

## Prerequisites

- Docker
- Node.js 20+
- `openssl` (used to generate run IDs)
- Playwright browsers: `npx playwright install chromium`

## Setup

```bash
npm install
npx playwright install chromium
```

Copy the example env file if you need to override defaults:

```bash
cp .env.example .env
```

## Running tests

### Full run (build images + test)

```bash
./scripts/run-tests.sh
```

This will:
1. Build each service from its local repo with `--no-cache`, or pull the latest image from GHCR if the repo isn't present
2. Start the full Docker stack on port `9880`
3. Run all Playwright tests
4. Save all artifacts and tear down the stack

### Build a single service image

To rebuild only one service without touching the others:

```bash
docker build --no-cache -t neutrino-<svc>:test ../neutrino-<svc>
```

For example, to rebuild just the `auth` service:

```bash
docker build --no-cache -t neutrino-auth:test ../neutrino-auth
```

Then use `--skip-build` when running tests so the rest of the images are reused as-is:

```bash
./scripts/run-tests.sh --skip-build
```

### Skip image rebuild

Reuse existing `:test` images when iterating on tests:

```bash
./scripts/run-tests.sh --skip-build
```

### Run a specific test file

```bash
./scripts/run-tests.sh --skip-build tests/auth/login.spec.ts
```

### Run Playwright directly

If the stack is already running (e.g. started manually):

```bash
export RUN_DIR=/tmp/neutrino-e2e/manual
npx playwright test
```

## Viewing results

After a run the script prints the artifact directory:

```
Run artifacts saved to: /tmp/neutrino-e2e/20260328_120000_abc123de
```

Open the HTML report:

```bash
npx playwright show-report /tmp/neutrino-e2e/<run-id>/playwright-report
```

## Artifact layout

Every run produces a self-contained directory under `/tmp/neutrino-e2e/<run-id>/`:

```
<run-id>/
├── .run_meta.json          # Run ID, start time
├── data/                   # SQLite databases (live, written by services)
│   ├── auth/
│   ├── drive/
│   └── ...
├── databases/              # Database snapshots copied at teardown
│   ├── auth_auth.db
│   └── ...
├── service-logs/           # Per-service runtime logs
│   ├── auth/               # Written live by the service
│   ├── auth.log            # Docker stdout/stderr captured at teardown
│   └── ...
├── browser-logs/           # Console messages + network log per test (JSON)
├── playwright-artifacts/   # Traces, screenshots, videos (outputDir)
└── playwright-report/      # HTML report (open with show-report)
```

## Image strategy

| Situation | What happens |
|---|---|
| Local repo exists (`../neutrino-<svc>`) | `docker build --no-cache` from source |
| Local repo missing | `docker pull ghcr.io/$GHCR_OWNER/neutrino-<svc>:latest` |

Set `GHCR_OWNER` in `.env` or as an environment variable (default: `williamcherry`).

All images are tagged `neutrino-<svc>:test` and the stack uses a dedicated `neutrino-test` network and port `9880`, so it never conflicts with a running dev environment on port `8880`.

## Port mapping

| Port | Service |
|---|---|
| `9880` | Web (nginx → all backends) |

All backend services are internal to the `neutrino-test` Docker network.

## Adding tests

1. Create a new spec file under `tests/`
2. Import `test` and `expect` from `../../fixtures/base` (not directly from `@playwright/test`) to get automatic console and network capture
3. Use `http://localhost:9880` as the base URL (configured in `playwright.config.ts`)
