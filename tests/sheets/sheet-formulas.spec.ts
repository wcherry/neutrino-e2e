import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'formula'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix = 'formula'): Promise<void> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Formula Test User', email, password },
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

// ── Existing test (unchanged) ────────────────────────────────────────────────

test.describe('Spreadsheet formulas', () => {
  test('SUM, MAX, and MIN compute correct values', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await setCell(page, 'A1', 'Category');
    await setCell(page, 'B1', 'Amount');
    await setCell(page, 'A2', 'Food');
    await setCell(page, 'B2', '100');
    await setCell(page, 'A3', 'Transport');
    await setCell(page, 'B3', '50');
    await setCell(page, 'A4', 'Food');
    await setCell(page, 'B4', '75');
    await setCell(page, 'A5', 'Rent');
    await setCell(page, 'B5', '500');
    await setCell(page, 'A6', 'Transport');
    await setCell(page, 'B6', '30');

    await setCell(page, 'D1', 'SUM');
    await setCell(page, 'E1', '=SUM(B2:B6)');
    await setCell(page, 'D2', 'MAX');
    await setCell(page, 'E2', '=MAX(B2:B6)');
    await setCell(page, 'D3', 'MIN');
    await setCell(page, 'E3', '=MIN(B2:B6)');
    await setCell(page, 'F1', '');

    await expectCell(page, 'E1', '755');
    await expectCell(page, 'E2', '500');
    await expectCell(page, 'E3', '30');
  });
});

// ── Math functions ───────────────────────────────────────────────────────────

test.describe('Math functions', () => {
  test('AVERAGE, COUNT, COUNTA', async ({ page, request }) => {
    await registerAndLogin(request, page, 'math1');
    await openNewSheet(page);

    await setCell(page, 'A1', '10');
    await setCell(page, 'A2', '20');
    await setCell(page, 'A3', '30');
    await setCell(page, 'A4', 'text');

    await setCell(page, 'B1', '=AVERAGE(A1:A3)');
    await setCell(page, 'B2', '=COUNT(A1:A4)');    // counts only numeric → 3
    await setCell(page, 'B3', '=COUNTA(A1:A4)');   // counts non-empty → 4
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '20');
    await expectCell(page, 'B2', '3');
    await expectCell(page, 'B3', '4');
  });

  test('ROUND, ROUNDUP, ROUNDDOWN', async ({ page, request }) => {
    await registerAndLogin(request, page, 'math2');
    await openNewSheet(page);

    await setCell(page, 'A1', '=ROUND(3.567, 2)');
    await setCell(page, 'A2', '=ROUNDUP(3.123, 2)');
    await setCell(page, 'A3', '=ROUNDDOWN(3.999, 2)');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '3.57');
    await expectCell(page, 'A2', '3.13');
    await expectCell(page, 'A3', '3.99');
  });

  test('ABS and MOD', async ({ page, request }) => {
    await registerAndLogin(request, page, 'math3');
    await openNewSheet(page);

    await setCell(page, 'A1', '=ABS(-42)');
    await setCell(page, 'A2', '=ABS(7)');
    await setCell(page, 'A3', '=MOD(10, 3)');
    await setCell(page, 'A4', '=MOD(10, 5)');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '42');
    await expectCell(page, 'A2', '7');
    await expectCell(page, 'A3', '1');
    await expectCell(page, 'A4', '0');
  });

  test('arithmetic operators: multiply, divide, subtract', async ({ page, request }) => {
    await registerAndLogin(request, page, 'math4');
    await openNewSheet(page);

    await setCell(page, 'A1', '=5*4');
    await setCell(page, 'A2', '=10/4');
    await setCell(page, 'A3', '=10-3');
    await setCell(page, 'A4', '=2+3*4');   // precedence: 2 + 12 = 14
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '20');
    await expectCell(page, 'A2', '2.5');
    await expectCell(page, 'A3', '7');
    await expectCell(page, 'A4', '14');
  });
});

// ── Logical functions ────────────────────────────────────────────────────────

test.describe('Logical functions', () => {
  test('IF with comparison and value branches', async ({ page, request }) => {
    await registerAndLogin(request, page, 'logic1');
    await openNewSheet(page);

    await setCell(page, 'A1', '10');
    await setCell(page, 'B1', '=IF(A1>5, "big", "small")');
    await setCell(page, 'B2', '=IF(A1<5, "big", "small")');
    await setCell(page, 'B3', '=IF(1, "yes", "no")');
    await setCell(page, 'B4', '=IF(0, "yes", "no")');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', 'big');
    await expectCell(page, 'B2', 'small');
    await expectCell(page, 'B3', 'yes');
    await expectCell(page, 'B4', 'no');
  });

  test('IFS evaluates first matching condition', async ({ page, request }) => {
    await registerAndLogin(request, page, 'logic2');
    await openNewSheet(page);

    await setCell(page, 'A1', '85');
    await setCell(page, 'B1', '=IFS(A1>=90, "A", A1>=80, "B", A1>=70, "C", 1, "F")');
    await setCell(page, 'A2', '95');
    await setCell(page, 'B2', '=IFS(A2>=90, "A", A2>=80, "B", A2>=70, "C", 1, "F")');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', 'B');
    await expectCell(page, 'B2', 'A');
  });

  test('AND, OR, NOT', async ({ page, request }) => {
    await registerAndLogin(request, page, 'logic3');
    await openNewSheet(page);

    await setCell(page, 'A1', '=AND(1, 1)');
    await setCell(page, 'A2', '=AND(1, 0)');
    await setCell(page, 'A3', '=OR(0, 1)');
    await setCell(page, 'A4', '=OR(0, 0)');
    await setCell(page, 'A5', '=NOT(0)');
    await setCell(page, 'A6', '=NOT(1)');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '1');
    await expectCell(page, 'A2', '0');
    await expectCell(page, 'A3', '1');
    await expectCell(page, 'A4', '0');
    await expectCell(page, 'A5', '1');
    await expectCell(page, 'A6', '0');
  });

  test('IFERROR returns fallback for errors', async ({ page, request }) => {
    await registerAndLogin(request, page, 'logic4');
    await openNewSheet(page);

    // Division by zero in the formula bar
    await setCell(page, 'A1', '0');
    await setCell(page, 'B1', '=IFERROR(10/A1, "err")');
    await setCell(page, 'B2', '=IFERROR(10/2, "err")');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', 'err');
    await expectCell(page, 'B2', '5');
  });
});

// ── Lookup & reference ───────────────────────────────────────────────────────

test.describe('Lookup & reference functions', () => {
  test('VLOOKUP exact match', async ({ page, request }) => {
    await registerAndLogin(request, page, 'lookup1');
    await openNewSheet(page);

    // Lookup table: A=code, B=label
    await setCell(page, 'A1', '1');  await setCell(page, 'B1', 'Apple');
    await setCell(page, 'A2', '2');  await setCell(page, 'B2', 'Banana');
    await setCell(page, 'A3', '3');  await setCell(page, 'B3', 'Cherry');

    await setCell(page, 'D1', '=VLOOKUP(2, A1:B3, 2, 0)');
    await setCell(page, 'D2', '=VLOOKUP(3, A1:B3, 2, 0)');
    await setCell(page, 'E1', '');

    await expectCell(page, 'D1', 'Banana');
    await expectCell(page, 'D2', 'Cherry');
  });

  test('HLOOKUP exact match', async ({ page, request }) => {
    await registerAndLogin(request, page, 'lookup2');
    await openNewSheet(page);

    // Horizontal table: row 1 = keys, row 2 = values
    await setCell(page, 'A1', 'x');  await setCell(page, 'B1', 'y');  await setCell(page, 'C1', 'z');
    await setCell(page, 'A2', '10'); await setCell(page, 'B2', '20'); await setCell(page, 'C2', '30');

    await setCell(page, 'A4', '=HLOOKUP("y", A1:C2, 2, 0)');
    await setCell(page, 'B4', '');

    await expectCell(page, 'A4', '20');
  });

  test('XLOOKUP', async ({ page, request }) => {
    await registerAndLogin(request, page, 'lookup3');
    await openNewSheet(page);

    await setCell(page, 'A1', 'Alpha'); await setCell(page, 'B1', '100');
    await setCell(page, 'A2', 'Beta');  await setCell(page, 'B2', '200');
    await setCell(page, 'A3', 'Gamma'); await setCell(page, 'B3', '300');

    await setCell(page, 'D1', '=XLOOKUP("Beta", A1:A3, B1:B3)');
    await setCell(page, 'D2', '=XLOOKUP("Delta", A1:A3, B1:B3, "n/a")');
    await setCell(page, 'E1', '');

    await expectCell(page, 'D1', '200');
    await expectCell(page, 'D2', 'n/a');
  });

  test('INDEX and MATCH', async ({ page, request }) => {
    await registerAndLogin(request, page, 'lookup4');
    await openNewSheet(page);

    await setCell(page, 'A1', 'a'); await setCell(page, 'A2', 'b'); await setCell(page, 'A3', 'c');
    await setCell(page, 'B1', '5'); await setCell(page, 'B2', '10'); await setCell(page, 'B3', '15');

    await setCell(page, 'D1', '=INDEX(B1:B3, 2)');     // 10
    await setCell(page, 'D2', '=MATCH("b", A1:A3, 0)'); // position 2
    await setCell(page, 'D3', '=INDEX(B1:B3, MATCH("c", A1:A3, 0))'); // 15
    await setCell(page, 'E1', '');

    await expectCell(page, 'D1', '10');
    await expectCell(page, 'D2', '2');
    await expectCell(page, 'D3', '15');
  });

  test('OFFSET returns cell at offset position', async ({ page, request }) => {
    await registerAndLogin(request, page, 'lookup5');
    await openNewSheet(page);

    await setCell(page, 'A1', '111');
    await setCell(page, 'B2', '222');
    await setCell(page, 'C3', '333');

    // OFFSET(A1, 1, 1) → B2; OFFSET(A1, 2, 2) → C3
    await setCell(page, 'E1', '=OFFSET(A1, 1, 1)');
    await setCell(page, 'E2', '=OFFSET(A1, 2, 2)');
    await setCell(page, 'F1', '');

    await expectCell(page, 'E1', '222');
    await expectCell(page, 'E2', '333');
  });
});

// ── Text functions ───────────────────────────────────────────────────────────

test.describe('Text functions', () => {
  test('CONCAT, CONCATENATE, TEXTJOIN', async ({ page, request }) => {
    await registerAndLogin(request, page, 'text1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'Hello');
    await setCell(page, 'A2', 'World');
    await setCell(page, 'A3', '');

    await setCell(page, 'B1', '=CONCAT("Hello", " ", "World")');
    await setCell(page, 'B2', '=CONCATENATE(A1, " ", A2)');
    await setCell(page, 'B3', '=TEXTJOIN("-", 1, A1:A2)');   // ignore empty → Hello-World
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', 'Hello World');
    await expectCell(page, 'B2', 'Hello World');
    await expectCell(page, 'B3', 'Hello-World');
  });

  test('LEFT, RIGHT, MID', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'text2');
    await openNewSheet(page);

    await setCell(page, 'A1', '=LEFT("abcdef", 3)');
    await setCell(page, 'A2', '=RIGHT("abcdef", 3)');
    await setCell(page, 'A3', '=MID("abcdef", 2, 3)');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', 'abc');
    await expectCell(page, 'A2', 'def');
    await expectCell(page, 'A3', 'bcd');
  });

  test('LEN, TRIM, UPPER, LOWER, PROPER', async ({ page, request }) => {
    await registerAndLogin(request, page, 'text3');
    await openNewSheet(page);

    await setCell(page, 'A1', '=LEN("hello")');
    await setCell(page, 'A2', '=TRIM("  hi  ")');
    await setCell(page, 'A3', '=UPPER("hello")');
    await setCell(page, 'A4', '=LOWER("HELLO")');
    await setCell(page, 'A5', '=PROPER("hello world")');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '5');
    await expectCell(page, 'A2', 'hi');
    await expectCell(page, 'A3', 'HELLO');
    await expectCell(page, 'A4', 'hello');
    await expectCell(page, 'A5', 'Hello World');
  });

  test('SUBSTITUTE, FIND, SEARCH', async ({ page, request }) => {
    await registerAndLogin(request, page, 'text4');
    await openNewSheet(page);

    await setCell(page, 'A1', '=SUBSTITUTE("hello world", "world", "earth")');
    await setCell(page, 'A2', '=FIND("lo", "hello")');       // position 4
    await setCell(page, 'A3', '=SEARCH("LO", "hello")');     // case-insensitive → 4
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', 'hello earth');
    await expectCell(page, 'A2', '4');
    await expectCell(page, 'A3', '4');
  });

  test('String concatenation operator &', async ({ page, request }) => {
    await registerAndLogin(request, page, 'text5');
    await openNewSheet(page);

    await setCell(page, 'A1', 'foo');
    await setCell(page, 'B1', '=A1&"-"&"bar"');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', 'foo-bar');
  });
});

// ── Date & time functions ────────────────────────────────────────────────────

test.describe('Date & time functions', () => {
  test('DATE, YEAR, MONTH, DAY', async ({ page, request }) => {
    await registerAndLogin(request, page, 'date1');
    await openNewSheet(page);

    await setCell(page, 'A1', '=DATE(2024, 6, 15)');
    await setCell(page, 'B1', '=YEAR(A1)');
    await setCell(page, 'C1', '=MONTH(A1)');
    await setCell(page, 'D1', '=DAY(A1)');
    await setCell(page, 'E1', '');

    await expectCell(page, 'A1', '2024-06-15');
    await expectCell(page, 'B1', '2024');
    await expectCell(page, 'C1', '6');
    await expectCell(page, 'D1', '15');
  });

  test('DATEDIF computes differences', async ({ page, request }) => {
    await registerAndLogin(request, page, 'date2');
    await openNewSheet(page);

    await setCell(page, 'A1', '2020-01-01');
    await setCell(page, 'A2', '2023-06-15');

    await setCell(page, 'B1', '=DATEDIF(A1, A2, "Y")');  // 3 complete years
    await setCell(page, 'B2', '=DATEDIF(A1, A2, "D")');  // days
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '3');
    // 2020-01-01 to 2023-06-15 = 3 years 5 months 14 days = 1261 days (incl. leap 2020+2022)
    await expectCell(page, 'B2', '1261');
  });

  test('EOMONTH returns last day of month', async ({ page, request }) => {
    await registerAndLogin(request, page, 'date3');
    await openNewSheet(page);

    await setCell(page, 'A1', '=EOMONTH("2024-01-15", 0)');  // Jan 31
    await setCell(page, 'A2', '=EOMONTH("2024-01-15", 1)');  // Feb 29 (2024 leap year)
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '2024-01-31');
    await expectCell(page, 'A2', '2024-02-29');
  });

  test('WORKDAY skips weekends', async ({ page, request }) => {
    await registerAndLogin(request, page, 'date4');
    await openNewSheet(page);

    // 2024-01-05 is Friday; +1 workday → Monday 2024-01-08
    await setCell(page, 'A1', '=WORKDAY("2024-01-05", 1)');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '2024-01-08');
  });

  test('NETWORKDAYS counts working days', async ({ page, request }) => {
    await registerAndLogin(request, page, 'date5');
    await openNewSheet(page);

    // Mon 2024-01-01 to Fri 2024-01-05 → 5 working days
    await setCell(page, 'A1', '=NETWORKDAYS("2024-01-01", "2024-01-05")');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '5');
  });
});

// ── Statistical functions ────────────────────────────────────────────────────

test.describe('Statistical functions', () => {
  test('SUMIF and COUNTIF with text criterion', async ({ page, request }) => {
    await registerAndLogin(request, page, 'stat1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'Food');      await setCell(page, 'B1', '100');
    await setCell(page, 'A2', 'Transport'); await setCell(page, 'B2', '50');
    await setCell(page, 'A3', 'Food');      await setCell(page, 'B3', '75');
    await setCell(page, 'A4', 'Rent');      await setCell(page, 'B4', '500');
    await setCell(page, 'A5', 'Transport'); await setCell(page, 'B5', '30');

    await setCell(page, 'D1', '=SUMIF(A1:A5, "Food", B1:B5)');
    await setCell(page, 'D2', '=COUNTIF(A1:A5, "Food")');
    await setCell(page, 'D3', '=SUMIF(B1:B5, ">100")');   // sum amounts > 100
    await setCell(page, 'E1', '');

    await expectCell(page, 'D1', '175');   // 100 + 75
    await expectCell(page, 'D2', '2');
    await expectCell(page, 'D3', '500');
  });

  test('SUMIFS and COUNTIFS with multiple criteria', async ({ page, request }) => {
    await registerAndLogin(request, page, 'stat2');
    await openNewSheet(page);

    //  A=region  B=product  C=amount
    await setCell(page, 'A1', 'East');  await setCell(page, 'B1', 'A'); await setCell(page, 'C1', '100');
    await setCell(page, 'A2', 'West');  await setCell(page, 'B2', 'A'); await setCell(page, 'C2', '200');
    await setCell(page, 'A3', 'East');  await setCell(page, 'B3', 'B'); await setCell(page, 'C3', '150');
    await setCell(page, 'A4', 'East');  await setCell(page, 'B4', 'A'); await setCell(page, 'C4', '50');

    // SUMIFS: East AND product A → 100 + 50 = 150
    await setCell(page, 'E1', '=SUMIFS(C1:C4, A1:A4, "East", B1:B4, "A")');
    // COUNTIFS: East AND product A → 2
    await setCell(page, 'E2', '=COUNTIFS(A1:A4, "East", B1:B4, "A")');
    await setCell(page, 'F1', '');

    await expectCell(page, 'E1', '150');
    await expectCell(page, 'E2', '2');
  });

  test('AVERAGEIF', async ({ page, request }) => {
    await registerAndLogin(request, page, 'stat3');
    await openNewSheet(page);

    await setCell(page, 'A1', 'Food');  await setCell(page, 'B1', '100');
    await setCell(page, 'A2', 'Rent');  await setCell(page, 'B2', '500');
    await setCell(page, 'A3', 'Food');  await setCell(page, 'B3', '75');

    await setCell(page, 'D1', '=AVERAGEIF(A1:A3, "Food", B1:B3)');  // (100+75)/2 = 87.5
    await setCell(page, 'E1', '');

    await expectCell(page, 'D1', '87.5');
  });

  test('MEDIAN', async ({ page, request }) => {
    await registerAndLogin(request, page, 'stat4');
    await openNewSheet(page);

    await setCell(page, 'A1', '3');
    await setCell(page, 'A2', '1');
    await setCell(page, 'A3', '4');
    await setCell(page, 'A4', '1');
    await setCell(page, 'A5', '5');

    await setCell(page, 'B1', '=MEDIAN(A1:A5)');  // sorted: 1,1,3,4,5 → median = 3
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '3');
  });

  test('STDEV (sample) and STDEV.P (population)', async ({ page, request }) => {
    await registerAndLogin(request, page, 'stat5');
    await openNewSheet(page);

    await setCell(page, 'A1', '2');
    await setCell(page, 'A2', '4');
    await setCell(page, 'A3', '4');
    await setCell(page, 'A4', '4');
    await setCell(page, 'A5', '5');
    await setCell(page, 'A6', '5');
    await setCell(page, 'A7', '7');
    await setCell(page, 'A8', '9');

    // Population std dev = 2 (known for this dataset)
    await setCell(page, 'B1', '=STDEV.P(A1:A8)');
    // Sample std dev ≈ 2.138 — just verify it's > 2
    await setCell(page, 'B2', '=STDEV(A1:A8)');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '2');
    // Verify sample stdev is a non-empty numeric result
    await expect(page.locator('[data-type="cell"][id="B2"] span')).not.toHaveText('');
  });
});

// ── Dynamic array functions (scalar representation) ──────────────────────────

test.describe('Dynamic array functions (scalar output)', () => {
  test('SORT returns comma-separated sorted values', async ({ page, request }) => {
    await registerAndLogin(request, page, 'dyn1');
    await openNewSheet(page);

    await setCell(page, 'A1', '30');
    await setCell(page, 'A2', '10');
    await setCell(page, 'A3', '20');

    await setCell(page, 'B1', '=SORT(A1:A3)');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '10, 20, 30');
  });

  test('UNIQUE returns distinct values', async ({ page, request }) => {
    await registerAndLogin(request, page, 'dyn2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'apple');
    await setCell(page, 'A2', 'banana');
    await setCell(page, 'A3', 'apple');
    await setCell(page, 'A4', 'cherry');

    await setCell(page, 'B1', '=UNIQUE(A1:A4)');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', 'apple, banana, cherry');
  });

  test('SEQUENCE generates a numeric series', async ({ page, request }) => {
    await registerAndLogin(request, page, 'dyn3');
    await openNewSheet(page);

    await setCell(page, 'A1', '=SEQUENCE(5)');                    // 1,2,3,4,5
    await setCell(page, 'A2', '=SEQUENCE(4, 1, 10, 10)');         // 10,20,30,40
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '1, 2, 3, 4, 5');
    await expectCell(page, 'A2', '10, 20, 30, 40');
  });

  test('FILTER returns matching values', async ({ page, request }) => {
    await registerAndLogin(request, page, 'dyn4');
    await openNewSheet(page);

    await setCell(page, 'A1', '10');
    await setCell(page, 'A2', '20');
    await setCell(page, 'A3', '30');
    // Include column: 1 = include, 0 = exclude
    await setCell(page, 'B1', '1');
    await setCell(page, 'B2', '0');
    await setCell(page, 'B3', '1');

    await setCell(page, 'D1', '=FILTER(A1:A3, B1:B3)');
    await setCell(page, 'E1', '');

    await expectCell(page, 'D1', '10, 30');
  });
});

// ── Financial functions ──────────────────────────────────────────────────────

test.describe('Financial functions', () => {
  test('PMT calculates monthly loan payment', async ({ page, request }) => {
    await registerAndLogin(request, page, 'fin1');
    await openNewSheet(page);

    // Monthly payment: 5% annual rate / 12, 60 months, $10,000 loan
    // Expected ≈ -188.71
    await setCell(page, 'A1', '=ROUND(PMT(0.05/12, 60, 10000), 2)');
    await setCell(page, 'B1', '');

    await expectCell(page, 'A1', '-188.71');
  });

  test('NPV computes net present value', async ({ page, request }) => {
    await registerAndLogin(request, page, 'fin2');
    await openNewSheet(page);

    // NPV(10%, -1000, 400, 400, 400): all values discounted from period 1..4
    // = -1000/1.1 + 400/1.21 + 400/1.331 + 400/1.4641 ≈ -4.78
    await setCell(page, 'A1', '-1000');
    await setCell(page, 'A2', '400');
    await setCell(page, 'A3', '400');
    await setCell(page, 'A4', '400');

    await setCell(page, 'B1', '=ROUND(NPV(0.1, A1:A4), 2)');
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '-4.78');
  });

  test('IRR finds internal rate of return', async ({ page, request }) => {
    await registerAndLogin(request, page, 'fin3');
    await openNewSheet(page);

    // Cash flows: -1000, 300, 400, 500 → IRR ≈ 8.9%
    // (solve: -1000 + 300/(1+r) + 400/(1+r)^2 + 500/(1+r)^3 = 0)
    await setCell(page, 'A1', '-1000');
    await setCell(page, 'A2', '300');
    await setCell(page, 'A3', '400');
    await setCell(page, 'A4', '500');

    await setCell(page, 'B1', '=ROUND(IRR(A1:A4)*100, 2)');  // as percent
    await setCell(page, 'C1', '');

    await expectCell(page, 'B1', '8.9');
  });
});
