/**
 * Document E2EE encryption tests.
 *
 * Verifies two properties for document content saved to the drive backend:
 *   1. The server holds an encrypted DEK (data encryption key) for the file.
 *   2. The raw stored bytes are ciphertext — not the plaintext TipTap JSON.
 *
 * Document content is written to the drive service via the `contentWriteUrl`
 * returned by the docs API. Both the initial content upload (server-side) and
 * subsequent browser saves (autosave and explicit save) must go through the
 * E2EE encryption path so that the server never sees plaintext.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `e2e_doc_enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Doc Enc User', email, password },
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

test.describe('Document E2EE encryption', () => {
  test('creating a document via the UI stores an encrypted DEK on the server', async ({
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

    await page.goto('/docs');

    // Register the listener before clicking to avoid a race where the initial
    // content upload completes before waitForResponse is set up.
    const uploadPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: /new document/i }).first().click();
    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });

    const docId = new URL(page.url()).searchParams.get('id')!;
    expect(docId, 'doc ID must be present in URL').toBeTruthy();

    // Wait for the editor to finish its initial content upload.
    await uploadPromise;

    // The server must store an encrypted DEK for this file.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `server must hold an encrypted DEK for the document (got ${keyRes.status()})`,
    ).toBeTruthy();

    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(typeof keyData.encryptedFileKey, 'encryptedFileKey must be a string').toBe('string');
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);
  });

  test('document raw bytes stored on the server are not the plaintext TipTap JSON', async ({
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

    await page.goto('/docs');

    const uploadPromise2 = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: /new document/i }).first().click();
    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });

    const docId = new URL(page.url()).searchParams.get('id')!;

    // Wait for the initial content to be written to the drive backend.
    await uploadPromise2;

    // Download the raw bytes the server holds for this file.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();

    const rawText = (await downloadRes.body()).toString('utf8');

    // The server-stored blob must not contain recognisable TipTap JSON keys.
    expect(rawText, 'server must not store TipTap JSON structure in plaintext').not.toContain('"type":"doc"');
    expect(rawText, 'server must not store TipTap content key in plaintext').not.toContain('"content"');
  });

  test('document text typed by the user and autosaved is stored as ciphertext', async ({
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

    await page.goto('/docs');

    const uploadPromise3 = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: /new document/i }).first().click();
    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });

    const docId = new URL(page.url()).searchParams.get('id')!;

    // Wait for the editor toolbar/back button to confirm the editor is ready.
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 10_000 });

    // Drain the initial upload before listening for the autosave.
    await uploadPromise3;

    // Type a distinctive phrase into the document body.
    const secretPhrase = `confidential-doc-${Date.now()}-secret-payload`;
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();

    // Register autosave listener before typing to avoid race with debounce flush.
    // Autosave sends PUT to /autosave; manual save sends POST to /versions.
    const saveResPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${docId}`) &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 30_000 },
    );

    await editor.pressSequentially(secretPhrase);

    // Wait for the autosave to post the updated content to the drive backend.
    const saveRes = await saveResPromise;
    expect(saveRes.ok(), `autosave must succeed (got ${saveRes.status()})`).toBeTruthy();

    // The saved bytes must not expose the typed text in plaintext.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not expose typed document text in plaintext').not.toContain(secretPhrase);
    expect(rawText, 'server must not expose "confidential" in plaintext').not.toContain('confidential-doc');
  });
});
