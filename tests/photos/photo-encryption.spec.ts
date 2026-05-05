/**
 * Photo E2EE encryption tests.
 *
 * Verifies two properties for photo files uploaded through the Photos UI:
 *   1. The server holds an encrypted DEK (data encryption key) for the file.
 *   2. The raw stored bytes are ciphertext — not the original image bytes.
 *
 * Photos are first uploaded to the drive service, then registered in the Photos
 * service via the `fileId`. The drive file upload must use the E2EE encryption
 * path (`uploadEncryptedFile`) so that the server never stores the raw image.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

// Minimal valid JPEG (2×2 px, all black). Distinctive enough to verify
// that the stored bytes differ from this payload.
const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAAEAAQDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAHhAAAA' +
  'YDAQAAAAAAAAAAAAAAAQIDBAUREiH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
  'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AMpQrV2nTUBkLCACdMHRjbwQg0BAAAAAAAA//2Q==',
  'base64',
);

function uniqueEmail(): string {
  return `e2e_photo_enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Photo Enc User', email, password },
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

test.describe('Photo E2EE encryption', () => {
  test('a photo uploaded via the Photos UI stores an encrypted DEK on the server', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for the E2EE keypair so the photo upload uses the encrypted path.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/photos');
    // Wait for the app to fully initialize — ensures currentUser is loaded in
    // React Query so the upload mutation takes the E2EE path.
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15_000 });

    // Register the response listener BEFORE triggering the upload to avoid a
    // race where a fast local stack completes the full upload chain before the
    // listener is set up (waitForResponse only catches future responses).
    const registerResPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const [fileChooser1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
    ]);
    await fileChooser1.setFiles([
      {
        name: 'test-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: MINIMAL_JPEG,
      },
    ]);

    // Wait for the photo to be registered in the Photos service.
    const registerRes = await registerResPromise;
    expect(registerRes.ok(), `photo registration must succeed (got ${registerRes.status()})`).toBeTruthy();

    // Retrieve the photo record to get the backing drive file ID.
    const listRes = await request.get(`${BASE_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok(), `listing photos must succeed: ${listRes.status()}`).toBeTruthy();
    const { photos } = await listRes.json() as { photos: { id: string; fileId: string }[] };
    expect(photos.length, 'at least one photo must be present after upload').toBeGreaterThan(0);

    const fileId = photos[0].fileId;

    // The drive file must have an encrypted DEK stored on the server.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `server must hold an encrypted DEK for the photo's drive file (got ${keyRes.status()})`,
    ).toBeTruthy();

    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(typeof keyData.encryptedFileKey, 'encryptedFileKey must be a string').toBe('string');
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);
  });

  test('photo raw bytes stored on the server are not the original image bytes', async ({
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

    await page.goto('/photos');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15_000 });

    const registerResPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const [fileChooser2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
    ]);
    await fileChooser2.setFiles([
      {
        name: 'test-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: MINIMAL_JPEG,
      },
    ]);

    const registerRes = await registerResPromise;
    expect(registerRes.ok()).toBeTruthy();

    const listRes = await request.get(`${BASE_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { photos } = await listRes.json() as { photos: { id: string; fileId: string }[] };
    expect(photos.length).toBeGreaterThan(0);

    const fileId = photos[0].fileId;

    // Download the raw bytes the server holds for this photo.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();

    const storedBytes = await downloadRes.body();

    // The JPEG magic bytes (FF D8 FF) must not appear in the stored blob —
    // if they do, the file was stored as plaintext rather than ciphertext.
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
    expect(
      storedBytes.includes(jpegMagic),
      'server must not store the raw JPEG magic bytes — file must be encrypted',
    ).toBe(false);

    // The stored blob must differ from the original upload bytes.
    expect(
      storedBytes.equals(MINIMAL_JPEG),
      'server must not store the original image bytes verbatim',
    ).toBe(false);
  });

  test('a photo uploaded via the Photos UI is larger than the plaintext due to encryption overhead', async ({
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

    await page.goto('/photos');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15_000 });

    const uploadDonePromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const [fileChooser3] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
    ]);
    await fileChooser3.setFiles([
      {
        name: 'test-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: MINIMAL_JPEG,
      },
    ]);
    await uploadDonePromise;

    const listRes = await request.get(`${BASE_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { photos } = await listRes.json() as { photos: { id: string; fileId: string }[] };
    const fileId = photos[0].fileId;

    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const storedBytes = await downloadRes.body();

    // Encrypted content is larger than plaintext due to AEAD overhead
    // (24-byte nonce + 16-byte Poly1305 tag minimum).
    expect(
      storedBytes.length,
      'ciphertext must be larger than plaintext due to encryption overhead',
    ).toBeGreaterThan(MINIMAL_JPEG.length);
  });
});
