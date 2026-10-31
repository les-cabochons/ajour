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

/**
 * Presses a sidebar row and moves it just enough to start the drag. With
 * Priority ordering the level labels show then, and push the rows down.
 */
async function pickUp(page: Page, dragged: string) {
  const from = await sidebarRow(page, dragged).boundingBox();
  if (!from) throw new Error("A sidebar row is not rendered");
  await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2 + 6, {
    steps: 2,
  });
}

/**
 * Presses a sidebar row and moves it above or below another, without
 * letting go.
 */
async function startDragging(
  page: Page,
  dragged: string,
  edge: "above" | "below",
  target: string,
) {
  await pickUp(page, dragged);
  // Measured once the drag shows its labels, if any.
  const to = await sidebarRow(page, target).boundingBox();
  if (!to) throw new Error("A sidebar row is not rendered");
  // Above the target's middle drops the row in front of it, below it after.
  const y = edge === "above" ? to.y + 4 : to.y + to.height - 4;
  await page.mouse.move(to.x + to.width / 3, y, { steps: 10 });
}

function settleZone(page: Page) {
  return sidebar(page).locator('[data-drop-target="settle/zone"]');
}

/** Picks up a sidebar row and moves it over the Settle zone. */
async function dragOntoSettleZone(page: Page, dragged: string) {
  await pickUp(page, dragged);
  const zone = await settleZone(page).boundingBox();
  if (!zone) throw new Error("The Settle zone does not show");
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, {
    steps: 10,
  });
}

function levelLabel(page: Page, level: string) {
  return sidebar(page).locator("[data-level-label]", {
    hasText: new RegExp(`^${level}$`),
  });
}

/** The levels' numbers as stored, from Urgent (1) to Low (4). */
const LEVELS: Record<string, number | undefined> = {
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  "No priority": undefined,
};

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

/**
 * The list's titles from top to bottom as they show mid-drag, without the
 * drag preview, and "the gap" where the list leaves room for the dragged
 * row: a stretch of its lane that no shown row or label covers.
 */
function titlesAroundTheGap(page: Page) {
  return sidebar(page)
    .locator("[data-reorder-block]")
    .evaluateAll((lanes) =>
      lanes.flatMap((lane) => {
        const tiles = [
          ...lane.querySelectorAll<HTMLElement>(
            "[data-backlog-item-id], [data-level-label]",
          ),
        ]
          .filter((tile) => tile.checkVisibility({ visibilityProperty: true }))
          .map((tile) => ({
            box: tile.getBoundingClientRect(),
            text: tile.matches("[data-backlog-item-id]")
              ? tile.querySelector("[data-row-title]")!.textContent
              : null,
          }))
          .sort((left, right) => left.box.top - right.box.top);
        const read: { text: string | null; middle: number }[] = [];
        const laneBox = lane.getBoundingClientRect();
        let covered = laneBox.top;
        for (const { box, text } of [
          ...tiles,
          { box: new DOMRect(0, laneBox.bottom, 0, 0), text: null },
        ]) {
          // Rows touch, so a stretch of more than a few pixels is the gap.
          if (box.top - covered > 4)
            read.push({ text: "the gap", middle: (covered + box.top) / 2 });
          if (text) read.push({ text, middle: box.top + box.height / 2 });
          covered = Math.max(covered, box.bottom);
        }
        return read
          .sort((left, right) => left.middle - right.middle)
          .map(({ text }) => text);
      }),
    );
}

When(
  /^I drag the sidebar row "([^"]+)" (above|below) "([^"]+)"$/,
  async (
    { page },
    dragged: string,
    edge: "above" | "below",
    target: string,
  ) => {
    await startDragging(page, dragged, edge, target);
    await page.mouse.up();
  },
);

When(
  /^I start dragging the sidebar row "([^"]+)" (above|below) "([^"]+)"$/,
  async (
    { page },
    dragged: string,
    edge: "above" | "below",
    target: string,
  ) => {
    await startDragging(page, dragged, edge, target);
  },
);

When(
  "I pick up the sidebar row {string} and drop it in place",
  async ({ page }, dragged: string) => {
    const from = await sidebarRow(page, dragged).boundingBox();
    if (!from) throw new Error("A sidebar row is not rendered");
    await pickUp(page, dragged);
    // The preview shows with the level labels, if any, once they have
    // pushed the rows down. A hand never holds still: the pointer moves a
    // little more within the row's own place, then lets go.
    await expect(page.locator(".sidebar-drag-preview")).toBeVisible();
    await page.mouse.move(
      from.x + from.width / 3,
      from.y + from.height / 2 + 8,
    );
    await page.mouse.up();
  },
);

When(
  "I start dragging the sidebar row {string} onto the level {string}, following its label",
  async ({ page }, dragged: string, level: string) => {
    await pickUp(page, dragged);
    // The pointer goes to the label, then once more to where the label
    // moved when the dragged row left the levels above it.
    for (let round = 0; round < 2; round += 1) {
      const label = await levelLabel(page, level).boundingBox();
      if (!label) throw new Error(`The level ${level} shows no label`);
      await page.mouse.move(
        label.x + label.width / 3,
        label.y + label.height / 2,
        { steps: 10 },
      );
    }
  },
);

When(
  "I start dragging the sidebar row {string} onto the level {string}",
  async ({ page }, dragged: string, level: string) => {
    await pickUp(page, dragged);
    const label = await levelLabel(page, level).boundingBox();
    if (!label) throw new Error(`The level ${level} shows no label`);
    await page.mouse.move(
      label.x + label.width / 3,
      label.y + label.height / 2,
      {
        steps: 10,
      },
    );
  },
);

When(
  "I drag the sidebar row {string} onto the level {string}",
  async ({ page }, dragged: string, level: string) => {
    await pickUp(page, dragged);
    const label = await levelLabel(page, level).boundingBox();
    if (!label) throw new Error(`The level ${level} shows no label`);
    await page.mouse.move(
      label.x + label.width / 3,
      label.y + label.height / 2,
      {
        steps: 10,
      },
    );
    await page.mouse.up();
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

/**
 * Titles in quotes, and "the gap" where the list should leave room for the
 * dragged row. A list that names the gap reads the rows without the drag
 * preview; one that doesn't reads the preview where it floats.
 */
Then(
  /^the sidebar shows (.+) from top to bottom$/,
  async ({ page }, list: string) => {
    const expected = [...list.matchAll(/"([^"]+)"|the gap/g)].map(
      (match) => match[1] ?? match[0],
    );
    const read = expected.includes("the gap")
      ? titlesAroundTheGap
      : visibleTitles;
    await expect.poll(() => read(page)).toEqual(expected);
  },
);

Given(
  "{string} has a subitem {string} with its own priority",
  async ({ page }, parent: string, title: string) => {
    await page.evaluate(
      ({ parent, title }) => {
        const key = "ajour.local-state.v2";
        const state = JSON.parse(localStorage.getItem(key)!);
        const parentItem = state.workItems.find(
          (workItem: { title: string }) => workItem.title === parent,
        );
        // Stored last, so only its parent's place puts it in the list.
        state.workItems.push({
          _id: `${parentItem._id}-subitem`,
          title,
          priority: 2,
          parentWorkItemId: parentItem._id,
          source: "manual",
          status: "active",
          createdAt: Date.now(),
        });
        localStorage.setItem(key, JSON.stringify(state));
      },
      { parent, title },
    );
    await page.reload();
  },
);

When(
  /^I press Alt\+(Up|Down) on the sidebar row "([^"]+)"$/,
  async ({ page }, key: string, title: string) => {
    const row = sidebarRow(page, title);
    await row.focus();
    await row.press(`Alt+Arrow${key}`);
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

Then(
  /^the sidebar shows the levels (.+) with "([^"]+)" highlighted$/,
  async ({ page }, list: string, highlighted: string) => {
    const expected = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const labels = sidebar(page).locator("[data-level-label]");
    await expect(labels).toHaveText(expected);
    await expect(labels.and(page.locator("[data-active]"))).toHaveText([
      highlighted,
    ]);
  },
);

Then("no level is highlighted", async ({ page }) => {
  await expect(sidebar(page).locator("[data-level-label]")).not.toHaveCount(0);
  await expect(
    sidebar(page).locator("[data-level-label][data-active]"),
  ).toHaveCount(0);
});

Then("the sidebar shows no levels", async ({ page }) => {
  await expect(sidebar(page).locator("[data-level-label]")).toHaveCount(0);
});

Given(
  "the item {string} is {string}",
  async ({ page }, title: string, level: string) => {
    await page.evaluate(
      async ({ title, priority }) => {
        const { localStore } = await import(
          /* @vite-ignore */ "/src/lib/local-store.ts"
        );
        const item = localStore
          .snapshot()
          .workItems.find((workItem) => workItem.title === title)!;
        localStore.updateWorkItem(item._id, { priority });
      },
      { title, priority: LEVELS[level] },
    );
  },
);

Given(
  "the item {string} comes from a source that has its priority",
  async ({ page }, title: string) => {
    // A synced item whose source holds a priority, as a sync leaves it.
    await page.evaluate((title) => {
      const key = "ajour.local-state.v2";
      const state = JSON.parse(localStorage.getItem(key)!);
      const item = state.workItems.find(
        (workItem: { title: string }) => workItem.title === title,
      );
      Object.assign(item, {
        source: "example",
        sourceId: `source-${item._id}`,
        sourceConnectionId: "fixture",
        importedPriority: item.priority,
      });
      localStorage.setItem(key, JSON.stringify(state));
    }, title);
    await page.reload();
  },
);

Then("{string} is still pinned", async ({ page }, title: string) => {
  await expect
    .poll(() =>
      page.evaluate(
        (title) =>
          JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.find(
            (workItem: { title: string }) => workItem.title === title,
          ).pinnedAt !== undefined,
        title,
      ),
    )
    .toBe(true);
});

Then(
  "{string} is now {string}",
  async ({ page }, title: string, level: string) => {
    await expect
      .poll(() =>
        page.evaluate(
          (title) =>
            JSON.parse(
              localStorage.getItem("ajour.local-state.v2")!,
            ).workItems.find(
              (workItem: { title: string }) => workItem.title === title,
            ).priority ?? null,
          title,
        ),
      )
      .toBe(LEVELS[level] ?? null);
  },
);

Then(/^the Backlog page reads (.+)$/, async ({ page }, list: string) => {
  const expected = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  await expect(
    page.locator("main [data-work-item-id] .backlog-item-title"),
  ).toHaveText(expected);
});

When(
  "I start dragging the sidebar row {string} onto the Settle zone",
  async ({ page }, dragged: string) => {
    await dragOntoSettleZone(page, dragged);
  },
);

When(
  "I drag the sidebar row {string} onto the Settle zone",
  async ({ page }, dragged: string) => {
    await dragOntoSettleZone(page, dragged);
    await page.mouse.up();
  },
);

Then("the Settle zone shows", async ({ page }) => {
  await expect(settleZone(page)).toBeVisible();
});

Then("the Settle zone is hidden", async ({ page }) => {
  await expect(settleZone(page)).toHaveCount(0);
});

Then("the Settle zone is highlighted", async ({ page }) => {
  await expect(settleZone(page)).toHaveAttribute("data-active", "true");
});

Then("the Settled section lists {string}", async ({ page }, title: string) => {
  const header = sidebar(page).getByRole("button", { name: /^Settled/ });
  if ((await header.getAttribute("aria-expanded")) === "false")
    await header.click();
  await expect(sidebarRow(page, title)).toBeVisible();
});

Given("the source's plugin can write", async ({ page }) => {
  const plugin = {
    id: "example",
    version: "1.0.0",
    apiVersion: 3,
    displayName: "Fixture source",
    iconSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    entrypoint: "dist/plugin.js",
    capabilities: { connector: { settle: true } },
    connectionFields: [],
  };
  // Routes added later answer first, so this replaces the fixture's.
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: true,
        plugins: [plugin],
        connectionGroups: [{ plugin, enabled: true, connections: [] }],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.reload();
});

When("I cancel the settle dialog", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
