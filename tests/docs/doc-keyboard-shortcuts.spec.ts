import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_kb_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Docs KB Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function openNewDoc(page: Page): Promise<void> {
  await page.goto('/docs');
  await expect(page.getByRole('button', { name: /new document/i })).toHaveCount(2, {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /new document/i }).first().click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 10_000 });
  // Wait for the ProseMirror editor to be ready
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

test.describe('Docs keyboard shortcuts', () => {
  // ── Ctrl+K (link) ───────────────────────────────────────────────────────────

  test('Ctrl+K sets a link on selected text', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');

    // Type some text and select it all
    await editor.click();
    await editor.pressSequentially('Hello world');
    await page.keyboard.press('Meta+A');

    // Handle the window.prompt dialog before pressing the shortcut
    page.once('dialog', (dialog) => dialog.accept('https://example.com'));
    await page.keyboard.press('Control+K');

    // The selected text should now be wrapped in an anchor tag
    await expect(editor.locator('a')).toBeVisible({ timeout: 5_000 });
  });

  test('Ctrl+K with empty string removes an existing link', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');

    // Type text, select it, and set a link
    await editor.click();
    await editor.pressSequentially('Hello world');
    await page.keyboard.press('Meta+A');

    page.once('dialog', (dialog) => dialog.accept('https://example.com'));
    await page.keyboard.press('Control+K');
    await expect(editor.locator('a')).toBeVisible({ timeout: 5_000 });

    // Now select the linked text and press Ctrl+K with an empty string to remove it
    await page.keyboard.press('Meta+A');
    page.once('dialog', (dialog) => dialog.accept(''));
    await page.keyboard.press('Control+K');

    // The anchor tag should be gone
    await expect(editor.locator('a')).toHaveCount(0, { timeout: 5_000 });
  });

  // ── Ctrl+\ (clear formatting) ────────────────────────────────────────────────

  test('Ctrl+\\ clears bold formatting', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');

    // Type text and apply bold via Cmd+B
    await editor.click();
    await editor.pressSequentially('Bold text');
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Meta+B');

    // Confirm bold was applied
    await expect(editor.locator('strong')).toBeVisible({ timeout: 5_000 });

    // Clear formatting with Ctrl+\
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Control+\\');

    // Bold should be removed
    await expect(editor.locator('strong')).toHaveCount(0, { timeout: 5_000 });
  });

  test('Ctrl+\\ clears italic formatting', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');

    // Type text and apply italic via Cmd+I
    await editor.click();
    await editor.pressSequentially('Italic text');
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Meta+I');

    // Confirm italic was applied
    await expect(editor.locator('em')).toBeVisible({ timeout: 5_000 });

    // Clear formatting with Ctrl+\
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Control+\\');

    // Italic should be removed
    await expect(editor.locator('em')).toHaveCount(0, { timeout: 5_000 });
  });
});
