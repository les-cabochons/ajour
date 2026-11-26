import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { pullRequestFacts } from "../../fixtures/pull-requests";

/*
 * Deck's stacks (#788): the requested pull request (#1) is the middle layer
 * of main ← #3 ← #1 ← #4, based on an older head of #3. The stack is added
 * to the local list the Background seeds.
 */

const { Given, When, Then } = createBdd();

Given(
  "the requested pull request is the middle layer of a stack",
  async ({ page }) => {
    await page.addInitScript((base) => {
      if (sessionStorage.getItem("stack-fixture-installed")) return;
      sessionStorage.setItem("stack-fixture-installed", "yes");
      const key = "ajour.local-state.v2";
      const state = JSON.parse(localStorage.getItem(key) ?? "{}");
      const now = Date.now();
      const layer = (
        id: string,
        number: number,
        title: string,
        headRef: string,
        baseRef: string,
        baseSha: string,
      ) => ({
        _id: id,
        pluginId: "github",
        pluginName: "GitHub",
        connectionId: "work",
        connectionLabel: "Work",
        viewerLogin: "alex",
        facts: {
          ...base,
          id: `pr${number}`,
          number,
          url: `https://github.com/acme/api/pull/${number}`,
          title,
          headSha: `head-${number}`,
          headRef,
          baseRef,
          baseSha,
          createdAt: now - 3 * 3600000,
          updatedAt: now - 5000,
          lastPushedAt: now - 5000,
        },
        status: "active",
        activeAt: now - 3 * 3600000,
        reason: "review-requested",
        missingFromSync: false,
      });
      state.pullRequests = [
        ...state.pullRequests.map(
          (entry: { _id: string; facts: Record<string, unknown> }) =>
            entry._id === "requested"
              ? {
                  ...entry,
                  facts: {
                    ...entry.facts,
                    headRef: "rate-limits-per-route",
                    baseRef: "rate-limits",
                    baseSha: "an-older-head",
                  },
                }
              : entry,
        ),
        layer("stack-bottom", 3, "Add rate limits", "rate-limits", "main", "m"),
        layer(
          "stack-top",
          4,
          "Rate limits per user",
          "rate-limits-per-user",
          "rate-limits-per-route",
          base.headSha,
        ),
      ];
      localStorage.setItem(key, JSON.stringify(state));
    }, pullRequestFacts);
  },
);

Then(
  "the stack's layers show together, each with its place",
  async ({ page }) => {
    const active = page.getByRole("region", { name: "Active", exact: true });
    const labels = await active
      .getByRole("link")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
    const bottom = labels.indexOf("Open Add rate limits");
    expect(labels.slice(bottom, bottom + 3)).toEqual([
      "Open Add rate limits",
      "Open Fix request handling",
      "Open Rate limits per user",
    ]);
    await expect(
      active.getByRole("link", { name: "Open Fix request handling" }),
    ).toContainText("acme/api #1 · Stack 2/3");
  },
);

const strip = (page: Parameters<Parameters<typeof Then>[1]>[0]["page"]) =>
  page.getByRole("navigation", { name: "Stack" });

Then("the stack strip reads {string}", async ({ page }, text: string) => {
  await expect(strip(page)).toContainText(text);
  await page.screenshot({ path: "test-results/deck-stack-strip.png" });
});

Then(
  "the strip warns that #3 changed since this layer was based on it",
  async ({ page }) => {
    await expect(
      strip(page).getByText("#3 changed since this layer was based on it."),
    ).toBeVisible();
  },
);

Then("the status line says it merges after #3", async ({ page }) => {
  await expect(page.getByText("Merges after #3")).toBeVisible();
});

Then("the full stack lists its layers in merge order", async ({ page }) => {
  const stack = page.getByRole("dialog", { name: "Stack" });
  await expect(stack.getByRole("listitem")).toHaveCount(3);
  await expect(stack.getByRole("listitem").nth(0)).toContainText(
    "#3Add rate limits",
  );
  await expect(stack.getByRole("listitem").nth(1)).toContainText("This layer");
  await expect(stack.getByRole("listitem").nth(2)).toContainText(
    "#4Rate limits per user",
  );
  await expect(
    stack.getByText("Merges into main, bottom first."),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/deck-full-stack.png" });
});

When("I open #4 from the full stack", async ({ page }) => {
  await page
    .getByRole("dialog", { name: "Stack" })
    .getByRole("link", { name: /#4/ })
    .click();
});

Then("the review page of {string} shows", async ({ page }, title: string) => {
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(strip(page)).toContainText("#4 this");
});

Then(
  // A slash is an alternative in a Cucumber expression: escaped, it's text.
  "the stack strip folds to Stack 2\\/3 and the page fits the viewport",
  async ({ page }) => {
    await expect(
      strip(page).getByRole("button", { name: "Stack 2/3" }),
    ).toBeVisible();
    await expect(strip(page)).not.toContainText("main ←");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/deck-stack-narrow.png" });
  },
);

When("I unfold the stack strip", async ({ page }) => {
  await strip(page).getByRole("button", { name: "Stack 2/3" }).click();
});
