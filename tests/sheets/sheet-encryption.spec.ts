/**
 * Spreadsheet E2EE encryption tests.
 *
 * Verifies two properties for spreadsheet content saved to the drive backend:
 *   1. The server holds an encrypted DEK (data encryption key) for the file.
 *   2. The raw stored bytes are ciphertext — not the plaintext FortuneSheet JSON.
 *
 * Spreadsheet content is written to the drive service via the `contentWriteUrl`
 * returned by the sheets API. Both the initial content upload (server-side) and
 * subsequent browser saves must go through the E2EE encryption path so that the
 * server never sees plaintext.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `e2e_sheet_enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Sheet Enc User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function getUserId(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `profile fetch failed: ${res.status()}`).toBeTruthy();
  const profile = await res.json() as { id: string };
  return profile.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Spreadsheet E2EE encryption', () => {
  test('creating a spreadsheet via the UI stores an encrypted DEK on the server', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for the E2EE keypair so the initial content upload uses the encrypted path.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/sheets');

    // Register the listener before clicking to avoid a race where the initial
    // content upload completes before waitForResponse is set up.
    const contentUploadPromise1 = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
    await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });

    const sheetId = new URL(page.url()).searchParams.get('id')!;
    expect(sheetId, 'sheet ID must be present in URL').toBeTruthy();

    // Wait for the editor to finish its initial content upload.
    await contentUploadPromise1;

    // The server must store an encrypted DEK for this file.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `server must hold an encrypted DEK for the spreadsheet (got ${keyRes.status()})`,
    ).toBeTruthy();

    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(typeof keyData.encryptedFileKey, 'encryptedFileKey must be a string').toBe('string');
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);
  });

  test('spreadsheet raw bytes stored on the server are not the plaintext FortuneSheet JSON', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/sheets');

    const contentUploadPromise2 = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
    await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });

    const sheetId = new URL(page.url()).searchParams.get('id')!;

    // Wait for the initial content to be written to the drive backend.
    await contentUploadPromise2;

    // Download the raw bytes the server holds for this file.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();

    const rawText = (await downloadRes.body()).toString('utf8');

    // The server-stored blob must not contain recognisable FortuneSheet JSON keys.
    expect(rawText, 'server must not store the FortuneSheet JSON structure in plaintext').not.toContain('"celldata"');
    expect(rawText, 'server must not store the sheet name in plaintext').not.toContain('"Sheet1"');
  });

  test('spreadsheet content typed by the user and saved is stored as ciphertext', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/sheets');
    await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
    await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });

    const sheetId = new URL(page.url()).searchParams.get('id')!;

    // Wait for the editor to be interactive.
    await expect(page.getByRole('button', { name: 'Sheets' })).toBeVisible({ timeout: 15_000 });

    // Click cell A1 and type a distinctive value.
    const distinctValue = `SECRET_CELL_${Date.now()}`;
    await page.locator('#A1').click();

    // Set up the save listener BEFORE typing so we don't miss a fast autosave.
    const saveResPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}`) &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 30_000 },
    );
    await page.keyboard.type(distinctValue);
    await page.keyboard.press('Enter');

    const saveRes = await saveResPromise;
    expect(saveRes.ok(), `autosave must succeed (got ${saveRes.status()})`).toBeTruthy();

    // The saved bytes must not expose the typed value in plaintext.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not expose typed cell value in plaintext').not.toContain(distinctValue);
  });
});
