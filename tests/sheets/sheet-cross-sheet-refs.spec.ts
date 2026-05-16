import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'xsheet'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix = 'xsheet'): Promise<void> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cross-Sheet Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

/** Click a cell, type a value into the formula bar, press Enter to commit. */
async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByRole('textbox');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

/** Wait for a cell's displayed text to equal the expected string. */
async function expectCell(page: Page, ref: string, expected: string): Promise<void> {
  await expect(page.locator(`[data-type="cell"][id="${ref}"] span`)).toHaveText(expected, { timeout: 8_000 });
}

async function openNewSheet(page: Page): Promise<void> {
  await page.goto('/sheets');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Spreadsheets', { timeout: 10_000 });
  await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });
}

/** Add a new sheet tab and rename it. */
async function addAndRenameSheet(page: Page, newName: string): Promise<void> {
  const tabCount = await page.locator('.sheetTab, [data-tab]').count();
  await page.getByRole('button', { name: '+' }).click();
  // Wait for the new tab to appear (Sheet 2, Sheet 3, etc.)
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
  // Rename the newly active tab by double-clicking it
  // The active tab has the sheet name shown in the tab bar
  const tabs = page.locator('[role="tab"], .sheetTabItem, [data-testid="sheet-tab"]');
  const tabCount2 = await tabs.count();
  if (tabCount2 > 0) {
    // Double-click the last (newly added) tab
    await tabs.last().dblclick();
  } else {
    // Fallback: find a tab containing 'Sheet' text that is not 'Sheet 1'
    const allTabTexts = page.locator('button').filter({ hasText: /^Sheet \d+$/ });
    await allTabTexts.last().dblclick();
  }
  const renameInput = page.locator('main input').last();
  await expect(renameInput).toBeVisible({ timeout: 5_000 });
  await renameInput.fill(newName);
  await renameInput.press('Enter');
  await expect(page.getByText(newName, { exact: true })).toBeVisible({ timeout: 5_000 });
}

/** Trigger re-evaluation of a cell by clicking away and back. */
async function reactivateCell(page: Page, ref: string): Promise<void> {
  // Click another cell to commit any edit
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (m) {
    const nextRef = `${m[1]}${parseInt(m[2]) + 1}`;
    await page.locator(`[data-type="cell"][id="${nextRef}"]`).click();
  }
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Cross-sheet cell references', () => {
  test('basic cross-sheet cell reference =Beta!C4', async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'xsheet1');
    await openNewSheet(page);

    // Add a second sheet tab and rename it to "Beta"
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });

    // Rename the new tab to "Beta" via double-click
    const newTab = page.getByText('Sheet 2', { exact: true });
    await newTab.dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Beta');
    await renameInput.press('Enter');
    await expect(page.getByText('Beta', { exact: true })).toBeVisible({ timeout: 5_000 });

    // On Beta sheet, set C4 = 42
    await setCell(page, 'C4', '42');
    await expectCell(page, 'C4', '42');

    // Switch to Sheet 1
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });

    // Enter the cross-sheet reference
    await setCell(page, 'A1', '=Beta!C4');

    // Expect A1 to show the value from Beta!C4
    await expectCell(page, 'A1', '42');
  });

  test('cross-sheet range reference =SUM(Beta!C4:D6)', async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'xsheet2');
    await openNewSheet(page);

    // Add second tab, rename to "Beta"
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Beta');
    await renameInput.press('Enter');
    await expect(page.getByText('Beta', { exact: true })).toBeVisible({ timeout: 5_000 });

    // On Beta, fill C4:D6 (sum should be 10+20+30+5+15+25 = 105)
    await setCell(page, 'C4', '10');
    await setCell(page, 'C5', '20');
    await setCell(page, 'C6', '30');
    await setCell(page, 'D4', '5');
    await setCell(page, 'D5', '15');
    await setCell(page, 'D6', '25');

    // Switch to Sheet 1
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });

    // Enter cross-sheet SUM formula
    await setCell(page, 'A1', '=SUM(Beta!C4:D6)');

    await expectCell(page, 'A1', '105');
  });

  test("sheet name with spaces ='Net Worth'!C4", async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'xsheet3');
    await openNewSheet(page);

    // Add second tab
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Net Worth');
    await renameInput.press('Enter');
    await expect(page.getByText('Net Worth', { exact: true })).toBeVisible({ timeout: 5_000 });

    // On "Net Worth", set C4 = 999
    await setCell(page, 'C4', '999');
    await expectCell(page, 'C4', '999');

    // Switch to Sheet 1
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });

    // Enter cross-sheet reference with quoted name
    await setCell(page, 'A1', "='Net Worth'!C4");

    await expectCell(page, 'A1', '999');
  });

  test('renamed referenced sheet causes formula to show #REF!', async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'xsheet4');
    await openNewSheet(page);

    // Add second tab, rename to "Beta"
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Beta');
    await renameInput.press('Enter');
    await expect(page.getByText('Beta', { exact: true })).toBeVisible({ timeout: 5_000 });

    // On Beta, set C4 = 77
    await setCell(page, 'C4', '77');

    // Switch to Sheet 1, set formula
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await setCell(page, 'A1', '=Beta!C4');
    await expectCell(page, 'A1', '77');

    // Rename "Beta" to "Gamma"
    await page.getByText('Beta', { exact: true }).dblclick();
    const renameInput2 = page.locator('main input').last();
    await expect(renameInput2).toBeVisible({ timeout: 5_000 });
    await renameInput2.fill('Gamma');
    await renameInput2.press('Enter');
    await expect(page.getByText('Gamma', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Switch back to Sheet 1 and trigger re-evaluation
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await reactivateCell(page, 'A1');

    // Formula should now show #REF! because "Beta" sheet no longer exists
    await expectCell(page, 'A1', '#REF!');
  });

  test('deleted referenced sheet causes formula to show #REF!', async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'xsheet5');
    await openNewSheet(page);

    // Add second tab, rename to "Beta"
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Beta');
    await renameInput.press('Enter');
    await expect(page.getByText('Beta', { exact: true })).toBeVisible({ timeout: 5_000 });

    // On Beta, set C4 = 55
    await setCell(page, 'C4', '55');

    // Switch to Sheet 1, set formula
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await setCell(page, 'A1', '=Beta!C4');
    await expectCell(page, 'A1', '55');

    // Right-click "Beta" tab to open context menu and delete it
    await page.getByText('Beta', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // Wait for Beta tab to disappear
    await expect(page.getByText('Beta', { exact: true })).not.toBeVisible({ timeout: 5_000 });

    // Now on Sheet 1, trigger re-evaluation of A1
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await reactivateCell(page, 'A1');

    // Formula should now show #REF! because "Beta" sheet was deleted
    await expectCell(page, 'A1', '#REF!');
  });

  test('cleared referenced cells return 0 or empty', async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'xsheet6');
    await openNewSheet(page);

    // Add second tab, rename to "Beta"
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Beta');
    await renameInput.press('Enter');
    await expect(page.getByText('Beta', { exact: true })).toBeVisible({ timeout: 5_000 });

    // On Beta, set C4 = 100
    await setCell(page, 'C4', '100');

    // Switch to Sheet 1, set formula referencing Beta!C4
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await setCell(page, 'A1', '=Beta!C4');
    await expectCell(page, 'A1', '100');

    // Switch to Beta and clear C4
    await page.getByText('Beta', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="C4"]')).toBeVisible({ timeout: 10_000 });
    await setCell(page, 'C4', '');

    // Switch back to Sheet 1 and trigger re-evaluation
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await reactivateCell(page, 'A1');

    // When referenced cell is empty, cross-sheet reference should return "" or "0"
    const a1Text = await page.locator('[data-type="cell"][id="A1"] span').textContent({ timeout: 8_000 });
    expect(a1Text === '' || a1Text === '0').toBeTruthy();
  });
});
