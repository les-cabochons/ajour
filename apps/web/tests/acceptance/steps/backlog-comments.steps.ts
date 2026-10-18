import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  autoSyncOverview,
  commentsOverview,
  commentsSeenAt,
  fixtureCommentPage,
  parentSettledAt,
  settleCommentsOverview,
  syncWithAnaComment,
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

Given("its plugin accepts comment changes", async ({ page }) => {
  const base = `${apiUrl}/api/backlog-comments/example/connections/fixture`;
  await page.route(`${base}/editItemComment`, async (route) => {
    const request = route.request().postDataJSON() as {
      commentId: string;
      body: string;
    };
    await route.fulfill({
      json: {
        comment: {
          id: request.commentId,
          author: { id: "me", displayName: "Alex" },
          body: request.body,
          createdAt: "2026-10-16T09:00:00Z",
          updatedAt: new Date().toISOString(),
        },
      },
      headers: cors,
    });
  });
  await page.route(`${base}/deleteItemComment`, async (route) => {
    await page.evaluate(() => {
      const count = Number(sessionStorage.getItem("comment-deletes") ?? "0");
      sessionStorage.setItem("comment-deletes", String(count + 1));
    });
    await route.fulfill({ json: {}, headers: cors });
  });
  await page.route(`${base}/setItemCommentReaction`, async (route) => {
    const request = route.request().postDataJSON() as {
      commentId: string;
      reaction: string;
      reacted: boolean;
    };
    const reactions =
      request.commentId === "c6"
        ? [
            { reaction: "like", count: 2, viewerReacted: true },
            ...(request.reacted
              ? [{ reaction: request.reaction, count: 1, viewerReacted: true }]
              : []),
          ]
        : [];
    await route.fulfill({ json: { reactions }, headers: cors });
  });
});

const myComment = (page: Page) =>
  commentsRegion(page).getByRole("article", { name: "Your comment" });

When("I edit my comment to {string}", async ({ page }, text: string) => {
  await myComment(page)
    .getByRole("button", { name: "Comment actions" })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editor = myComment(page).getByRole("textbox", {
    name: "Edit comment",
  });
  await editor.fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
});

Then(
  "my comment reads {string} and shows it was edited",
  async ({ page }, text: string) => {
    await expect(
      myComment(page).getByRole("textbox", { name: "Edit comment" }),
    ).toHaveCount(0);
    await expect(myComment(page)).toContainText(text);
    await expect(myComment(page)).toContainText("edited");
  },
);

When("I delete my comment", async ({ page }) => {
  await myComment(page)
    .getByRole("button", { name: "Comment actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
});

Then("my comment is hidden", async ({ page }) => {
  await expect(myComment(page)).toHaveCount(0);
});

When("I undo the delete", async ({ page }) => {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
});

When("the Undo toast closes on its own", async ({ page }) => {
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0, { timeout: 15_000 });
});

Then("my comment shows again and no delete was sent", async ({ page }) => {
  await expect(myComment(page)).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("comment-deletes")),
  ).toBeNull();
});

Then("the delete was sent once", async ({ page }) => {
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("comment-deletes")))
    .toBe("1");
  await expect(myComment(page)).toHaveCount(0);
});

When("I add a Heart to Ana's reply", async ({ page }) => {
  const reply = commentsRegion(page)
    .getByRole("article", { name: "Ana Silva's comment" })
    .last();
  await reply.getByRole("button", { name: "Add a reaction" }).click();
  await page.getByRole("menuitem", { name: "Heart" }).click();
});

Then("Ana's reply shows my Heart", async ({ page }) => {
  await expect(
    commentsRegion(page).getByRole("button", {
      name: "Heart: 1, including you",
    }),
  ).toBeVisible();
});

Given(
  "its plugin finds people and records posted comments",
  async ({ page }) => {
    const base = `${apiUrl}/api/backlog-comments/example/connections/fixture`;
    await page.route(`${base}/searchItemPeople`, async (route) => {
      const { query } = route.request().postDataJSON() as { query: string };
      const people = [
        { id: "ana", displayName: "Ana Silva" },
        { id: "andrew", displayName: "Andrew Lee" },
      ].filter((person) =>
        person.displayName.toLowerCase().startsWith(query.toLowerCase()),
      );
      await route.fulfill({ json: { people }, headers: cors });
    });
    await page.route(`${base}/postItemComment`, async (route) => {
      const request = route.request().postDataJSON() as { body: string };
      await page.evaluate((body) => {
        sessionStorage.setItem("posted-comment", body);
      }, request.body);
      await route.fulfill({
        json: {
          comment: {
            id: "c9",
            author: { id: "me", displayName: "Alex" },
            body: request.body,
            createdAt: new Date().toISOString(),
          },
        },
        headers: cors,
      });
    });
  },
);

When("I mention Ana in a new comment and send it", async ({ page }) => {
  await commentsRegion(page)
    .getByRole("button", { name: "Leave a comment…" })
    .click();
  const editor = commentsRegion(page).getByRole("textbox", {
    name: "New comment",
  });
  // The editor loads on first use; type once it has the focus.
  await expect(editor).toBeFocused();
  await page.keyboard.type("Thanks @Ana");
  await page.getByRole("option", { name: "Ana Silva" }).click();
  await expect(editor.locator(".cm-mention")).toHaveText("@Ana Silva");
  await page.keyboard.type("for the review");
  await page.keyboard.press("ControlOrMeta+Enter");
});

Then(
  "the comment went out with Ana's mention, shown as a chip",
  async ({ page }) => {
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("posted-comment")))
      .toBe("Thanks [@Ana Silva](mention:ana) for the review");
    const posted = commentsRegion(page).getByRole("article").last();
    await expect(posted.getByText("@Ana Silva", { exact: true })).toBeVisible();
  },
);

Given(
  "the Backlog parent is settled and its next sync reports a comment from Ana",
  async ({ page }) => {
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      route.fulfill({ json: autoSyncOverview, headers: cors }),
    );
    await page.route(
      `${apiUrl}/api/plugins/example/connections/fixture/sync`,
      async (route) => {
        const request = route.request().postDataJSON() as {
          workItems: { localWorkItemId: string; commentsSince?: string }[];
        };
        const parent = request.workItems.find(
          (workItem) => workItem.localWorkItemId === "parent",
        );
        await page.evaluate((since) => {
          sessionStorage.setItem("comments-since", since ?? "none");
        }, parent?.commentsSince);
        await route.fulfill({ json: syncWithAnaComment, headers: cors });
      },
    );
    await page.evaluate((settledAt) => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      const parent = state.workItems.find(
        (item: { _id: string }) => item._id === "parent",
      );
      Object.assign(parent, { status: "settled", settledAt });
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    }, parentSettledAt);
  },
);

Then(
  "the sync asked for the comments since the parent was settled",
  async ({ page }) => {
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("comments-since")))
      .toBe(new Date(parentSettledAt).toISOString());
  },
);

Then("the parent has a Returned mark", async ({ page }) => {
  await expect(
    page.getByRole("button", {
      name: "Clear the returned mark on Backlog parent",
      exact: true,
    }),
  ).toBeVisible();
});

Then(
  "its page says Ana commented, and still does once the mark is cleared",
  async ({ page }) => {
    const notice = page.getByText("Ana Silva commented since you settled it");
    await expect(notice).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Clear the returned mark on Backlog parent",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(notice).toBeVisible();
  },
);

/** What the plugin wrote, in order, kept in the session to survive the route. */
async function recordWrite(page: Page, write: string) {
  await page.evaluate((entry) => {
    const writes = JSON.parse(sessionStorage.getItem("source-writes") ?? "[]");
    sessionStorage.setItem("source-writes", JSON.stringify([...writes, entry]));
  }, write);
}

Given(
  "its plugin settles items and records what it writes",
  async ({ page }) => {
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      route.fulfill({ json: settleCommentsOverview, headers: cors }),
    );
    const base = `${apiUrl}/api/plugins/example/connections/fixture`;
    await page.route(`${base}/settle-states`, (route) =>
      route.fulfill({
        json: {
          states: [
            { name: "Active", category: "In Progress", done: false },
            { name: "Waiting", category: "In Progress", done: false },
            { name: "Done", category: "Done", done: true },
          ],
        },
        headers: cors,
      }),
    );
    await page.route(`${base}/settle`, async (route) => {
      const request = route.request().postDataJSON() as { state?: string };
      await recordWrite(page, `settle:${request.state}`);
      await route.fulfill({ json: { state: request.state }, headers: cors });
    });
    await page.route(
      `${apiUrl}/api/backlog-comments/example/connections/fixture/postItemComment`,
      async (route) => {
        const request = route.request().postDataJSON() as { body: string };
        await recordWrite(page, `comment:${request.body}`);
        await route.fulfill({
          json: {
            comment: {
              id: "c20",
              author: { id: "me", displayName: "Alex" },
              body: request.body,
              createdAt: new Date().toISOString(),
            },
          },
          headers: cors,
        });
      },
    );
  },
);

When(
  "I settle it in Waiting with the comment {string}",
  async ({ page }, text: string) => {
    await page
      .locator(".ajour-page-header-slot")
      .getByRole("button", { name: "Settle", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await dialog.getByLabel("State", { exact: true }).click();
    await page.getByRole("option", { name: "Waiting", exact: true }).click();
    const editor = dialog.getByRole("textbox", { name: "Comment" });
    await editor.click();
    await expect(editor).toBeFocused();
    await page.keyboard.type(text);
    await dialog.getByRole("button", { name: "Settle", exact: true }).click();
    // The parent has an open subitem; it stays on the list.
    await page
      .getByRole("dialog", { name: /^Also settle/ })
      .getByRole("button", { name: "Only this item" })
      .click();
    await expect(dialog).toHaveCount(0);
  },
);

When("I undo the settle", async ({ page }) => {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
});

Then(
  "the source got the settle, then the comment {string}",
  async ({ page }, text: string) => {
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("source-writes")))
      .toBe(JSON.stringify(["settle:Waiting", `comment:${text}`]));
  },
);

Then(
  "nothing went to the source and the comment field shows the draft {string}",
  async ({ page }, text: string) => {
    await expect(
      commentsRegion(page).getByRole("button", { name: `Draft: ${text}` }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => sessionStorage.getItem("source-writes")),
    ).toBeNull();
  },
);
