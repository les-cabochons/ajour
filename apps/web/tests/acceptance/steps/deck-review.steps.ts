import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * Deck's draft review (#784): a comment from the "+" beside a line, kept in
 * the draft review, then sent with Finish review. The local API is mocked;
 * the diff library is the real one, so its "+" is what the user clicks.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";

/** What the code host was sent, per test. */
let reviews: unknown[] = [];

const changes = (page: Page) => page.getByRole("region", { name: "Changes" });

Given("the code host takes reviews", async ({ page }) => {
  reviews = [];
  await page.route(
    `${apiUrl}/api/code-hosts/github/connections/work/submitReview`,
    async (route) => {
      reviews.push(route.request().postDataJSON());
      await route.fulfill({
        json: { reviewId: "review-1" },
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
});

When(
  "I comment {string} on the line that reads {string}",
  async ({ page }, comment: string, line: string) => {
    const code = changes(page).getByText(line, { exact: true });
    await code.hover();
    // The library's one "+" follows the pointer, beside the line's number.
    await changes(page).locator("[data-utility-button]").click();
    const field = page.getByRole("textbox", { name: "Comment" });
    await field.fill(comment);
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/deck-composer.png" });
  },
);

When("I add it to the review with Ctrl+Enter", async ({ page }) => {
  await page.getByRole("textbox", { name: "Comment" }).press("Control+Enter");
});

Then(
  "the draft comment {string} sits beside its line",
  async ({ page }, comment: string) => {
    const card = changes(page)
      .getByRole("article", {
        name: "Draft comment on src/client/retry.ts, line 13",
      })
      .first();
    await expect(card).toContainText(comment);
    await card.scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Finish review · 1" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/deck-draft-comment.png" });
  },
);

Then("Finish review opens on Approve", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Finish review" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Approve" })).toBeChecked();
  await expect(dialog.getByText("1 comment goes with it.")).toBeVisible();
  await page.screenshot({ path: "test-results/deck-finish-review.png" });
});

When("I submit the review", async ({ page }) => {
  await page
    .getByRole("dialog", { name: "Finish review" })
    .getByRole("button", { name: "Submit review" })
    .click();
});

Then(
  "the code host gets an approval with the comment {string}",
  async ({ page }, comment: string) => {
    await expect(
      page.getByRole("button", { name: "Finish review" }),
    ).toBeVisible();
    expect(reviews).toEqual([
      {
        repository: "acme/api",
        number: 1,
        headSha: "head",
        verdict: "approve",
        comments: [
          {
            path: "src/client/retry.ts",
            side: "head",
            line: 13,
            body: comment,
          },
        ],
      },
    ]);
  },
);
