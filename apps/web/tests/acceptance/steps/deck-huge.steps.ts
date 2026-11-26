import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * A huge pull request in Deck (#790): over 1,000 hunks, so the local API,
 * mocked here, builds no guide and says why, and the review page mounts
 * only the rows near the screen, and the guide tree only the ticks in its
 * view. 240 files of 5 hunks each: 1,200 hunks. A pull request of 600
 * hunks gets its guide, and its page mounts only what's near the screen
 * too.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";

const FILE_COUNT = 240;
const HUNKS_PER_FILE = 5;

/** `src/f007.ts`: padded, so path order is the files' order. */
const pathOf = (index: number) => `src/f${String(index).padStart(3, "0")}.ts`;

/** A hunk as the local API sends it: three lines either side of one changed line. */
function hunk(path: string, index: number) {
  const start = index * 20 + 1;
  const context = (from: number) =>
    Array.from(
      { length: 3 },
      (_, line) => `   const v${from + line} = ${line};`,
    );
  const body = [
    ...context(start),
    `-  return old${index};`,
    `+  return next${index};`,
    ...context(start + 4),
  ];
  const header = `@@ -${start},7 +${start},7 @@`;
  return {
    id: `${path}#${index}`,
    header,
    oldStart: start,
    oldLines: 7,
    newStart: start,
    newLines: 7,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      header,
      ...body,
      "",
    ].join("\n"),
  };
}

const filesOf = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const path = pathOf(index);
    return {
      path,
      status: "modified",
      binary: false,
      hunks: Array.from({ length: HUNKS_PER_FILE }, (_, at) => hunk(path, at)),
    };
  });

const OPENED = {
  headSha: "head",
  baseSha: "base",
  files: filesOf(FILE_COUNT),
  guide: null,
  guideSkipped: { reason: "too_many_hunks", hunkLimit: 1_000 },
};

/** 120 files, 600 hunks, in a guide of three concerns of 40 files each. */
const GUIDED_FILES = filesOf(120);
const CONCERNS = [
  "Read the settings",
  "Write the settings",
  "Test the settings",
];
const GUIDED = {
  headSha: "head",
  baseSha: "base",
  files: GUIDED_FILES,
  guide: {
    madeWith: "code",
    concerns: CONCERNS.map((title, at) => ({
      id: `g${at + 1}`,
      title,
      rationale: "",
      hunkIds: GUIDED_FILES.slice(at * 40, at * 40 + 40).flatMap((file) =>
        file.hunks.map((entry) => entry.id),
      ),
    })),
  },
};

Given(
  "the local API built the guide of a pull request with 600 hunks",
  async ({ page }) => {
    await page.route(
      `${apiUrl}/api/deck/github/connections/work/open`,
      async (route) =>
        route.fulfill({
          json: GUIDED,
          headers: { "access-control-allow-origin": "*" },
        }),
    );
  },
);

Then(
  "concern {int} is focused at the top of the changes",
  async ({ page }, number: number) => {
    await expect(page.locator(":focus")).toHaveText(
      `Concern ${number}: ${CONCERNS[number - 1]}`,
    );
    // Below the sticky versions bar, 16px down.
    await expect
      .poll(async () => Math.abs((await focusedOffset(page)) - 16) <= 2)
      .toBe(true);
  },
);

Then(
  "concern {int}'s title keeps the focus off screen",
  async ({ page }, number: number) => {
    await expect(page.locator(":focus")).toHaveText(
      `Concern ${number}: ${CONCERNS[number - 1]}`,
    );
    expect(await focusedOffset(page)).toBeLessThan(-1000);
  },
);

When(
  "I scroll the changes down by {int} pixels",
  async ({ page }, by: number) => {
    await changes(page)
      .locator(".deck-review-sections")
      .evaluate((list, distance) => {
        let box = list.parentElement;
        while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
          box = box.parentElement;
        }
        box!.scrollTop += distance;
      }, by);
  },
);

Then(
  "the guide tree's ticks run in one row within the narrow viewport",
  async ({ page }) => {
    const tree = page.getByRole("navigation", { name: "Guide tree" });
    const ticks = tree.locator(".deck-tick");
    expect(await ticks.count()).toBeGreaterThan(0);
    expect(await ticks.count()).toBeLessThan(FILE_COUNT);
    const tops = await ticks.evaluateAll((all) =>
      all.map((tick) => Math.round(tick.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/deck-huge-narrow.png" });
  },
);

Given(
  "the local API answers a pull request with too many hunks for a guide",
  async ({ page }) => {
    await page.route(
      `${apiUrl}/api/deck/github/connections/work/open`,
      async (route) =>
        route.fulfill({
          json: OPENED,
          headers: { "access-control-allow-origin": "*" },
        }),
    );
  },
);

const changes = (page: Page) => page.getByRole("region", { name: "Changes" });

/** How far the focus sits below the sticky versions bar (#787), or the scroller's top without one. */
const focusedOffset = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    let box = document.querySelector(".deck-review-sections")?.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
      box = box.parentElement;
    }
    if (!focused || !box) return Number.NaN;
    const bar = document.querySelector(".deck-versions");
    const top = bar
      ? bar.getBoundingClientRect().bottom
      : box.getBoundingClientRect().top;
    return focused.getBoundingClientRect().top - top;
  });

Then(
  "its files show A–Z with the reason there is no guide",
  async ({ page }) => {
    await expect(
      changes(page).getByText(
        "This pull request has more than 1,000 hunks, too many to build a guide, so the files show A–Z.",
      ),
    ).toBeVisible();
    await expect(changes(page).getByRole("heading", { level: 2 })).toHaveText(
      `Files${FILE_COUNT}`,
    );
    await expect(
      changes(page).getByRole("heading", { name: pathOf(0) }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/deck-huge.png" });
  },
);

Then("only the rows near the screen are mounted", async ({ page }) => {
  await expect(changes(page).locator(".deck-hunk").first()).toBeVisible();
  const hunks = await changes(page).locator(".deck-hunk").count();
  expect(hunks).toBeGreaterThan(0);
  expect(hunks).toBeLessThan(40);
  const ticks = await page
    .getByRole("navigation", { name: "Guide tree" })
    .locator(".deck-tick")
    .count();
  expect(ticks).toBeGreaterThan(0);
  expect(ticks).toBeLessThan(FILE_COUNT);
});

Then(
  "file {int} is focused at the top of the changes",
  async ({ page }, number: number) => {
    await expect(page.locator(":focus")).toHaveText(pathOf(number - 1));
    // J, K and the ticks land a section 16px below the sticky versions bar.
    await expect
      .poll(async () => Math.abs((await focusedOffset(page)) - 16) <= 2)
      .toBe(true);
  },
);

When("I scroll the guide tree to its end", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Guide tree" })
    .evaluate((tree) => {
      tree.scrollTop = tree.scrollHeight;
    });
});

When("I go to the last file from its tick", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Guide tree" })
    .getByRole("button", {
      name: `${pathOf(FILE_COUNT - 1)} · 0 of ${HUNKS_PER_FILE} viewed`,
    })
    .click();
});

When("I mark the last file's first hunk viewed", async ({ page }) => {
  await changes(page)
    .getByRole("button", {
      name: `Viewed: ${pathOf(FILE_COUNT - 1)}, lines 1 to 7`,
    })
    .click();
});

Then("the last file's tick counts it viewed", async ({ page }) => {
  await expect(
    page.getByRole("navigation", { name: "Guide tree" }).getByRole("button", {
      name: `${pathOf(FILE_COUNT - 1)} · 1 of ${HUNKS_PER_FILE} viewed`,
    }),
  ).toBeVisible();
});
