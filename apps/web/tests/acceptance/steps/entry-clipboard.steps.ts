import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

/** A Day list row, found by its task or note. */
function dayRow(page: Page, text: string) {
  return page.locator(".time-entry-row", { hasText: text });
}

/** A Days column, named like "Monday, October 5". */
function daysColumn(page: Page, day: string) {
  return page.getByRole("region", { name: new RegExp(`^${day},`) });
}

function daysCard(page: Page, day: string, text: string) {
  return daysColumn(page, day).locator(".weekly-entry-card", { hasText: text });
}

/** Matches each item's text to one expected label, so the order reads plainly. */
async function readLabels(
  items: ReturnType<Page["locator"]>,
  labels: string[],
) {
  return (await items.allInnerTexts()).map(
    (text) => labels.find((label) => text.includes(label)) ?? text,
  );
}

function quotedList(list: string) {
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

When("I open Monday's Day list", async ({ page }) => {
  await page.goto("/time/2026-10-05");
  await expect(dayRow(page, "API")).toBeVisible();
});

When("I click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click();
});

When("I Cmd-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click({ modifiers: ["ControlOrMeta"] });
});

When("I Shift-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click({ modifiers: ["Shift"] });
});

When("I double-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).dblclick();
});

Then("only the {string} entry is selected", async ({ page }, text: string) => {
  await expect(dayRow(page, text)).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(".time-entry-row[aria-selected='true']"),
  ).toHaveCount(1);
});

Then("no entry is selected", async ({ page }) => {
  await expect(dayRow(page, "API")).toBeVisible();
  await expect(
    page.locator(".time-entry-row[aria-selected='true']"),
  ).toHaveCount(0);
});

When("I go to {word} in the day strip", async ({ page }, day: string) => {
  await page
    .getByRole("tab", { name: new RegExp(`^${day.slice(0, 3)}`, "i") })
    .click();
});

Then(/^the Day list reads (.+)$/, async ({ page }, list: string) => {
  const expected = quotedList(list);
  await expect
    .poll(() => readLabels(page.locator(".time-entry-row"), expected))
    .toEqual(expected);
});

Then("a toast says {string}", async ({ page }, title: string) => {
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByText(title),
  ).toBeVisible();
});

When(
  "I click {word}'s {string} card",
  async ({ page }, day: string, text: string) => {
    await daysCard(page, day, text).click();
  },
);

When(
  "I Shift-click {word}'s {string} card",
  async ({ page }, day: string, text: string) => {
    await daysCard(page, day, text).click({ modifiers: ["Shift"] });
  },
);

Then("{int} cards are dimmed as cut", async ({ page }, count: number) => {
  await expect(page.locator(".weekly-entry-card.is-cut")).toHaveCount(count);
});

Then("{word} has no cards", async ({ page }, day: string) => {
  await expect(daysColumn(page, day)).toBeVisible();
  await expect(daysColumn(page, day).locator(".weekly-entry-card")).toHaveCount(
    0,
  );
});

When(
  "I right-click {word}'s column and choose {string}",
  async ({ page }, day: string, item: string) => {
    // The column's empty space, below its "Add" button.
    await daysColumn(page, day)
      .getByRole("group")
      .click({ button: "right", position: { x: 20, y: 200 } });
    await page.getByRole("menuitem", { name: item }).click();
  },
);

When(
  "I press the mouse on the {string} entry",
  async ({ page }, text: string) => {
    const box = await dayRow(page, text).boundingBox();
    if (!box) throw new Error(`The ${text} entry is not rendered`);
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
  },
);

When("I release the mouse", async ({ page }) => {
  await page.mouse.up();
});

When(
  "I right-click the {string} entry and choose {string}",
  async ({ page }, text: string, item: string) => {
    await dayRow(page, text).click({ button: "right" });
    await page.getByRole("menuitem", { name: item }).click();
  },
);

When("I choose Select All from the Edit menu", async ({ page }) => {
  // The desktop Edit menu's Select All runs the browser's select-all command.
  await page.evaluate(() => document.execCommand("selectAll"));
});

Then("{int} entries are selected", async ({ page }, count: number) => {
  await expect(
    page.locator(".time-entry-row[aria-selected='true']"),
  ).toHaveCount(count);
});

Then("the Day list is empty", async ({ page }) => {
  await expect(page.getByText("No time entries")).toBeVisible();
});

Then("{int} cards are selected", async ({ page }, count: number) => {
  await expect(
    page.locator(".weekly-entry-card[aria-pressed='true']"),
  ).toHaveCount(count);
});

Then(
  "{word}'s {string} card is selected",
  async ({ page }, day: string, text: string) => {
    await expect(daysCard(page, day, text)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
);

Given("the page may read the clipboard", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
});

When("another app copies {string}", async ({ page }, text: string) => {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
});

type NativeMenuItem = { type: string; id?: string; label?: string };

/** The native menus the stand-in desktop bridge was asked to show. */
function shownNativeMenus(page: Page) {
  return page.evaluate(
    () =>
      new Promise<NativeMenuItem[][]>((resolve) =>
        // The menu pops up after the render the right-click causes.
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(
              (window as unknown as { __nativeMenus: NativeMenuItem[][] })
                .__nativeMenus,
            ),
          ),
        ),
      ),
  );
}

Given(
  "the desktop app picks {string} from its right-click menus",
  async ({ page }, label: string) => {
    // Stands in for the Electron bridge: records each native menu and picks
    // the item with this label.
    await page.addInitScript((wanted) => {
      const shown: NativeMenuItem[][] = [];
      Object.assign(window, {
        __nativeMenus: shown,
        ajourDesktop: {
          showContextMenu: async (items: NativeMenuItem[]) => {
            shown.push(items);
            return items.find((item) => item.label === wanted)?.id ?? null;
          },
        },
      });
    }, label);
  },
);

Then(/^the desktop menu lists (.+)$/, async ({ page }, list: string) => {
  await expect
    .poll(async () => {
      const menus = await shownNativeMenus(page);
      return (menus.at(-1) ?? []).flatMap((item) =>
        item.type === "item" ? [item.label] : [],
      );
    })
    .toEqual(quotedList(list));
  expect(await shownNativeMenus(page)).toHaveLength(1);
});

Then("the desktop app showed no menu", async ({ page }) => {
  expect(await shownNativeMenus(page)).toEqual([]);
});

When(
  "I select the text {string} in its entry",
  async ({ page }, text: string) => {
    await dayRow(page, text)
      .getByText(text, { exact: true })
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
  },
);

When(
  "I right-click the selected text {string}",
  async ({ page }, text: string) => {
    await dayRow(page, text)
      .getByText(text, { exact: true })
      .click({ button: "right" });
  },
);

When("I right-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click({ button: "right" });
});

When(
  "I right-click {word}'s {string} card and choose {string}",
  async ({ page }, day: string, text: string, item: string) => {
    await daysCard(page, day, text).click({ button: "right" });
    await page.getByRole("menuitem", { name: item }).click();
  },
);

Then(/^the menu lists (.+)$/, async ({ page }, list: string) => {
  const expected = quotedList(list);
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items.first()).toBeVisible();
  // Each item ends with its key, which differs between platforms.
  await expect
    .poll(async () =>
      (await items.allInnerTexts()).map(
        (text) =>
          // The longest label wins, so "Duplicate 2 entries to…" is not read
          // as "Duplicate 2 entries".
          expected
            .filter((label) => text.startsWith(label))
            .sort((left, right) => right.length - left.length)[0] ?? text,
      ),
    )
    .toEqual(expected);
});

When(
  /^I choose October (\d+) in the "([^"]+)" dialog$/,
  async ({ page }, day: string, title: string) => {
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", {
        name: new RegExp(`October ${day}(st|nd|rd|th)?,`),
      })
      .click();
    await dialog.getByRole("button", { name: /^(Move|Duplicate)$/ }).click();
    await expect(dialog).toHaveCount(0);
  },
);

Then(
  "rows {int} and {int} of the Day list are selected",
  async ({ page }, first: number, second: number) => {
    const rows = page.locator(".time-entry-row");
    await expect(
      page.locator(".time-entry-row[aria-selected='true']"),
    ).toHaveCount(2);
    await expect(rows.nth(first - 1)).toHaveAttribute("aria-selected", "true");
    await expect(rows.nth(second - 1)).toHaveAttribute("aria-selected", "true");
  },
);

Then(
  "only row {int} of the Day list is selected",
  async ({ page }, row: number) => {
    await expect(
      page.locator(".time-entry-row[aria-selected='true']"),
    ).toHaveCount(1);
    await expect(page.locator(".time-entry-row").nth(row - 1)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
);

When(
  "I Cmd-click {word}'s {string} card",
  async ({ page }, day: string, text: string) => {
    await daysCard(page, day, text).click({ modifiers: ["ControlOrMeta"] });
  },
);

/** Presses an element and moves the pointer in steps, past the drag threshold. */
async function pressAndMove(
  page: Page,
  from: ReturnType<Page["locator"]>,
  to: { x: number; y: number },
) {
  const box = await from.boundingBox();
  if (!box) throw new Error("The dragged element is not rendered");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

When(
  "I start dragging {word}'s {string} card onto {word}",
  async ({ page }, day: string, text: string, targetDay: string) => {
    const column = await daysColumn(page, targetDay).boundingBox();
    if (!column) throw new Error(`The ${targetDay} column is not rendered`);
    await pressAndMove(page, daysCard(page, day, text), {
      x: column.x + column.width / 2,
      y: column.y + 120,
    });
  },
);

Then(
  "the drag preview counts {int} entries",
  async ({ page }, count: number) => {
    await expect(page.locator(".entry-drag-count")).toHaveText(String(count));
  },
);

When(
  "I drag {word}'s {string} card above {word}'s {string} card",
  async (
    { page },
    day: string,
    text: string,
    targetDay: string,
    target: string,
  ) => {
    const targetBox = await daysCard(page, targetDay, target).boundingBox();
    if (!targetBox) throw new Error(`The ${target} card is not rendered`);
    // Above the target card's middle drops the cards in front of it.
    await pressAndMove(page, daysCard(page, day, text), {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + 4,
    });
    await page.mouse.up();
  },
);

When(
  "I drag the {string} entry below the {string} entry",
  async ({ page }, text: string, target: string) => {
    const targetBox = await dayRow(page, target).boundingBox();
    if (!targetBox) throw new Error(`The ${target} entry is not rendered`);
    // Below the target row's middle drops the rows after it.
    await pressAndMove(page, dayRow(page, text), {
      x: targetBox.x + targetBox.width / 3,
      y: targetBox.y + targetBox.height - 4,
    });
    await page.mouse.up();
  },
);

function stripTab(page: Page, day: string) {
  return page.getByRole("tab", {
    name: new RegExp(`^${day.slice(0, 3)}`, "i"),
  });
}

When("I open Tuesday's Day list", async ({ page }) => {
  await page.goto("/time/2026-10-06");
  await expect(dayRow(page, "Login form")).toBeVisible();
});

When(
  "I start dragging the {string} entry onto {word} in the day strip",
  async ({ page }, text: string, day: string) => {
    const tab = await stripTab(page, day).boundingBox();
    if (!tab) throw new Error(`The ${day} tab is not rendered`);
    await pressAndMove(page, dayRow(page, text), {
      x: tab.x + tab.width / 2,
      y: tab.y + tab.height / 2,
    });
  },
);

When(
  "I drag the {string} entry onto {word} in the day strip",
  async ({ page }, text: string, day: string) => {
    const tab = await stripTab(page, day).boundingBox();
    if (!tab) throw new Error(`The ${day} tab is not rendered`);
    await pressAndMove(page, dayRow(page, text), {
      x: tab.x + tab.width / 2,
      y: tab.y + tab.height / 2,
    });
    await page.mouse.up();
  },
);

Then(
  "{word}'s tab in the day strip is a drop target",
  async ({ page }, day: string) => {
    await expect(stripTab(page, day)).toHaveClass(/is-drop-target/);
  },
);

Then(
  "{word}'s tab in the day strip is not a drop target",
  async ({ page }, day: string) => {
    await expect(page.locator(".time-entry-drag-preview")).toBeVisible();
    await expect(stripTab(page, day)).not.toHaveClass(/is-drop-target/);
  },
);

Then("{word} is the shown day", async ({ page }, day: string) => {
  await expect(stripTab(page, day)).toHaveAttribute("aria-selected", "true");
});

When(
  "I flick the {string} entry onto {word} in the day strip",
  async ({ page }, text: string, day: string) => {
    const tab = await stripTab(page, day).boundingBox();
    const row = await dayRow(page, text).boundingBox();
    if (!tab || !row) throw new Error("The row or the tab is not rendered");
    // One move: the one that starts the drag already lands on the tab.
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await page.mouse.up();
  },
);

/**
 * Scrolls the element that scrolls the Day page, the list and the strip
 * together, to `top`. Returns where it got to.
 */
async function scrollDayPage(page: Page, top: number) {
  return page.evaluate((target) => {
    const candidates: Element[] = [];
    let element = document.querySelector(".time-entries")?.parentElement;
    while (element) {
      candidates.push(element);
      element = element.parentElement;
    }
    if (document.scrollingElement) candidates.push(document.scrollingElement);
    const scroller = candidates.find(
      (candidate) =>
        candidate.scrollHeight > candidate.clientHeight + 1 &&
        getComputedStyle(candidate).overflowY !== "hidden",
    );
    if (!scroller) throw new Error("The Day page does not scroll");
    scroller.scrollTop = target;
    return scroller.scrollTop;
  }, top);
}

/** Where the "drag above Login form" step left the pointer, for the scroll step. */
let heldPointer: { x: number; y: number } | null = null;
let scrolledBy = 0;

When(
  "I open Monday's Day list in a short window, scrolled past the day strip",
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 240 });
    await page.goto("/time/2026-10-05");
    await expect(dayRow(page, "API")).toBeVisible();
    const tab = await stripTab(page, "Monday").boundingBox();
    const login = await dayRow(page, "Login form").boundingBox();
    if (!tab || !login)
      throw new Error("The strip or the list is not rendered");
    // Scrolled so that, scrolled back, Monday's tab comes where the upper half
    // of "Login form" is now.
    const wanted = login.y + 8 - (tab.y + tab.height / 2);
    scrolledBy = await scrollDayPage(page, wanted);
    expect(scrolledBy).toBeGreaterThan(wanted - 1);
    heldPointer = { x: tab.x + tab.width / 2, y: login.y + 8 - scrolledBy };
  },
);

When(
  "I drag the {string} entry above the {string} entry without releasing",
  async ({ page }, text: string, target: string) => {
    if (!heldPointer) throw new Error("Open the short window first");
    const row = await dayRow(page, text).boundingBox();
    const above = await dayRow(page, target).boundingBox();
    if (!row || !above) throw new Error("The rows are not rendered");
    await page.mouse.move(heldPointer.x, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(heldPointer.x, above.y + 8, { steps: 10 });
    heldPointer = { x: heldPointer.x, y: above.y + 8 };
  },
);

When(
  "the page scrolls back up until Monday's tab is under the pointer",
  async ({ page }) => {
    await scrollDayPage(page, 0);
    await expect(stripTab(page, "Monday")).toBeVisible();
  },
);
