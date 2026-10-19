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

Then(
  "my comment controls show hover and pressed feedback in the {string} theme",
  async ({ page }, theme: string) => {
    if (theme !== "light" && theme !== "dark")
      throw new Error(`Unknown theme: ${theme}`);
    await page.evaluate(async (themeMode) => {
      const { localStore } = await import("/src/lib/local-store.ts");
      localStore.setUserPreferences({ themeMode });
    }, theme);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    for (const { label, menuItem } of [
      { label: "Add a reaction", menuItem: "Heart" },
      { label: "Comment actions", menuItem: "Edit" },
    ]) {
      const control = myComment(page).getByRole("button", { name: label });
      await page.mouse.move(0, 0);
      const background = await control.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await control.hover();
      const hovered = await control.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(hovered).not.toBe(background);
      // Absence needs an observation window for a tooltip that mounts after hover.
      await page.waitForTimeout(300);
      await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(
        0,
      );
      await expect(control).not.toHaveAttribute("title");
      await page.mouse.down();
      const pressed = await control.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await page.mouse.up();
      expect(pressed).not.toBe(hovered);
      await expect(page.getByRole("menu")).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(control).toHaveCSS("background-color", pressed);
      // Closing the menu while holding the mouse isolates :active from aria-expanded.
      await control.hover();
      await page.mouse.down();
      try {
        await expect(control).toHaveAttribute("aria-expanded", "false");
        await expect(control).toHaveCSS("background-color", pressed);
      } finally {
        await page.mouse.up();
      }
      await page.mouse.move(0, 0);
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      expect(
        await control.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await expect(control).not.toHaveCSS("box-shadow", "none");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(
        page.getByRole("menuitem", {
          name: menuItem,
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
  },
);

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

/** The fixture's people whose name has a word starting with each word of the query. */
function findPeople(query: string) {
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [
    { id: "ana", displayName: "Ana Silva" },
    { id: "andrew", displayName: "Andrew Lee" },
  ].filter((person) => {
    const words = person.displayName.toLowerCase().split(" ");
    return parts.every((part) => words.some((word) => word.startsWith(part)));
  });
}

Given(
  "its plugin finds people and records posted comments",
  async ({ page }) => {
    const base = `${apiUrl}/api/backlog-comments/example/connections/fixture`;
    await page.route(`${base}/searchItemPeople`, async (route) => {
      const { query } = route.request().postDataJSON() as { query: string };
      await route.fulfill({
        json: { people: findPeople(query) },
        headers: cors,
      });
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

const peopleSearchUrl = `${apiUrl}/api/backlog-comments/example/connections/fixture/searchItemPeople`;

Given("its plugin fails to search people", async ({ page }) => {
  await page.route(peopleSearchUrl, (route) =>
    route.fulfill({
      status: 502,
      json: { error: "Azure DevOps request failed (401): people search" },
      headers: cors,
    }),
  );
});

Given("its plugin finds no one, slowly", async ({ page }) => {
  await page.route(peopleSearchUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({ json: { people: [] }, headers: cors });
  });
});

Given("its plugin finds people, slowly", async ({ page }) => {
  await page.route(peopleSearchUrl, async (route) => {
    const { query } = route.request().postDataJSON() as { query: string };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({ json: { people: findPeople(query) }, headers: cors });
  });
});

When(
  "the people search works again and I ask for suggestions",
  async ({ page }) => {
    await page.unroute(peopleSearchUrl);
    await page.route(peopleSearchUrl, (route) =>
      route.fulfill({
        json: { people: [{ id: "ana", displayName: "Ana Silva" }] },
        headers: cors,
      }),
    );
    await page.keyboard.press("Control+Space");
  },
);

Then("Ana is suggested and no status shows", async ({ page }) => {
  await expect(page.getByRole("option", { name: "Ana Silva" })).toBeVisible();
  await expect(mentionStatus(page)).toHaveCount(0);
});

When(
  "I keep typing {string} before the search answers",
  async ({ page }, text: string) => {
    const answered = page.waitForResponse(peopleSearchUrl);
    await page.waitForRequest(peopleSearchUrl);
    await page.keyboard.type(text);
    await answered;
  },
);

Then(
  "the mention suggestions are closed once the search answers",
  async ({ page }) => {
    // Give the late answer time to reach the editor.
    await page.waitForTimeout(200);
    await expect(mentionStatus(page)).toHaveCount(0);
  },
);

When("I type {string} in a new comment", async ({ page }, text: string) => {
  await commentsRegion(page)
    .getByRole("button", { name: "Leave a comment…" })
    .click();
  // The editor loads on first use; type once it has the focus.
  await expect(
    commentsRegion(page).getByRole("textbox", { name: "New comment" }),
  ).toBeFocused();
  await page.keyboard.type(text);
});

When("I keep typing {string}", async ({ page }, text: string) => {
  await page.keyboard.type(text);
});

When(
  "I move back {int} characters and ask for suggestions",
  async ({ page }, count: number) => {
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.press("Control+Space");
  },
);

When("I move forward {int} characters", async ({ page }, count: number) => {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
});

/** People searches each page has sent, to tell whether Escape stopped them. */
const peopleSearches = new WeakMap<Page, { count: number; atEscape: number }>();

When("I press Escape in the new comment", async ({ page }) => {
  let searches = peopleSearches.get(page);
  if (!searches) {
    const counter = { count: 0, atEscape: 0 };
    page.on("request", (request) => {
      if (request.url() === peopleSearchUrl && request.method() === "POST") {
        counter.count += 1;
      }
    });
    peopleSearches.set(page, counter);
    searches = counter;
  }
  await page.keyboard.press("Escape");
  searches.atEscape = searches.count;
});

When(
  "I press Escape in the new comment while the search runs",
  async ({ page }) => {
    const answered = page.waitForResponse(peopleSearchUrl);
    await page.waitForRequest(peopleSearchUrl);
    await page.keyboard.press("Escape");
    await answered;
    // Give the late answer time to reach the editor.
    await page.waitForTimeout(200);
  },
);

Then(
  "nothing is suggested and the new comment stays open with {string}",
  async ({ page }, text: string) => {
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(mentionStatus(page)).toHaveCount(0);
    const editor = commentsRegion(page).getByRole("textbox", {
      name: "New comment",
    });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(text);
  },
);

Then("no people search ran since Escape", async ({ page }) => {
  // Longer than the search's 200ms pause, so one would have started.
  await page.waitForTimeout(600);
  const searches = peopleSearches.get(page)!;
  expect(searches.count).toBe(searches.atEscape);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(mentionStatus(page)).toHaveCount(0);
});

Then(
  "the new comment is closed, keeping the draft {string}",
  async ({ page }, text: string) => {
    await expect(
      commentsRegion(page).getByRole("textbox", { name: "New comment" }),
    ).toHaveCount(0);
    await expect(
      commentsRegion(page).getByRole("button", { name: `Draft: ${text}` }),
    ).toBeVisible();
  },
);

When("I pick Ana from the suggestions", async ({ page }) => {
  await page.getByRole("option", { name: "Ana Silva" }).click();
});

Then("the new comment mentions Ana as a chip", async ({ page }) => {
  const editor = commentsRegion(page).getByRole("textbox", {
    name: "New comment",
  });
  await expect(editor.locator(".cm-mention")).toHaveText("@Ana Silva");
});

When(
  "I keep typing {string} until the search for {string} answers",
  async ({ page }, text: string, query: string) => {
    const answered = page.waitForResponse(
      (response) =>
        response.url() === peopleSearchUrl &&
        (response.request().postDataJSON() as { query: string }).query ===
          query,
    );
    await page.keyboard.type(text);
    await answered;
  },
);

Then("nothing is suggested and no status shows", async ({ page }) => {
  // Give the answer time to reach the editor.
  await page.waitForTimeout(200);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(mentionStatus(page)).toHaveCount(0);
});

const mentionStatus = (page: Page) =>
  commentsRegion(page).locator(".cm-mention-status");

Then("the mention suggestions ask for a name", async ({ page }) => {
  await expect(mentionStatus(page)).toHaveText(
    "Type a name to mention someone",
  );
});

Then("the mention suggestions say no one was found", async ({ page }) => {
  await expect(mentionStatus(page)).toHaveText("No one found");
  await expect(page.getByRole("option")).toHaveCount(0);
});

Then("the mention suggestions are closed", async ({ page }) => {
  await expect(mentionStatus(page)).toHaveCount(0);
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

When("I unsettle it from its page header", async ({ page }) => {
  await page
    .locator(".ajour-page-header-slot")
    .getByRole("button", { name: "Unsettle", exact: true })
    .click();
});

Then(
  "no comment went to the source and the comment field shows the draft {string}",
  async ({ page }, text: string) => {
    await expect(
      commentsRegion(page).getByRole("button", { name: `Draft: ${text}` }),
    ).toBeVisible();
    const writes = JSON.parse(
      (await page.evaluate(() => sessionStorage.getItem("source-writes"))) ??
        "[]",
    ) as string[];
    expect(writes.filter((write) => write.startsWith("comment:"))).toEqual([]);
  },
);
