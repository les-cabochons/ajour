import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * The rest of a review round (#785): a reply and a resolve on a thread, a
 * suggested change from the composer, and a file marked viewed on the code
 * host. The local API is mocked; the diff library is the real one.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const connection = `${apiUrl}/api/code-hosts/github/connections/work`;
const cors = { "access-control-allow-origin": "*" };

/** What the code host was sent, per test, by operation. */
let sent: Record<string, unknown[]> = {};

const changes = (page: Page) => page.getByRole("region", { name: "Changes" });
const thread = (page: Page) =>
  changes(page).getByRole("article", {
    name: "Thread on src/client/retry.ts, line 13",
  });

Given(
  "the code host has a thread on line 13 and takes replies, resolves and viewed files",
  async ({ page }) => {
    sent = {};
    let resolved = false;
    const replies: string[] = [];
    await page.route(`${connection}/getPullRequestConversation`, (route) =>
      route.fulfill({
        headers: cors,
        json: {
          description: "",
          timeline: [],
          threads: [
            {
              id: "thread-1",
              path: "src/client/retry.ts",
              side: "head",
              line: 13,
              resolved,
              outdated: false,
              comments: [
                {
                  id: "comment-1",
                  author: { login: "sam", displayName: "Sam", isBot: false },
                  body: "Should this have a ceiling?",
                  createdAt: Date.parse("2026-11-25T10:00:00Z"),
                },
                ...replies.map((body, index) => ({
                  id: `reply-${index + 1}`,
                  author: { login: "alex", isBot: false },
                  body,
                  createdAt: Date.parse("2026-11-26T10:00:00Z"),
                })),
              ],
            },
          ],
          viewedPaths: [],
          mergeMethods: ["squash"],
        },
      }),
    );
    for (const operation of [
      "replyToThread",
      "setThreadResolved",
      "setFileViewed",
      "postComment",
    ])
      await page.route(`${connection}/${operation}`, async (route) => {
        const request = route.request().postDataJSON();
        (sent[operation] ??= []).push(request);
        if (operation === "replyToThread") replies.push(request.body);
        if (operation === "setThreadResolved") resolved = request.resolved;
        await route.fulfill({
          headers: cors,
          json:
            operation === "setThreadResolved"
              ? { resolved: request.resolved }
              : operation === "setFileViewed"
                ? { viewed: request.viewed }
                : { commentId: `${operation}-1` },
        });
      });
  },
);

When("I reply {string} to the thread", async ({ page }, body: string) => {
  await thread(page).getByRole("button", { name: "Reply" }).click();
  const field = thread(page).getByRole("textbox", { name: "Reply" });
  await expect(field).toBeFocused();
  await field.fill(body);
  await thread(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/deck-reply.png" });
  await page.keyboard.press("Control+Enter");
});

Then(
  "the reply {string} shows in the thread",
  async ({ page }, body: string) => {
    await expect(thread(page).getByText(body)).toBeVisible();
    await expect(
      thread(page).getByRole("textbox", { name: "Reply" }),
    ).toHaveCount(0);
    expect(sent.replyToThread).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        body,
        submissionId: expect.stringMatching(/^reply_submission_/),
      }),
    ]);
  },
);

When("I resolve the thread", async ({ page }) => {
  await thread(page).getByRole("button", { name: "Resolve" }).click();
});

Then("the thread reads Resolved, with Unresolve", async ({ page }) => {
  await expect(thread(page).getByText("Resolved")).toBeVisible();
  await expect(
    thread(page).getByRole("button", { name: "Unresolve" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/deck-resolved.png" });
  expect(sent.setThreadResolved).toEqual([
    expect.objectContaining({ threadId: "thread-1", resolved: true }),
  ]);
});

When(
  "I suggest a change on the line that reads {string}",
  async ({ page }, line: string) => {
    await changes(page).getByText(line, { exact: true }).hover();
    await changes(page)
      .getByRole("button", { name: "Comment on this line" })
      .click();
    await page.getByRole("button", { name: "Suggest change" }).click();
  },
);

Then(
  "the comment holds a suggestion block of {string}",
  async ({ page }, line: string) => {
    const field = page.getByRole("textbox", { name: "Comment" });
    await expect(field).toHaveValue(`\`\`\`suggestion\n${line}\n\`\`\``);
    await expect(field).toBeFocused();
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/deck-suggestion.png" });
  },
);

When("I mark the file {string} viewed", async ({ page }, path: string) => {
  await changes(page)
    .getByRole("button", { name: `Viewed file: ${path}` })
    .click();
});

Then(
  "the code host marks {string} viewed at the head read",
  async ({ page }, path: string) => {
    await expect(
      changes(page).getByRole("button", { name: `Viewed file: ${path}` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => sent.setFileViewed?.length ?? 0).toBe(1);
    expect(sent.setFileViewed).toEqual([
      expect.objectContaining({ path, viewed: true }),
    ]);
    await page.screenshot({ path: "test-results/deck-file-viewed.png" });
  },
);
