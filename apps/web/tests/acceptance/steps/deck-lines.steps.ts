import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * Explain on selected lines (#793): dragging over line numbers shows the
 * toolbar above them, E asks about them, the answer follows the hunk, its
 * citation scrolls to its line, and Turn into a comment opens the
 * composer with it. On a huge pull request the answer stays while its
 * row scrolls away and back. The local API is mocked; the diff library is
 * the real one, so the line numbers dragged over are the ones it draws.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";

/** What the page asked, per test. */
let asked: unknown[] = [];

const changes = (page: Page) => page.getByRole("region", { name: "Changes" });

/** The box of the first hunk of the file at `path`. */
const hunkOf = (page: Page, path = "src/client/retry.ts") =>
  changes(page).locator(`[data-hunk^="${path}#"]`).first();

/** The hunk's line number `line`, as the library draws it. */
const lineNumber = (page: Page, line: number, path?: string) =>
  hunkOf(page, path).locator(`[data-column-number="${line}"]`).first();

async function dragOver(page: Page, from: number, to: number, path?: string) {
  const start = lineNumber(page, from, path);
  await start.scrollIntoViewIfNeeded();
  const a = (await start.boundingBox())!;
  const b = (await lineNumber(page, to, path).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
}

Given(
  "asks about lines are answered with {string}",
  async ({ page }, answer: string) => {
    asked = [];
    await page.route(
      `${apiUrl}/api/deck/github/connections/work/ask`,
      async (route) => {
        asked.push(route.request().postDataJSON());
        await route.fulfill({
          json: { kind: "answer", text: answer, head: "head" },
          headers: { "access-control-allow-origin": "*" },
        });
      },
    );
  },
);

When(
  "I drag over the line numbers from line {int} to line {int}",
  async ({ page }, from: number, to: number) => dragOver(page, from, to),
);

When(
  "I drag over the line numbers of {string} from line {int} to line {int}",
  async ({ page }, path: string, from: number, to: number) =>
    dragOver(page, from, to, path),
);

Then(
  "the explanation of {string} shows {string}",
  async ({ page }, lines: string, text: string) => {
    const answer = changes(page).getByRole("region", {
      name: `Explanation of ${lines}`,
    });
    await answer.scrollIntoViewIfNeeded();
    await expect(answer).toContainText(text);
  },
);

Then("no explanation is mounted", async ({ page }) => {
  await expect(
    changes(page).getByRole("region", { name: /^Explanation of/ }),
  ).toHaveCount(0);
});

Then(
  "the explanation fits the narrow viewport after the hunk",
  async ({ page }) => {
    const answer = changes(page).getByRole("region", {
      name: /^Explanation of/,
    });
    const box = (await answer.boundingBox())!;
    const hunk = (await hunkOf(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(hunk.y + hunk.height);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/deck-lines-narrow.png" });
  },
);

When("I scroll the changes back to the top", async ({ page }) => {
  await changes(page)
    .locator(".deck-review-sections")
    .evaluate((list) => {
      let box = list.parentElement;
      while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
        box = box.parentElement;
      }
      box!.scrollTop = 0;
    });
});

Then(
  "the toolbar for {string} shows above line {int}",
  async ({ page }, name: string, line: number) => {
    const toolbar = page.getByRole("toolbar", { name });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button")).toHaveText([
      "ExplainE",
      "CommentC",
      "Ask…A",
    ]);
    const bar = (await toolbar.boundingBox())!;
    const number = (await lineNumber(page, line).boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(number.y + 1);
    await page.screenshot({ path: "test-results/deck-lines-toolbar.png" });
  },
);

Then(
  "the explanation of {string} follows the hunk with {string}",
  async ({ page }, lines: string, text: string) => {
    const answer = changes(page).getByRole("region", {
      name: `Explanation of ${lines}`,
    });
    await expect(answer).toContainText(text);
    await expect(answer).toContainText("From the code at head");
    const hunk = (await changes(page)
      .getByRole("group", { name: /^src\/client\/retry\.ts/ })
      .boundingBox())!;
    const box = (await answer.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(hunk.y + hunk.height);
    expect(asked).toEqual([
      {
        repository: "acme/api",
        number: 1,
        head: "head",
        anchor: {
          kind: "lines",
          path: "src/client/retry.ts",
          start: { side: "head", line: 12 },
          end: { side: "head", line: 14 },
        },
      },
    ]);
    await answer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/deck-lines-answer.png" });
  },
);

When("I follow the citation {string}", async ({ page }, name: string) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await changes(page).getByRole("button", { name }).click();
});

Then("line {int} is highlighted on screen", async ({ page }, line: number) => {
  const code = changes(page)
    .getByRole("group", { name: /^src\/client\/retry\.ts/ })
    .locator(`[data-line="${line}"][data-selected-line]`)
    .first();
  await expect(code).toBeInViewport();
});

When("I turn the explanation into a comment", async ({ page }) => {
  await changes(page)
    .getByRole("button", { name: "Turn into a comment" })
    .click();
});

Then("the composer holds {string}", async ({ page }, text: string) => {
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveValue(
    text,
  );
});

Then(
  "a draft comment on lines {int} to {int} holds {string}",
  async ({ page }, from: number, to: number, text: string) => {
    const card = changes(page).getByRole("article", {
      name: new RegExp(`^Draft comment on src/client/retry\.ts, lines ${from}`),
    });
    await expect(card).toContainText(text);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/deck-lines-comment.png" });
    expect(to).toBeGreaterThan(from);
  },
);
