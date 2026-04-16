import { test, expect } from '@playwright/test';

// Override the global storageState for every test in this file so the browser
// starts with an empty session — exactly as an unauthenticated visitor would.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Auth boundary tests
//
// The app is a single-page application (React + Vite) with no client-side
// router.  All URL paths (/, /todos, /tasks, …) serve the same index.html.
// The root component wraps everything in Amplify's <Authenticator>, which
// renders a Cognito sign-in form for any unauthenticated visitor regardless
// of the path they navigated to.
// ---------------------------------------------------------------------------

test.describe('Auth boundaries', () => {
  test('unauthenticated user visiting /todos sees the sign-in form', async ({ page }) => {
    await page.goto('/todos');

    // The Amplify Authenticator renders a sign-in tab/heading.
    await expect(page.getByRole('tab', { name: /sign in/i }).or(
      page.getByRole('heading', { name: /sign in/i })
    )).toBeVisible();

    // The protected app content must NOT be visible.
    await expect(page.getByRole('heading', { name: 'Todos', level: 2 })).not.toBeVisible();
    // The sign-out button only appears when authenticated.
    await expect(page.getByRole('button', { name: /sign out/i })).not.toBeVisible();
  });

  test('unauthenticated user visiting /tasks sees the sign-in form', async ({ page }) => {
    await page.goto('/tasks');

    await expect(page.getByRole('tab', { name: /sign in/i }).or(
      page.getByRole('heading', { name: /sign in/i })
    )).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Ad-hoc Tasks', level: 2 })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /sign out/i })).not.toBeVisible();
  });
});
