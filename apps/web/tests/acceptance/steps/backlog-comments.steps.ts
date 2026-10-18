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

Given("its plugin {word} new comments", async ({ page }, outcome: string) => {
  await page.route(
    `${apiUrl}/api/backlog-comments/example/connections/fixture/postItemComment`,
    async (route) => {
      if (outcome !== "accepts") {
        await route.fulfill({
          status: 502,
          json: { error: "Azure DevOps request failed (403): no access" },
          headers: cors,
        });
        return;
      }
      const request = route.request().postDataJSON() as { body: string };
      await route.fulfill({
        json: {
          comment: {
            id: "c8",
            author: { id: "me", displayName: "Alex" },
            body: request.body,
            createdAt: new Date().toISOString(),
          },
        },
        headers: cors,
      });
    },
  );
});

When(
  "I write {string} in a new comment and press Mod+Enter",
  async ({ page }, text: string) => {
    await commentsRegion(page)
      .getByRole("button", { name: "Leave a comment…" })
      .click();
    const editor = commentsRegion(page).getByRole("textbox", {
      name: "New comment",
    });
    await editor.fill(text);
    await page.keyboard.press("ControlOrMeta+Enter");
  },
);

Then(
  "my new comment {string} shows last in the thread",
  async ({ page }, text: string) => {
    const articles = commentsRegion(page).getByRole("article");
    await expect(articles.last()).toContainText(text);
    await expect(articles.last()).toContainText("You");
    await expect(
      commentsRegion(page).getByRole("button", { name: "Leave a comment…" }),
    ).toBeVisible();
  },
);

Then(
  "the comment is not sent and the editor keeps {string}",
  async ({ page }, text: string) => {
    await expect(commentsRegion(page).getByRole("alert")).toContainText(
      "Not sent. Azure DevOps request failed (403): no access",
    );
    await expect(
      commentsRegion(page).getByRole("textbox", { name: "New comment" }),
    ).toHaveText(text);
  },
);

Then(
  "after a reload the comment field shows the draft {string}",
  async ({ page }, text: string) => {
    await page.reload();
    await expect(
      commentsRegion(page).getByRole("button", { name: `Draft: ${text}` }),
    ).toBeVisible();
  },
);
