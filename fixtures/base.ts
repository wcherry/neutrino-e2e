import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface ConsoleMessage {
  type: string;
  text: string;
  location: string;
}

interface NetworkEntry {
  direction: 'request' | 'response';
  method?: string;
  url: string;
  status?: number;
  contentType?: string | null;
  timestamp: string;
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleLogs: ConsoleMessage[] = [];
    const networkLog: NetworkEntry[] = [];

    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url ?? '',
      });
    });

    page.on('request', req => {
      networkLog.push({
        direction: 'request',
        method: req.method(),
        url: req.url(),
        timestamp: new Date().toISOString(),
      });
    });

    page.on('response', res => {
      networkLog.push({
        direction: 'response',
        url: res.url(),
        status: res.status(),
        contentType: res.headers()['content-type'] ?? null,
        timestamp: new Date().toISOString(),
      });
    });

    await use(page);

    // Save browser logs after each test
    const runDir = process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default';
    const logsDir = path.join(runDir, 'browser-logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const safeName = testInfo.titlePath
      .join('__')
      .replace(/[^a-z0-9_\-]/gi, '_')
      .substring(0, 200);

    const logPath = path.join(logsDir, `${safeName}.json`);
    fs.writeFileSync(logPath, JSON.stringify({ consoleLogs, networkLog }, null, 2));
  },
});

export { expect };
