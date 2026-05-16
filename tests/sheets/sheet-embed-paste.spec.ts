import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const SHEET_SELECTION_MIME = 'application/x-neutrino-sheet-selection';

function uniqueEmail(): string {
  return `sheet_embed_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Sheet Embed Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function createSpreadsheet(page: Page): Promise<string> {
  await page.goto('/sheets');
  await expect(page.getByRole('button', { name: /new spreadsheet/i })).toHaveCount(2, {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Sheets' })).toBeVisible({ timeout: 10_000 });
  const match = page.url().match(/[?&]id=([^&]+)/);
  if (!match) throw new Error(`Could not extract spreadsheet ID from URL: ${page.url()}`);
  return match[1];
}

async function createDoc(page: Page): Promise<void> {
  await page.goto('/docs');
  await expect(page.getByRole('button', { name: /new document/i })).toHaveCount(2, {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /new document/i }).first().click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 10_000 });
}

async function dispatchSheetPaste(page: Page, spreadsheetId: string): Promise<void> {
  const previewData = [
    ['Q1 Revenue', 'Q2 Revenue'],
    ['12500', '15800'],
  ];
  const payload = JSON.stringify({
    spreadsheetId,
    sheetId: '0',
    startRow: 0,
    startCol: 0,
    endRow: 1,
    endCol: 1,
    previewData,
  });

  await page.evaluate(
    ({ mimeType, payloadStr }) => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) throw new Error('.ProseMirror not found');
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === mimeType ? payloadStr : ''),
          setData: () => {},
          clearData: () => {},
          files: [],
          items: [],
          types: [mimeType],
        },
      });
      editor.dispatchEvent(event);
    },
    { mimeType: SHEET_SELECTION_MIME, payloadStr: payload },
  );
}

test.describe('Sheet embed paste into doc', () => {
  test('paste as table inserts a static HTML table in the doc editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDoc(page);

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();

    await dispatchSheetPaste(page, 'fake-spreadsheet-id');

    await expect(page.getByTestId('paste-choice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('paste-as-table-btn').click();

    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 5_000 });
    await expect(table).toContainText('Q1 Revenue');
    await expect(table).toContainText('12500');
  });

  test('paste as live view inserts a sheet embed block in the doc editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const spreadsheetId = await createSpreadsheet(page);
    await createDoc(page);

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();

    const namedRangeCreated = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/sheets/${spreadsheetId}/named-ranges`) &&
        r.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await dispatchSheetPaste(page, spreadsheetId);

    await expect(page.getByTestId('paste-choice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('paste-as-live-btn').click();

    await namedRangeCreated;

    await expect(page.getByTestId('sheet-embed')).toBeVisible({ timeout: 10_000 });
  });
});
