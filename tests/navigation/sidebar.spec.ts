import { test, expect } from '../../fixtures/base';

const BASE_URL = 'http://localhost:9880';

// Mirrors NAV_SECTIONS in apps/web/src/app/(apps)/layout.tsx.
// pageTitle is the h1 text rendered by the target page; omit for pages with no h1.
const NAV_LINKS: { label: string; href: string; pageTitle?: string }[] = [
  { label: 'My Drive',       href: '/drive',         pageTitle: 'My Drive' },
  { label: 'Photos',         href: '/photos',        pageTitle: 'Photos' },
  { label: 'Documents',      href: '/docs',          pageTitle: 'Documents' },
  { label: 'Spreadsheets',   href: '/sheets',        pageTitle: 'Spreadsheets' },
  { label: 'Presentations',  href: '/slides',        pageTitle: 'Presentations' },
  { label: 'Notes',          href: '/notes',         pageTitle: 'Notes' },
  { label: 'Calendar',       href: '/calendar' },
  { label: 'Shared with me', href: '/drive/shared',  pageTitle: 'Shared with me' },
  { label: 'Recent',         href: '/drive/recent',  pageTitle: 'Recent' },
  { label: 'Starred',        href: '/drive/starred', pageTitle: 'Starred' },
  { label: 'Trash',          href: '/drive/trash',   pageTitle: 'Trash' },
  { label: 'Shared Drives',  href: '/drive/team',    pageTitle: 'Shared Drives' },
];

async function registerAndLogin(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
): Promise<void> {
  const email = `nav_test_${Date.now()}@example.com`;
  const password = 'Password123!';

  await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Nav Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
  });

  for (const { label, href, pageTitle } of NAV_LINKS) {
    test(`"${label}" link navigates to ${href}`, async ({ page }) => {
      // Navigate to /drive first so the sidebar is always present
      await page.goto('/drive');

      const sidebar = page.getByRole('navigation', { name: 'Primary navigation' });
      await sidebar.getByRole('link', { name: label }).click();

      // URL must match the expected path (trailing slash optional)
      await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, '\\/')}\\/?$`), {
        timeout: 10_000,
      });

      // Must not be the landing page or sign-in page
      await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/?$/);  // not bare origin
      await expect(page).not.toHaveURL(/\/sign-in/);

      // Must not show a 404 page
      const body = page.locator('body');
      await expect(body).not.toContainText('404', { ignoreCase: true });
      await expect(body).not.toContainText('page not found', { ignoreCase: true });

      // The app shell sidebar must still be present — if the landing page or any
      // non-app page is rendered, this element won't exist.
      await expect(sidebar).toBeVisible();

      // The clicked link must be marked as the active page in the sidebar.
      await expect(sidebar.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');

      // The page must render an h1 matching the expected title (when present).
      if (pageTitle) {
        await expect(page.getByRole('heading', { level: 1 })).toContainText(pageTitle);
      }
    });
  }
});

test.describe('Topbar search', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
  });

  test('search input is visible in the topbar', async ({ page }) => {
    await page.goto('/drive');
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible({ timeout: 10_000 });
  });

  test('typing in the search input updates its value', async ({ page }) => {
    await page.goto('/drive');
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill('hello world');
    await expect(search).toHaveValue('hello world');
  });

  test('search input is present across app pages', async ({ page }) => {
    for (const href of ['/drive', '/notes', '/calendar']) {
      await page.goto(href);
      await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});
