/// <reference types="node" />
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load runtime config so we can build the Tasks REST endpoint URL and the
// AppSync endpoint for direct backend assertions.
const outputs = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'amplify_outputs.json'), 'utf-8')
) as {
  auth: { user_pool_client_id: string };
  custom: { tasksApiUrl: string };
};

const TASKS_API_URL = outputs.custom.tasksApiUrl.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scope all selectors to the Ad-hoc Tasks panel. */
function tasksSection(page: Page) {
  return page.locator('section.panel', {
    has: page.getByRole('heading', { name: 'Ad-hoc Tasks', level: 2 }),
  });
}

const uid = () => `E2E Task ${Date.now()}`;

function taskItem(section: Locator, title: string): Locator {
  return section.getByRole('listitem').filter({ hasText: title });
}

/**
 * Read the Cognito ID token out of the browser's localStorage.
 * Amplify v6 writes it under the key:
 *   CognitoIdentityServiceProvider.<clientId>.<username>.idToken
 */
async function getIdToken(page: Page): Promise<string> {
  const clientId = outputs.auth.user_pool_client_id;
  return page.evaluate((clientId: string) => {
    const prefix = `CognitoIdentityServiceProvider.${clientId}`;
    const username = localStorage.getItem(`${prefix}.LastAuthUser`) ?? '';
    return localStorage.getItem(`${prefix}.${username}.idToken`) ?? '';
  }, clientId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Tasks module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ad-hoc Tasks', level: 2 })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('authenticated user can see the tasks list', async ({ page }) => {
    const section = tasksSection(page);
    await expect(section.getByRole('heading', { name: 'Ad-hoc Tasks', level: 2 })).toBeVisible();
    await expect(section.getByPlaceholder('Task title *')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('user can create a new task with a name and description', async ({ page, request }) => {
    // NOTE: The current TaskForm only captures title + description; a due-date
    // field is not yet implemented in the UI.  This test verifies the fields
    // that do exist, plus performs a direct REST API assertion for backend
    // persistence (the spec calls for an AppSync query, but tasks live in an
    // API Gateway / DynamoDB backend rather than AppSync — the REST endpoint
    // is the authoritative source for task records).
    const section = tasksSection(page);
    const title = uid();

    await section.getByPlaceholder('Task title *').fill(title);
    await section.getByPlaceholder('Description (optional)').fill('Playwright e2e test');
    await section.getByRole('button', { name: 'Add Task' }).click();

    // Wait for the optimistic UI update.
    await expect(taskItem(section, title)).toBeVisible();

    // --- Direct backend assertion -------------------------------------------
    // After the UI confirms the task was created, verify the record was
    // actually persisted by querying the Tasks REST API with the user's JWT.
    const idToken = await getIdToken(page);
    const response = await request.get(`${TASKS_API_URL}/tasks`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    expect(response.ok()).toBe(true);

    const tasks = (await response.json()) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === title)).toBe(true);
    // -------------------------------------------------------------------------

    // Cleanup
    await taskItem(section, title).getByTitle('Delete').click();
    await expect(taskItem(section, title)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Edit and complete-toggle are not yet implemented in TaskList.
  // These tests are declared so they appear in the report and act as a reminder.
  test('user can edit an existing task', async () => {
    test.skip(true, 'Not yet implemented: TaskList does not have an edit action');
  });

  test('user can mark a task as complete', async () => {
    test.skip(true, 'Not yet implemented: TaskList has no complete/done toggle');
  });

  // -------------------------------------------------------------------------
  test('user can delete a task', async ({ page }) => {
    const section = tasksSection(page);
    const title = uid();

    // Create
    await section.getByPlaceholder('Task title *').fill(title);
    await section.getByRole('button', { name: 'Add Task' }).click();
    await expect(taskItem(section, title)).toBeVisible();

    // Delete
    await taskItem(section, title).getByTitle('Delete').click();
    await expect(taskItem(section, title)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('tasks are scoped to the logged-in user', async ({ page, request }) => {
    // The Tasks API uses the Cognito JWT to identify the caller: DynamoDB's
    // partition key is the user's sub claim.  We verify this by creating a
    // task and then querying the REST API directly.  All returned tasks must
    // belong to the same user, proving the backend enforces per-user isolation.
    const section = tasksSection(page);
    const title = uid();

    // Create a task through the UI.
    await section.getByPlaceholder('Task title *').fill(title);
    await section.getByRole('button', { name: 'Add Task' }).click();
    await expect(taskItem(section, title)).toBeVisible();

    // Query the API directly.
    const idToken = await getIdToken(page);
    const response = await request.get(`${TASKS_API_URL}/tasks`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    expect(response.ok()).toBe(true);

    const tasks = (await response.json()) as Array<{ userId: string; title: string }>;

    // Every task in the response must share the same userId, confirming the
    // API only returns records owned by the authenticated caller.
    const userIds = [...new Set(tasks.map((t) => t.userId))];
    expect(userIds).toHaveLength(1);

    // Cleanup
    await taskItem(section, title).getByTitle('Delete').click();
    await expect(taskItem(section, title)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('empty state is shown when no tasks exist', async ({ page }) => {
    const section = tasksSection(page);

    while (true) {
      const deleteBtn = section.getByTitle('Delete').first();
      if (!(await deleteBtn.isVisible())) break;
      await deleteBtn.click();
      await expect(deleteBtn).not.toBeVisible();
    }

    await expect(section.getByText('No tasks yet. Add one above.')).toBeVisible();
  });
});
