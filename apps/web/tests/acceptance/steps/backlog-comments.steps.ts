import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  commentsOverview,
  commentsSeenAt,
  fixtureCommentPage,
} from "../../fixtures/backlog-comments";

const { Given, When, Then } = createBdd();

const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };

const commentsRegion = (page: Page) =>
  page.getByRole("region", { name: "Comments" });

Given(
  "its plugin lists seven comments, two new from others since my last visit",
  async ({ page }) => {
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      route.fulfill({ json: commentsOverview, headers: cors }),
    );
    await page.route(
      `${apiUrl}/api/backlog-comments/example/connections/fixture/listItemComments`,
      async (route) => {
        const request = route.request().postDataJSON() as {
          cursor?: string;
        };
        await route.fulfill({
          json: fixtureCommentPage(request.cursor),
          headers: cors,
        });
      },
    );
    await page.evaluate((seenAt) => {
      localStorage.setItem(
        "ajour.comments-seen",
        JSON.stringify({ parent: seenAt }),
      );
    }, commentsSeenAt);
  },
);

Then(
  "the page shows the newest five comments with a New divider before Ana's reply",
  async ({ page }) => {
    const region = commentsRegion(page);
    await expect(region.getByRole("article")).toHaveCount(5);
    const items = await region.locator("ol > li").allInnerTexts();
    const newIndex = items.findIndex((text) => text.trim() === "New");
    expect(newIndex).toBeGreaterThan(0);
    expect(items.slice(0, newIndex).join("\n")).toContain("Third comment");
    expect(items[newIndex + 1]).toContain("Before the task name, please.");
    expect(items[newIndex + 1]).toContain("edited");
    expect(items.at(-1)).toContain("Seventh comment");
  },
);

Then(
  "my comment says You and its mention shows as a chip",
  async ({ page }) => {
    const mine = commentsRegion(page).getByRole("article", {
      name: "Your comment",
    });
    await expect(mine).toContainText("You");
    await expect(mine.getByText("@Ana Silva", { exact: true })).toBeVisible();
    await expect(mine.getByRole("link")).toHaveCount(0);
    await expect(
      commentsRegion(page).getByLabel("Like: 2, including you"),
    ).toBeVisible();
  },
);

When("I show earlier comments", async ({ page }) => {
  await commentsRegion(page)
    .getByRole("button", { name: /^Show earlier comments/ })
    .click();
});

Then("all seven comments show, oldest first", async ({ page }) => {
  const articles = commentsRegion(page).getByRole("article");
  await expect(articles).toHaveCount(7);
  await expect(articles.first()).toContainText("First comment");
  await expect(
    commentsRegion(page).getByRole("button", {
      name: /^Show earlier comments/,
    }),
  ).toHaveCount(0);
});
