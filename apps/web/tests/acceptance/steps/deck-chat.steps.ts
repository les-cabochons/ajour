import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * Deck's chat (#796): A opens it docked beside the review, Continue in
 * chat on an explanation carries its lines in as a chip, and a message
 * goes to the local API with them. In the narrow view it is a full-height
 * sheet. The local API is mocked: a message starts a turn that never
 * streams here, since the page tests follow a reply's events.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };

/** What the page sent to the chat, per test. */
let sent: unknown[] = [];

const chat = (page: Page) => page.getByRole("complementary", { name: "Chat" });

Given("the chat answers with Claude Code", async ({ page }) => {
  sent = [];
  await page.route(`${apiUrl}/api/agents`, (route) =>
    route.fulfill({
      json: {
        settings: { cli: "claude-code", browserMode: "my-chrome", model: "" },
        clis: [
          {
            id: "claude-code",
            label: "Claude Code",
            supported: true,
            installed: true,
          },
        ],
        tasks: [],
        currentRun: null,
      },
      headers: cors,
    }),
  );
  await page.route(`${apiUrl}/api/deck/clones`, (route) =>
    route.fulfill({ json: { clones: [] }, headers: cors }),
  );
  await page.route(
    `${apiUrl}/api/deck/github/connections/work/chat`,
    async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        json: {
          turn: {
            id: "turn-chat-1",
            conversationId: "c1",
            task: "deck.chat",
            pullRequest: "key",
            head: "head",
            state: "running",
          },
        },
        headers: cors,
      });
    },
  );
});

When("I open the chat", async ({ page }) => {
  await page.getByRole("button", { name: "Chat", exact: true }).click();
});

When("I close the chat", async ({ page }) => {
  await chat(page).getByRole("button", { name: "Close chat" }).click();
  await expect(chat(page)).toHaveCount(0);
});

Then(
  "the chat is docked on the right, 360px wide, beside the review",
  async ({ page }) => {
    const panel = chat(page);
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.round(box.width)).toBe(360);
    expect(Math.round(box.x + box.width)).toBe(viewport.width);
    const title = (await page
      .getByRole("heading", { level: 1, name: "Fix request handling" })
      .boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(box.x);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: "test-results/deck-chat.png" });
  },
);

Then("the chat's header reads {string}", async ({ page }, header: string) => {
  await expect(chat(page).getByText(header, { exact: true })).toBeVisible();
});

When("I continue the explanation in the chat", async ({ page }) => {
  await page
    .getByRole("region", { name: "Changes" })
    .getByRole("button", { name: "Continue in chat" })
    .click();
});

Then(
  "the chat's composer carries the chip {string}",
  async ({ page }, label: string) => {
    await expect(
      chat(page).getByRole("button", { name: `Remove ${label}` }),
    ).toBeVisible();
    await expect(
      chat(page).getByRole("textbox", { name: "Message" }),
    ).toBeFocused();
  },
);

When("I send {string} in the chat", async ({ page }, message: string) => {
  const field = chat(page).getByRole("textbox", { name: "Message" });
  await field.fill(message);
  await field.press("Enter");
  await expect(
    chat(page).getByRole("log", { name: "Messages" }).getByText(message),
  ).toBeVisible();
});

Then(
  "the chat sends {string} about lines {int} to {int}",
  async ({}, message: string, from: number, to: number) => {
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
      message,
      anchor: {
        kind: "lines",
        path: "src/client/retry.ts",
        start: { line: from },
        end: { line: to },
      },
    });
  },
);

Then("the chat covers the narrow viewport", async ({ page }) => {
  const sheet = page.getByRole("dialog", { name: "Chat" });
  await expect(sheet).toBeVisible();
  // Once it has slid in.
  await expect
    .poll(() => sheet.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1");
  await expect(sheet).not.toHaveAttribute("data-starting-style");
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);
  await expect(sheet.getByText("#1 · Claude Code · PR")).toBeVisible();
  await page.screenshot({ path: "test-results/deck-chat-narrow.png" });
});
