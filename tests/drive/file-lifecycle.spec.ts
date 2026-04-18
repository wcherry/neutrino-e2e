import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `drive_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueFilename(): string {
  return `test-file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Drive Test User', email, password },
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

/** Upload a file via the Drive REST API and return its ID. */
async function uploadFileViaApi(
  request: APIRequestContext,
  token: string,
  fileName: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(`test content for ${fileName}`),
      },
    },
  });
  expect(res.ok(), `API upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/** Upload a file via the Upload dialog in the browser. */
async function uploadFileViaUI(page: Page, fileName: string): Promise<void> {
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The file input is display:none so we simulate a drop on the drop zone instead
  const dropZone = dialog.getByRole('button', { name: 'Drop files here or click to browse' });
  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'text/plain' }));
      return dt;
    },
    { name: fileName, content: `test content for ${fileName}` },
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

/** Hover the named list item and open its three-dot context menu. */
async function openContextMenu(page: Page, fileName: string): Promise<void> {
  await page.getByRole('listitem', { name: fileName }).first().hover();
  await page.getByLabel(`More options for ${fileName}`).click();
}

test.describe('Drive file lifecycle', () => {
  // ── Upload via UI ───────────────────────────────────────────────────────────

  test('uploaded file appears in My Drive: Files section', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const fileName = uniqueFilename();

    await page.goto('/drive');
    await uploadFileViaUI(page, fileName);

    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: fileName })).toBeVisible({
      timeout: 10_000,
    });
  });

  // ── Recent page ─────────────────────────────────────────────────────────────

  test('uploaded file appears in Recent page', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    await uploadFileViaApi(request, token, fileName);

    await page.goto('/drive/recent');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recent');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });
  });

  // ── Starred / Trash pages — fresh file must not appear ──────────────────────

  test('fresh file does not appear on Starred or Trash pages', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    await uploadFileViaApi(request, token, fileName);

    await page.goto('/drive/starred');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Starred');
    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible();

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible();
  });

  // ── Star / Favorite ─────────────────────────────────────────────────────────

  test('starring a file adds it to My Drive: Quick Access', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    await uploadFileViaApi(request, token, fileName);

    await page.goto('/drive');
    await openContextMenu(page, fileName);
    await page.getByRole('menuitem', { name: 'Star' }).click();

    const quickAccess = page.locator('[aria-labelledby="quick-access-heading"]');
    await expect(
      quickAccess.getByRole('button', { name: `Open ${fileName}` }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('starred file appears on the Starred page', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    await uploadFileViaApi(request, token, fileName);

    await page.goto('/drive');
    await openContextMenu(page, fileName);
    await page.getByRole('menuitem', { name: 'Star' }).click();

    // Wait for the Quick Access update to confirm the mutation completed
    const quickAccess = page.locator('[aria-labelledby="quick-access-heading"]');
    await expect(
      quickAccess.getByRole('button', { name: `Open ${fileName}` }),
    ).toBeVisible({ timeout: 10_000 });

    await page.goto('/drive/starred');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Starred');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });
  });

  // ── Move to trash ───────────────────────────────────────────────────────────

  test('moving a file to trash removes it from My Drive Files and Quick Access', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    await uploadFileViaApi(request, token, fileName);

    await page.goto('/drive');

    // Star the file so it appears in Quick Access, giving us a second thing to verify
    await openContextMenu(page, fileName);
    await page.getByRole('menuitem', { name: 'Star' }).click();
    const quickAccess = page.locator('[aria-labelledby="quick-access-heading"]');
    await expect(
      quickAccess.getByRole('button', { name: `Open ${fileName}` }),
    ).toBeVisible({ timeout: 10_000 });

    // Move to trash
    await openContextMenu(page, fileName);
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();

    // File must be gone from the Files section
    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: fileName })).not.toBeVisible({
      timeout: 10_000,
    });

    // File must be gone from Quick Access without a page reload
    await expect(
      quickAccess.getByRole('button', { name: `Open ${fileName}` }),
    ).not.toBeVisible({ timeout: 10_000 });
  });

  test('moving a file to trash removes it from Recent and Starred pages', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    const fileId = await uploadFileViaApi(request, token, fileName);

    // Star via API so the Starred page has something to verify against
    const patchRes = await request.patch(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { isStarred: true },
    });
    expect(patchRes.ok(), `star failed: ${patchRes.status()}`).toBeTruthy();

    // Recent page: file must appear before trashing
    await page.goto('/drive/recent');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recent');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });

    // Starred page: file must appear before trashing
    await page.goto('/drive/starred');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Starred');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });

    // Trash via the UI context menu
    await page.goto('/drive');
    await openContextMenu(page, fileName);
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: fileName })).not.toBeVisible({
      timeout: 10_000,
    });

    // Recent page: file must not appear after trashing
    await page.goto('/drive/recent');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recent');
    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible();

    // Starred page: file must not appear after trashing
    await page.goto('/drive/starred');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Starred');
    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible();
  });

  test('trashed file appears on the Trash page', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    await uploadFileViaApi(request, token, fileName);

    // Trash via the UI context menu
    await page.goto('/drive');
    await openContextMenu(page, fileName);
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: fileName })).not.toBeVisible({
      timeout: 10_000,
    });

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });
  });

  // ── Empty trash ─────────────────────────────────────────────────────────────

  test('emptying trash removes the file from the Trash page', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueFilename();
    const fileId = await uploadFileViaApi(request, token, fileName);

    // Trash via API (soft delete) to avoid navigating to /drive first
    const trashRes = await request.delete(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(trashRes.ok(), `trash failed: ${trashRes.status()}`).toBeTruthy();

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Empty trash' }).click();

    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
