import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const COMPOSE_FILE = path.resolve(__dirname, 'docker-compose-test.yml');

const SERVICES = ['auth', 'drive', 'docs', 'sheets', 'slides', 'photos', 'worker', 'web'];

function readRunDir(): string {
  const runDir = process.env.RUN_DIR;
  if (runDir && fs.existsSync(runDir)) return runDir;

  // Fall back to reading the meta file written during setup
  const metaPath = runDir ? path.join(runDir, '.run_meta.json') : null;
  if (metaPath && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.runDir as string;
  }

  throw new Error('Cannot determine RUN_DIR in teardown');
}

function saveServiceLogs(runDir: string): void {
  console.log('Saving service logs...');
  for (const svc of SERVICES) {
    const logFile = path.join(runDir, 'service-logs', `${svc}.log`);
    try {
      execSync(
        `docker compose -f "${COMPOSE_FILE}" logs --no-color "${svc}" > "${logFile}" 2>&1`,
        { env: { ...process.env }, shell: '/bin/bash' },
      );
    } catch {
      // Non-fatal: service may not have started
      fs.writeFileSync(logFile, `(failed to retrieve logs for ${svc})\n`);
    }
  }
}

function snapshotDatabases(runDir: string): void {
  console.log('Snapshotting databases...');
  const dataDir = path.join(runDir, 'data');
  const dbDir = path.join(runDir, 'databases');

  if (!fs.existsSync(dataDir)) return;

  for (const svc of fs.readdirSync(dataDir)) {
    const svcDataDir = path.join(dataDir, svc);
    if (!fs.statSync(svcDataDir).isDirectory()) continue;

    for (const file of fs.readdirSync(svcDataDir)) {
      if (file.endsWith('.db')) {
        const src = path.join(svcDataDir, file);
        const dest = path.join(dbDir, `${svc}_${file}`);
        try {
          fs.copyFileSync(src, dest);
        } catch {
          // Non-fatal
        }
      }
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  let runDir: string;
  try {
    runDir = readRunDir();
  } catch (err) {
    console.error('Teardown: could not determine RUN_DIR:', err);
    runDir = '';
  }

  if (runDir) {
    saveServiceLogs(runDir);
    snapshotDatabases(runDir);
  }

  console.log('Stopping Docker stack...');
  try {
    execSync(`docker compose -f "${COMPOSE_FILE}" down`, {
      stdio: 'inherit',
      env: { ...process.env },
    });
  } catch (err) {
    console.error('Failed to stop Docker stack:', err);
  }

  if (runDir) {
    console.log(`\nArtifacts saved to: ${runDir}`);
  }
}
