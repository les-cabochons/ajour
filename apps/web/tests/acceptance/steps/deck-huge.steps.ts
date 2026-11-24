import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * A huge pull request in Deck (#790): over 1,000 hunks, so the local API,
 * mocked here, builds no guide and says why, and the review page mounts
 * only the rows near the screen, and the guide tree only the ticks in its
 * view. 240 files of 5 hunks each: 1,200 hunks.
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

const OPENED = {
  headSha: "head",
  baseSha: "base",
  files: Array.from({ length: FILE_COUNT }, (_, index) => {
    const path = pathOf(index);
    return {
      path,
      status: "modified",
      binary: false,
      hunks: Array.from({ length: HUNKS_PER_FILE }, (_, at) => hunk(path, at)),
    };
  }),
  guide: null,
  guideSkipped: { reason: "too_many_hunks", hunkLimit: 1_000 },
};

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

/** How far the focused element's top sits below the top of the page's scroller. */
const focusedOffset = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    let box = document.querySelector(".deck-review-sections")?.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
      box = box.parentElement;
    }
    if (!focused || !box) return Number.NaN;
    return (
      focused.getBoundingClientRect().top - box.getBoundingClientRect().top
    );
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
    // J, K and the ticks land a section 16px below the scroller's top.
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
