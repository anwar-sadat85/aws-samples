import { test, expect, type Locator, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scope selectors to the Todos panel so they never accidentally hit Tasks. */
function todosSection(page: Page) {
  return page.locator('section.panel', {
    has: page.getByRole('heading', { name: 'Todos', level: 2 }),
  });
}

/** Unique title so parallel reruns don't step on each other. */
const uid = () => `E2E Todo ${Date.now()}`;

/**
 * Find a list item inside the Todos panel that contains the given text, then
 * return it for further interaction.
 */
function todoItem(section: Locator, title: string): Locator {
  return section.getByRole('listitem').filter({ hasText: title });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Todo module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Confirm authenticated shell has rendered before each test.
    await expect(page.getByRole('heading', { name: 'Todos', level: 2 })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('authenticated user can see the todo list', async ({ page }) => {
    const section = todosSection(page);
    await expect(section.getByRole('heading', { name: 'Todos', level: 2 })).toBeVisible();
    // The creation form is always present when authenticated.
    await expect(section.getByPlaceholder('Title *')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('user can create a new todo item', async ({ page }) => {
    const section = todosSection(page);
    const title = uid();

    await section.getByPlaceholder('Title *').fill(title);
    await section.getByPlaceholder('Description (optional)').fill('Created by Playwright');
    await section.getByRole('button', { name: 'Add Todo' }).click();

    // The real-time AppSync subscription pushes the new item; wait for it.
    await expect(todoItem(section, title)).toBeVisible();

    // Cleanup — delete the item we just created.
    await todoItem(section, title).getByTitle('Delete').click();
    await expect(todoItem(section, title)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('user can mark a todo as complete', async ({ page }) => {
    const section = todosSection(page);
    const title = uid();

    // Create
    await section.getByPlaceholder('Title *').fill(title);
    await section.getByRole('button', { name: 'Add Todo' }).click();
    await expect(todoItem(section, title)).toBeVisible();

    // Toggle complete — the checkbox sits inside the <label> that contains
    // the title text.
    const item = todoItem(section, title);
    const checkbox = item.getByRole('checkbox');
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    // The <li> gains a "done" class when completed.
    await expect(item).toHaveClass(/done/);

    // Cleanup
    await item.getByTitle('Delete').click();
    await expect(todoItem(section, title)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('user can delete a todo item', async ({ page }) => {
    const section = todosSection(page);
    const title = uid();

    // Create
    await section.getByPlaceholder('Title *').fill(title);
    await section.getByRole('button', { name: 'Add Todo' }).click();
    await expect(todoItem(section, title)).toBeVisible();

    // Delete
    await todoItem(section, title).getByTitle('Delete').click();
    await expect(todoItem(section, title)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('empty state is shown when no todos exist', async ({ page }) => {
    const section = todosSection(page);

    // Delete all visible todos so we can reach the empty state.
    // Each deletion triggers the AppSync subscription which removes the item
    // from the list, so we re-query after every click.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const deleteBtn = section.getByTitle('Delete').first();
      if (!(await deleteBtn.isVisible())) break;
      await deleteBtn.click();
      // Wait for that specific button to leave the DOM before checking again.
      await expect(deleteBtn).not.toBeVisible();
    }

    await expect(section.getByText('No todos yet. Add one above.')).toBeVisible();
  });
});
