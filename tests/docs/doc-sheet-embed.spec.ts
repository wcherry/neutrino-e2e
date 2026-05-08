import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_embed_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<{ token: string }> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Docs Embed Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return { token };
}

async function createDocAndNavigate(
  request: APIRequestContext,
  page: Page,
  token: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/docs`, {
    data: { title: 'Sheet Embed Test Doc' },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  expect(res.ok(), `createDoc failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const doc = await res.json() as { id: string };
  await page.goto(`/docs/editor?id=${doc.id}`);
  await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 15_000 });
  return doc.id;
}

async function createSpreadsheetViaApi(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; sheetId: string }> {
  const res = await request.post(`${BASE_URL}/api/v1/sheets`, {
    data: { title: 'Embed Source Sheet' },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  expect(res.ok(), `createSheet failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const sheet = await res.json() as { id: string };
  // sheetId "0" is the default first tab in the sheet model
  return { id: sheet.id, sheetId: '0' };
}

async function createNamedRangeViaApi(
  request: APIRequestContext,
  token: string,
  sheetDbId: string,
  sheetId: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/sheets/${sheetDbId}/named-ranges`, {
    data: {
      sheetDbId,
      sheetId,
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 2,
    },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  expect(res.ok(), `createNamedRange failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const range = await res.json() as { id: string };
  return range.id;
}

async function deleteFileViaApi(
  request: APIRequestContext,
  token: string,
  fileId: string,
): Promise<void> {
  const res = await request.delete(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `deleteFile failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** Build a clipboard payload that mimics what the Sheets app writes when the
 *  user copies a selection. */
function buildSelectionPayload(spreadsheetId: string, sheetId: string, namedRangeId: string) {
  return {
    spreadsheetId,
    sheetId,
    namedRangeId,
    previewData: [
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
      ['A3', 'B3', 'C3'],
    ],
    title: 'Embed Source Sheet',
  };
}

/** Write the Neutrino sheet-selection MIME type to the clipboard using page.evaluate. */
async function writeSheetSelectionToClipboard(page: Page, payload: object): Promise<void> {
  await page.evaluate((p) => {
    const item = new ClipboardItem({
      'application/x-neutrino-sheet-selection': new Blob(
        [JSON.stringify(p)],
        { type: 'application/x-neutrino-sheet-selection' },
      ),
      'text/plain': new Blob(
        [(p as { previewData: string[][] }).previewData
          .map((r: string[]) => r.join('\t'))
          .join('\n')],
        { type: 'text/plain' },
      ),
    });
    return navigator.clipboard.write([item]);
  }, payload);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

test.describe('Paste dialog', () => {
  test('shows paste dialog when pasting sheet selection', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
  });
});

test.describe('Static paste', () => {
  test('paste as table inserts a static table', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="paste-as-table-btn"]').click();

    // A plain table should appear in the editor
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 8_000 });
    // No live embed block should be present
    await expect(page.locator('[data-testid="sheet-embed"]')).not.toBeVisible();
  });
});

test.describe('Live embed', () => {
  test('paste as live view inserts embed block', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="paste-as-live-btn"]').click();

    await expect(page.locator('[data-testid="sheet-embed-table"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('refresh button re-fetches data', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="paste-as-live-btn"]').click();
    await expect(page.locator('[data-testid="sheet-embed-table"]')).toBeVisible({
      timeout: 15_000,
    });

    // Click refresh and wait for the embed data network request to complete
    const refreshDone = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/sheets/${sheetDbId}/embed/`) &&
        r.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.locator('[data-testid="sheet-embed-refresh-btn"]').click();
    await refreshDone;

    // Embed table should still be present after the re-fetch
    await expect(page.locator('[data-testid="sheet-embed-table"]')).toBeVisible();
  });
});

test.describe('Deleted sheet fallback', () => {
  test('shows fallback when spreadsheet is deleted', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    const docId = await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="paste-as-live-btn"]').click();
    await expect(page.locator('[data-testid="sheet-embed-table"]')).toBeVisible({
      timeout: 15_000,
    });

    // Delete the underlying spreadsheet via the drive API
    await deleteFileViaApi(request, token, sheetDbId);

    // Reload the doc — the embed renderer will try to fetch and should show deleted state
    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="sheet-embed-deleted-state"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('convert to static replaces embed with table', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    const docId = await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="paste-as-live-btn"]').click();
    await expect(page.locator('[data-testid="sheet-embed-table"]')).toBeVisible({
      timeout: 15_000,
    });

    // Delete the underlying spreadsheet
    await deleteFileViaApi(request, token, sheetDbId);

    // Reload to trigger the deleted state
    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="sheet-embed-deleted-state"]')).toBeVisible({
      timeout: 15_000,
    });

    // Convert the embed to a static table
    await page.locator('[data-testid="sheet-embed-convert-btn"]').click();

    // A plain table should replace the embed
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="sheet-embed"]')).not.toBeVisible();
  });

  test('remove embed deletes the block', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page);
    const docId = await createDocAndNavigate(request, page, token);

    const { id: sheetDbId, sheetId } = await createSpreadsheetViaApi(request, token);
    const namedRangeId = await createNamedRangeViaApi(request, token, sheetDbId, sheetId);
    const payload = buildSelectionPayload(sheetDbId, sheetId, namedRangeId);

    const editorBody = page.locator('.ProseMirror');
    await editorBody.click();
    await writeSheetSelectionToClipboard(page, payload);
    await page.keyboard.press('Control+V');

    await expect(page.locator('[data-testid="paste-choice-dialog"]')).toBeVisible({
      timeout: 8_000,
    });
    await page.locator('[data-testid="paste-as-live-btn"]').click();
    await expect(page.locator('[data-testid="sheet-embed-table"]')).toBeVisible({
      timeout: 15_000,
    });

    // Delete the underlying spreadsheet
    await deleteFileViaApi(request, token, sheetDbId);

    // Reload to trigger the deleted state
    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="sheet-embed-deleted-state"]')).toBeVisible({
      timeout: 15_000,
    });

    // Remove the embed block entirely
    await page.locator('[data-testid="sheet-embed-remove-btn"]').click();

    // Neither the embed block nor any table should remain in the editor
    await expect(page.locator('[data-testid="sheet-embed"]')).not.toBeVisible();
    await expect(page.locator('.ProseMirror table')).not.toBeVisible();
  });
});
