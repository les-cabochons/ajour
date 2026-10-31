import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

function sidebarTitles(page: Page) {
  // Comfortable rows also show the project name, so read the title alone.
  return sidebar(page).locator("[data-backlog-item-id] [data-row-title]");
}

function sidebarRow(page: Page, title: string) {
  return sidebar(page).locator("[data-backlog-item-id]", {
    has: page.locator("[data-row-title]", { hasText: title }),
  });
}

Given("I have backlog items with priorities", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.addInitScript(() => {
    if (sessionStorage.getItem("sidebar-ordering-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("sidebar-ordering-fixture", "true");
    const item = (_id: string, title: string, priority?: number) => ({
      _id,
      title,
      priority,
      source: "manual",
      status: "active",
      createdAt: Date.now(),
    });
    // The custom order is the stored order. By priority, Urgent (1) is first.
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        backlogSortMode: "custom",
        workItems: [
          item("search", "Sidebar search", 3),
          item("backup", "Backup pipeline", 1),
          item("note", "Loose note"),
        ],
      }),
    );
  });
});

/** Presses a sidebar row and moves it above another, without letting go. */
async function startDragging(page: Page, dragged: string, target: string) {
  const from = await sidebarRow(page, dragged).boundingBox();
  const to = await sidebarRow(page, target).boundingBox();
  if (!from || !to) throw new Error("A sidebar row is not rendered");
  await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2);
  await page.mouse.down();
  // Above the target's middle drops the row in front of it.
  await page.mouse.move(to.x + to.width / 3, to.y + 4, { steps: 10 });
}

/**
 * The backlog titles a user sees in the sidebar, from top to bottom: the
 * rows where they show, mid-drag included, and the drag preview.
 */
function visibleTitles(page: Page) {
  return sidebar(page)
    .locator("[data-row-title]")
    .evaluateAll((titles) =>
      titles
        .filter((title) => title.checkVisibility({ visibilityProperty: true }))
        .map((title) => {
          const box = title.getBoundingClientRect();
          return { text: title.textContent, middle: box.top + box.height / 2 };
        })
        .sort((left, right) => left.middle - right.middle)
        .map(({ text }) => text),
    );
}

When(
  "I drag the sidebar row {string} above {string}",
  async ({ page }, dragged: string, target: string) => {
    await startDragging(page, dragged, target);
    await page.mouse.up();
  },
);

When(
  "I start dragging the sidebar row {string} above {string}",
  async ({ page }, dragged: string, target: string) => {
    await startDragging(page, dragged, target);
  },
);

When("I cancel the drag with Escape", async ({ page }) => {
  await page.keyboard.press("Escape");
  await page.mouse.up();
});

Then("the sidebar shows {string} once", async ({ page }, title: string) => {
  await expect
    .poll(async () =>
      (await visibleTitles(page)).filter((text) => text === title),
    )
    .toEqual([title]);
});

Then(
  /^the sidebar shows (.+) from top to bottom$/,
  async ({ page }, list: string) => {
    const expected = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    await expect.poll(() => visibleTitles(page)).toEqual(expected);
  },
);

When(
  "I press Alt+Down on the sidebar row {string}",
  async ({ page }, title: string) => {
    const row = sidebarRow(page, title);
    await row.focus();
    await row.press("Alt+ArrowDown");
  },
);

Then(/^the sidebar reads (.+)$/, async ({ page }, list: string) => {
  const expected = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  await expect(sidebarTitles(page)).toHaveText(expected);
});

Then("the sidebar row {string} has focus", async ({ page }, title: string) => {
  await expect(sidebarRow(page, title)).toBeFocused();
});

When("I open the sidebar filter menu", async ({ page }) => {
  await sidebar(page).getByRole("button", { name: "Filter and order" }).click();
});

When(
  "I order the sidebar by {string} from the keyboard",
  async ({ page }, label: string) => {
    await sidebar(page)
      .getByRole("button", { name: "Filter and order" })
      .click();
    const toggle = page.getByRole("button", { name: `${label} order` });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
  },
);

Then("neither sidebar ordering is pressed", async ({ page }) => {
  for (const name of ["Custom order", "Priority order"]) {
    await expect(page.getByRole("button", { name })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  }
});

When("I pin {string} from the sidebar", async ({ page }, title: string) => {
  await sidebarRow(page, title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
});

When("I order the sidebar by {string}", async ({ page }, label: string) => {
  await sidebar(page).getByRole("button", { name: "Filter and order" }).click();
  const toggle = page.getByRole("button", { name: `${label} order` });
  await toggle.click();
  // The menu stays open, so the pick shows as pressed. Escape closes it.
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
});
