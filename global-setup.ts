import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const COMPOSE_FILE = path.resolve(__dirname, 'docker-compose-test.yml');
const BASE_URL = 'http://localhost:9880';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

async function waitForStack(): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status < 500) {
        console.log(`Stack is ready (HTTP ${res.status})`);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Stack did not become ready within ${POLL_TIMEOUT_MS / 1000}s. Last error: ${lastError}`);
}

export default async function globalSetup(): Promise<void> {
  const runDir = process.env.RUN_DIR;
  if (!runDir) {
    // Fallback when running playwright directly without run-tests.sh
    const fallback = `/tmp/neutrino-e2e/manual_${Date.now()}`;
    process.env.RUN_DIR = fallback;
    fs.mkdirSync(fallback, { recursive: true });
    for (const sub of [
      'data/auth', 'data/drive', 'data/docs', 'data/sheets',
      'data/slides', 'data/photos', 'data/workers',
      'service-logs/auth', 'service-logs/drive', 'service-logs/docs',
      'service-logs/sheets', 'service-logs/slides', 'service-logs/photos',
      'service-logs/workers', 'browser-logs', 'databases', 'playwright-results',
    ]) {
      fs.mkdirSync(path.join(fallback, sub), { recursive: true });
    }
    console.log(`RUN_DIR not set — using fallback: ${fallback}`);
  }

  const activeRunDir = process.env.RUN_DIR!;

  // Write run metadata
  const meta = {
    runId: path.basename(activeRunDir),
    startedAt: new Date().toISOString(),
    runDir: activeRunDir,
  };
  fs.writeFileSync(path.join(activeRunDir, '.run_meta.json'), JSON.stringify(meta, null, 2));

  console.log('Starting Docker stack...');
  execSync(`docker compose -f "${COMPOSE_FILE}" up -d`, {
    stdio: 'inherit',
    env: { ...process.env },
  });

  console.log('Waiting for stack to be ready...');
  await waitForStack();
}
