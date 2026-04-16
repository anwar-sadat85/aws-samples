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
    // We use the list-item *count* as the exit condition rather than a button
    // locator, because `section.getByTitle('Delete').first()` is a dynamic
    // locator — after a deletion it immediately re-evaluates to the *next*
    // button, which is still visible, causing the old `not.toBeVisible()`
    // check to time out.
    const listItems = section.getByRole('listitem');
    let remaining = await listItems.count();
    console.log(`remaining todos...${remaining}`);
    while (remaining > 0) {
      await section.getByTitle('Delete').first().click();
      remaining -= 1;
      // Wait for AppSync subscription to push the deletion back to the UI.
      await expect(listItems).toHaveCount(remaining);
    }

    await expect(section.getByText('No todos yet. Add one above.')).toBeVisible();
  });
});
