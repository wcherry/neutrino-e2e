import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `notes_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Notes Test User', email, password },
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

/** Create a note via the API and return its ID. */
async function createNoteViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/notes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/** Click the first block view area to enter edit mode and fill it with content, then blur. */
async function typeInFirstBlock(page: Page, content: string): Promise<void> {
  // The textarea only exists in edit mode; click the view div first to enter edit mode.
  // For an empty block the view div shows the placeholder text.
  await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
  const blockInput = page.getByRole('textbox', { name: 'Block 1' });
  await expect(blockInput).toBeVisible({ timeout: 5_000 });
  await blockInput.fill(content);
  // Blur by clicking the title input (outside blocks)
  await page.getByLabel('Note title').click();
  // Wait for view mode to render (textarea disappears)
  await expect(blockInput).not.toBeVisible({ timeout: 5_000 });
}

test.describe('Notes lifecycle', () => {
  // ── Empty state ──────────────────────────────────────────────────────────────

  test('empty Notes page shows New Note buttons', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/notes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Notes');
    await expect(page.getByRole('button', { name: /new note/i })).toHaveCount(2);
  });

  // ── Create → rename → back → list ────────────────────────────────────────────

  test('creating a note, renaming it, and going back shows it in the list', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/notes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Notes', {
      timeout: 10_000,
    });

    // Click the header "New Note" button
    await page.getByRole('button', { name: /new note/i }).first().click();
    await expect(page).toHaveURL(/\/notes\/editor\/?\?id=/, { timeout: 15_000 });

    // Rename the note
    const titleInput = page.getByLabel('Note title');
    await titleInput.fill('My First Note');

    // Wait for the autosave PATCH
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/notes/') && r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );
    await titleInput.blur();
    await titleSaved;

    // Navigate back
    await page.goto('/notes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Notes');

    // The renamed note must appear in the list
    await expect(page.getByRole('listitem', { name: 'My First Note' })).toBeVisible({
      timeout: 10_000,
    });
  });

  // ── Delete a note ─────────────────────────────────────────────────────────────

  test('deleting a note removes it from the list', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Note To Delete');

    await page.goto('/notes');
    await expect(page.getByRole('listitem', { name: 'Note To Delete' })).toBeVisible({
      timeout: 10_000,
    });

    // Delete via API
    const delRes = await request.delete(`${BASE_URL}/api/v1/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok(), `delete failed: ${delRes.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByRole('listitem', { name: 'Note To Delete' })).not.toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Notes markdown rendering', () => {
  // ── Bold ─────────────────────────────────────────────────────────────────────

  test('**text** renders as <strong>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Bold Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '**bold text**');

    await expect(page.locator('strong', { hasText: 'bold text' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Italic ────────────────────────────────────────────────────────────────────

  test('*text* renders as <em>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Italic Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '*italic text*');

    await expect(page.locator('em', { hasText: 'italic text' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Inline code ───────────────────────────────────────────────────────────────

  test('`code` renders as <code>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Code Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '`inline code`');

    await expect(page.locator('code', { hasText: 'inline code' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Strikethrough ─────────────────────────────────────────────────────────────

  test('~~text~~ renders as <s>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Strikethrough Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '~~struck through~~');

    await expect(page.locator('s', { hasText: 'struck through' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Heading 1 ─────────────────────────────────────────────────────────────────

  test('# Heading renders as <h1>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Heading 1 Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '# Section Title');

    await expect(page.locator('h1', { hasText: 'Section Title' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Heading 2 ─────────────────────────────────────────────────────────────────

  test('## Heading renders as <h2>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Heading 2 Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '## Sub Section');

    await expect(page.locator('h2', { hasText: 'Sub Section' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Heading 3 ─────────────────────────────────────────────────────────────────

  test('### Heading renders as <h3>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Heading 3 Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '### Minor Heading');

    await expect(page.locator('h3', { hasText: 'Minor Heading' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Mixed inline formatting ───────────────────────────────────────────────────

  test('mixed inline formatting renders all elements correctly', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const noteId = await createNoteViaApi(request, token, 'Mixed Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeInFirstBlock(page, '**bold** and *italic* and `code`');

    await expect(page.locator('strong', { hasText: 'bold' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('em', { hasText: 'italic' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('code', { hasText: 'code' })).toBeVisible({ timeout: 5_000 });
  });
});
