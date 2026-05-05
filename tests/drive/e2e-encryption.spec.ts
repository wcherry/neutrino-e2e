/**
 * E2EE encryption tests.
 *
 * Validates two properties:
 *   1. After login, the Curve25519 keypair is stored in localStorage under
 *      `neutrino_e2e_{userId}` and contains a distinct secretKey (private key).
 *   2. Files uploaded via the UI are encrypted: the server holds an opaque
 *      encrypted DEK for the file, and the raw stored bytes are not the
 *      original plaintext.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  initSodium,
  decryptFile,
  decryptFileKey,
} from '../../../neutrino-web/packages/e2e-crypto/src/crypto';

const BASE_URL = 'http://localhost:9880';

// Host-side path to the drive service's storage directory.
// Matches the docker-compose mount: ./data/drive:/usr/local/data + STORAGE_PATH=/usr/local/data/storage
const runDir = process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default';
const STORAGE_PATH =  process.env.DRIVE_STORAGE_PATH ?? path.join(runDir, 'data/drive/storage');



// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(): string {
  return `e2e_enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueFilename(): string {
  return `enc-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`;
}

// Path pattern from store.rs: {RUN_DIR}/{STORAGE_PATH}/{user_id}/{file_id}
function readStoredFile(userId: string, fileId: string, versionId?: string): NonSharedBuffer {
    let diskFilePath;
    if(versionId) {
      diskFilePath = path.join(STORAGE_PATH, userId, 'versions', fileId, versionId);
    } else {
      diskFilePath = path.join(STORAGE_PATH, userId, fileId);
    }
    return fs.readFileSync(diskFilePath);
}

function fromBase64url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'E2E Enc User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

  return { email, password };
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

/** Upload a file via the Drive UI upload dialog. */
async function uploadFileViaUI(
  page: Page,
  fileName: string,
  content: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const dropZone = dialog.getByRole('button', { name: 'Drop files here or click to browse' });
  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'text/plain' }));
      return dt;
    },
    { name: fileName, content },
  );
  await dropZone.dispatchEvent('drop', { dataTransfer });

  await expect(dialog.locator('[role="progressbar"]')).toHaveAttribute(
    'aria-valuenow',
    '100',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

/** Return the ID of the most-recently uploaded file with the given name. */
async function findFileId(
  request: APIRequestContext,
  token: string,
  fileName: string,
): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/drive/files`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `file list failed: ${res.status()}`).toBeTruthy();
  const data = await res.json() as { files: { id: string; name: string }[] };
  const file = data.files.find((f) => f.name === fileName);
  if (!file) throw new Error(`File "${fileName}" not found in drive file list`);
  return file.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('E2EE key lifecycle and file encryption', () => {
  // ── 1. Keypair stored in localStorage ─────────────────────────────────────

  test('neutrino_e2e_{userId} is written to localStorage after login', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // ensureE2EKeys fires async after login — wait until the key appears.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    const raw = await page.evaluate(
      (key) => localStorage.getItem(key),
      `neutrino_e2e_${userId}`,
    );
    expect(raw, 'keypair entry must exist in localStorage').not.toBeNull();

    const stored = JSON.parse(raw!) as { publicKey: string; secretKey: string };
    expect(typeof stored.publicKey, 'publicKey must be a string').toBe('string');
    expect(typeof stored.secretKey, 'secretKey must be a string').toBe('string');
  });

  test('stored entry contains a secretKey (private key) distinct from publicKey', async ({
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

    const raw = await page.evaluate(
      (key) => localStorage.getItem(key),
      `neutrino_e2e_${userId}`,
    );
    const stored = JSON.parse(raw!) as { publicKey: string; secretKey: string };

    // Both keys should be non-empty base64url strings of 43 chars
    // (ceil(32 bytes * 4/3) without padding = 43 characters)
    expect(stored.publicKey.length, 'publicKey should be 43 chars (32-byte Curve25519)').toBe(43);
    expect(stored.secretKey.length, 'secretKey should be 43 chars (32-byte Curve25519)').toBe(43);

    // The private key must be distinct from the public key
    expect(stored.secretKey, 'secretKey must differ from publicKey').not.toBe(stored.publicKey);
  });

  // ── 2. Uploaded files are encrypted ───────────────────────────────────────

  test('uploading a file via UI stores an encrypted DEK on the server', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for the keypair to be ready so the upload uses the E2EE path.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `neutrino e2e secret content ${Date.now()}`;
    await uploadFileViaUI(page, fileName, plaintext);

    const fileId = await findFileId(request, token, fileName);

    // The server must have a key ref for this file.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK on server but got ${keyRes.status()}`,
    ).toBeTruthy();

    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(
      typeof keyData.encryptedFileKey,
      'encryptedFileKey must be a string',
    ).toBe('string');
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);
  });

  test('raw bytes stored on the server are not the original plaintext', async ({
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

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `top secret ${Date.now()} do not expose`;
    await uploadFileViaUI(page, fileName, plaintext);

    const fileId = await findFileId(request, token, fileName);

    // Download the raw blob the server stored.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();

    const rawBody = await downloadRes.body();
    const rawText = rawBody.toString('utf8');

    // The server-stored blob must not contain the original plaintext string.
    expect(rawText, 'server must not store plaintext').not.toContain('top secret');
    expect(rawText, 'server must not store plaintext').not.toContain('do not expose');

    // The raw bytes should also be longer than the plaintext due to AEAD
    // overhead (24-byte header + 17-byte Poly1305 tag).
    expect(
      rawBody.length,
      'ciphertext must be larger than plaintext due to encryption overhead',
    ).toBeGreaterThan(Buffer.byteLength(plaintext, 'utf8'));
  });

  // ── 3. Downloaded file is decrypted ───────────────────────────────────────

  test('downloading an encrypted file via the UI yields the original plaintext', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for keypair so the upload uses the E2EE path.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `decryption e2e test ${Date.now()} secret payload`;
    await uploadFileViaUI(page, fileName, plaintext);

    // Wait for the file card to appear in the grid.
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 10_000 });

    // Open the context menu for the file.
    await page.getByRole('button', { name: `More options for ${fileName}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Download' })).toBeVisible({ timeout: 5_000 });

    // Intercept the download triggered by handleDownload.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download' }).click();
    const download = await downloadPromise;

    // Read the downloaded file content.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const downloadedText = Buffer.concat(chunks).toString('utf8');

    expect(downloadedText, 'downloaded content must match original plaintext').toBe(plaintext);
  });

  // ── 4. File and version snapshot are both encrypted on disk and end-to-end ─

  test('file bytes and auto-created version snapshot are both stored as ciphertext on disk and are E2EE', async ({
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

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `disk-and-e2e encryption test ${Date.now()} secret payload`;
    await uploadFileViaUI(page, fileName, plaintext);

    const fileId = await findFileId(request, token, fileName);

    // Download the bytes the server serves — this is the E2EE ciphertext.
    const apiRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(apiRes.ok(), `download failed: ${apiRes.status()}`).toBeTruthy();
    const serverBytes = await apiRes.body();

    // ── Disk: main file ──────────────────────────────────────────────────────
    const diskFileBytes = readStoredFile(userId, fileId);

    expect(
      diskFileBytes.toString('utf8'),
      'main file on disk must not contain plaintext',
    ).not.toContain(plaintext.slice(0, 20));
    // Server stores the E2EE ciphertext as-is — disk bytes must equal what the API serves.
    expect(
      diskFileBytes.equals(serverBytes),
      'disk bytes must match the E2EE ciphertext served by the API',
    ).toBe(true);

    // ── Disk: version 1 snapshot ─────────────────────────────────────────────
    // Version 1 is created automatically in finalize_upload by copying the main file.
    // Path pattern from store.rs: {STORAGE_PATH}/{user_id}/versions/{file_id}/{version_id}
    const versionsRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(versionsRes.ok()).toBeTruthy();
    const { versions } = await versionsRes.json() as {
      versions: { id: string; versionNumber: number }[];
    };
    expect(
      versions.length,
      'version 1 snapshot must be created automatically on upload',
    ).toBeGreaterThan(0);

    const v1 = [...versions].sort((a, b) => a.versionNumber - b.versionNumber)[0];
    const diskVersionBytes = readStoredFile(userId, fileId, v1.id);

    expect(
      diskVersionBytes.toString('utf8'),
      'version snapshot on disk must not contain plaintext',
    ).not.toContain(plaintext.slice(0, 20));
    // Version 1 is a byte-for-byte copy of the file at upload time — same E2EE ciphertext.
    expect(
      diskVersionBytes.equals(serverBytes),
      'version snapshot bytes must equal the E2EE ciphertext of the main file',
    ).toBe(true);

    // ── E2EE round-trip: client can decrypt server bytes back to plaintext ───
    const storedKeyPairRaw = await page.evaluate(
      (currentUserId) => localStorage.getItem(`neutrino_e2e_${currentUserId}`),
      userId,
    );
    expect(storedKeyPairRaw, 'client keypair must remain available for decryption').not.toBeNull();

    const storedKeyPair = JSON.parse(storedKeyPairRaw!) as { publicKey: string; secretKey: string };
    await initSodium();

    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(keyRes.ok(), `file key fetch failed: ${keyRes.status()}`).toBeTruthy();
    const { encryptedFileKey } = await keyRes.json() as { encryptedFileKey: string };

    const dek = decryptFileKey(
      encryptedFileKey,
      fromBase64url(storedKeyPair.publicKey),
      fromBase64url(storedKeyPair.secretKey),
    );

    const cipherBytes = new Uint8Array(serverBytes);
    const decrypted = new TextDecoder().decode(decryptFile(cipherBytes, dek));

    expect(
      decrypted,
      'client must decrypt server bytes back to the original plaintext',
    ).toBe(plaintext);
  });

  test('encrypted DEK cannot be read by a different user', async ({ page, request }) => {
    test.setTimeout(60_000);
    // Register owner and upload an encrypted file.
    await registerAndLogin(request, page);
    const ownerToken = await getAuthToken(page);
    const ownerId = await getUserId(request, ownerToken);

    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${ownerId}`,
      { timeout: 10_000 },
    );

    await page.goto('/drive');
    const fileName = uniqueFilename();
    await uploadFileViaUI(page, fileName, 'owner only content');
    const fileId = await findFileId(request, ownerToken, fileName);

    // Register a second user.
    const otherEmail = uniqueEmail();
    const regRes = await request.post(`${BASE_URL}/api/v1/auth/register`, {
      data: { name: 'Other User', email: otherEmail, password: 'Password123!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(regRes.ok()).toBeTruthy();
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: otherEmail, password: 'Password123!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { accessToken: otherToken } = await loginRes.json() as { accessToken: string };

    // The other user must not be able to fetch the owner's file key.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    // Expect 403 (forbidden) or 404 (not found) — not 200.
    expect(
      [403, 404],
      `other user must not see the encrypted DEK, got ${keyRes.status()}`,
    ).toContain(keyRes.status());
  });
});

// ---------------------------------------------------------------------------
// E2EE for sheets, docs, slides, and photos
// ---------------------------------------------------------------------------

test.describe('E2EE for sheets, docs, slides, and photos', () => {
  // ── Shared helpers ─────────────────────────────────────────────────────────

  async function loginUser(
    request: APIRequestContext,
    page: Page,
  ): Promise<{ token: string; userId: string }> {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );
    return { token, userId };
  }

  // ── Sheets ─────────────────────────────────────────────────────────────────

  test('creating a sheet stores an encrypted DEK and encrypted content on the server', async ({
    page,
    request,
  }) => {
    const { token } = await loginUser(request, page);

    await page.goto('/sheets');
    await page.getByRole('button', { name: 'New Spreadsheet' }).first().click();

    // Wait until the editor page loads (URL changes to /sheets/editor)
    await expect(page).toHaveURL(/\/sheets\/editor/, { timeout: 30_000 });

    // Extract the sheet ID from the URL
    const url = page.url();
    const sheetId = new URL(url).searchParams.get('id');
    expect(sheetId, 'sheet ID must be present in editor URL').toBeTruthy();

    // Verify an encrypted DEK is stored for the sheet
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for sheet but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    // Verify the stored content is not the plaintext initial JSON
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext sheet JSON').not.toContain('"celldata"');
    expect(rawText, 'server must not store plaintext sheet JSON').not.toContain('"Sheet1"');
  });

  // ── Docs ───────────────────────────────────────────────────────────────────

  test('creating a doc stores an encrypted DEK and encrypted content on the server', async ({
    page,
    request,
  }) => {
    const { token } = await loginUser(request, page);

    await page.goto('/docs');
    await page.getByRole('button', { name: 'New Document' }).first().click();

    await expect(page).toHaveURL(/\/docs\/editor/, { timeout: 30_000 });

    const url = page.url();
    const docId = new URL(url).searchParams.get('id');
    expect(docId, 'doc ID must be present in editor URL').toBeTruthy();

    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for doc but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext doc JSON').not.toContain('"type":"doc"');
    expect(rawText, 'server must not store plaintext doc JSON').not.toContain('"content":[]');
  });

  // ── Slides ─────────────────────────────────────────────────────────────────

  test('creating a slide stores an encrypted DEK and encrypted content on the server', async ({
    page,
    request,
  }) => {
    const { token } = await loginUser(request, page);

    await page.goto('/slides');
    await page.getByRole('button', { name: 'New Presentation' }).first().click();

    await expect(page).toHaveURL(/\/slides\/editor/, { timeout: 30_000 });

    const url = page.url();
    const slideId = new URL(url).searchParams.get('id');
    expect(slideId, 'slide ID must be present in editor URL').toBeTruthy();

    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${slideId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for slide but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${slideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext slide JSON').not.toContain('"slides"');
    expect(rawText, 'server must not store plaintext slide JSON').not.toContain('"theme"');
  });

  // ── Photos ─────────────────────────────────────────────────────────────────

  test('uploading a photo stores an encrypted DEK and encrypted bytes on the server', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { token } = await loginUser(request, page);

    await page.goto('/photos');
    // Wait for currentUser to be loaded in React Query so the upload takes the E2EE path.
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15_000 });

    // Create a small synthetic JPEG-like binary (1×1 pixel placeholder)
    const photoContent = 'E2EE-photo-test-payload-' + Date.now();
    const fileName = `e2e-photo-${Date.now()}.jpg`;

    const photoRegistrationPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
    ]);
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photoContent, 'utf8'),
    });
    await photoRegistrationPromise;

    // Find the uploaded file via the photos API to get the backing drive file ID.
    const photosRes = await request.get(`${BASE_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(photosRes.ok()).toBeTruthy();
    const { photos: photosList } = await photosRes.json() as { photos: { id: string; fileId: string }[] };
    expect(photosList.length, 'at least one photo must exist after upload').toBeGreaterThan(0);
    const fileId = photosList[0].fileId;

    // Verify encrypted DEK was stored
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for photo but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    // Verify the stored bytes are not the original plaintext
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext photo content').not.toContain('E2EE-photo-test-payload');
  });
});
