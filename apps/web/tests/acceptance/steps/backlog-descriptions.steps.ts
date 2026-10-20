import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { BacklogDescriptionCapability } from "@ajour/shared";
import {
  descriptionOverview,
  syncWithParentDescription,
} from "../../fixtures/backlog-descriptions";

const { Given, When, Then } = createBdd();

const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };

async function syncParentDescription(
  page: Page,
  capability: BacklogDescriptionCapability,
  description: { text: string; cut?: boolean },
) {
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    route.fulfill({ json: descriptionOverview(capability), headers: cors }),
  );
  await page.route(
    `${apiUrl}/api/plugins/example/connections/fixture/sync`,
    (route) =>
      route.fulfill({
        json: syncWithParentDescription(description),
        headers: cors,
      }),
  );
}

Given(
  "its plugin, which does not write descriptions, sends the description {string} on its next sync",
  async ({ page }, text: string) => {
    await syncParentDescription(page, {}, { text });
  },
);

Given(
  "its plugin, which writes descriptions, sends a description cut to {string} on its next sync",
  async ({ page }, text: string) => {
    await syncParentDescription(page, { write: true }, { text, cut: true });
  },
);

Then("its description reads {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then(
  "the description is read-only because the source keeps it, with Edit in source",
  async ({ page }) => {
    await expect(
      page.getByText("Synced from the source, which keeps this description."),
    ).toBeVisible();
    await expectReadOnlyWithEditInSource(page);
  },
);

Then(
  "the description is read-only because it is cut, with Edit in source",
  async ({ page }) => {
    await expect(
      page.getByText("Longer than Ajour keeps, so it shows cut off."),
    ).toBeVisible();
    await expectReadOnlyWithEditInSource(page);
  },
);

async function expectReadOnlyWithEditInSource(page: Page) {
  const editInSource = page.getByRole("link", { name: "Edit in source" });
  await expect(editInSource).toHaveAttribute(
    "href",
    "https://example.test/items/42",
  );
  // No Edit button beside the Description heading.
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
}

async function seedParentDescription(
  page: Page,
  description: string,
  descriptionSync: Record<string, unknown>,
) {
  await page.evaluate(
    ({ description, descriptionSync }) => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      const parent = state.workItems.find(
        (item: { _id: string }) => item._id === "parent",
      );
      Object.assign(parent, {
        description,
        descriptionSync,
        sourceUrl: "https://example.test/items/42",
      });
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    },
    { description, descriptionSync },
  );
}

Given(
  "its description was edited here to {string} since its last sync of {string}",
  async ({ page }, local: string, synced: string) => {
    await seedParentDescription(page, local, {
      baseline: synced,
      remote: synced,
    });
  },
);

Given(
  "its plugin, which writes descriptions, sends the description {string} on its next sync",
  async ({ page }, text: string) => {
    await syncParentDescription(page, { write: true }, { text });
  },
);

Given(
  "its description is in conflict between {string} here and {string} in the source",
  async ({ page }, local: string, remote: string) => {
    await seedParentDescription(page, local, {
      baseline: "Original",
      remote,
      conflict: { detectedAt: 1, localText: local, remoteText: remote },
    });
  },
);

When("I choose Resolve in the toast", async ({ page }) => {
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
});

const conflictSection = (page: Page) =>
  page.getByRole("region", { name: "Description conflict on Backlog parent" });

Then(
  "Sync review shows the parent's conflict highlighted, with {string} here and {string} in the source",
  async ({ page }, local: string, remote: string) => {
    await expect(page).toHaveURL(/\/settings\/sync-review\?item=parent/);
    const section = conflictSection(page);
    await expect(section).toHaveAttribute("data-highlighted", "");
    await expect(section.getByText(local, { exact: true })).toBeVisible();
    await expect(section.getByText(remote, { exact: true })).toBeVisible();
  },
);

When("I take the source's description", async ({ page }) => {
  await conflictSection(page)
    .getByRole("button", { name: "Take source", exact: true })
    .click();
});

Then(
  "the parent's description is {string} and its conflict is gone",
  async ({ page }, text: string) => {
    await expect(conflictSection(page)).toHaveCount(0);
    const description = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((item: { _id: string }) => item._id === "parent")
          .description,
    );
    expect(description).toBe(text);
    await expect(
      page.getByRole("button", {
        name: "Resolve the sync conflict on Backlog parent",
      }),
    ).toHaveCount(0);
  },
);

const conflictMark = (scope: ReturnType<Page["locator"]>) =>
  scope.getByRole("button", {
    name: "Resolve the sync conflict on Backlog parent",
  });

When(
  "I follow the conflict mark on the parent's sidebar row",
  async ({ page }) => {
    await conflictMark(
      page
        .getByRole("navigation", { name: "Primary navigation" })
        .locator('[data-backlog-item-id="parent"]'),
    ).click();
  },
);

When(
  "I follow the conflict mark on the parent's backlog row",
  async ({ page }) => {
    await page.goto("/backlog");
    await conflictMark(
      page.locator(".backlog-list-row", { hasText: "Backlog parent" }).first(),
    ).click();
  },
);

When(
  "I follow the conflict mark beside the parent's description",
  async ({ page }) => {
    await page.goto("/backlog/parent");
    await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
    await conflictMark(page.locator("main")).click();
  },
);

Then("Sync review opens on the parent's conflict", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings\/sync-review\?item=parent/);
  // Found by the item, whose title the scenario may have changed.
  await expect(
    page.locator('section[data-sync-issue-item="parent"]'),
  ).toHaveAttribute("data-highlighted", "");
});

Given(
  "the parent is snoozed with its remaining estimate in conflict",
  async ({ page }) => {
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      const parent = state.workItems.find(
        (item: { _id: string }) => item._id === "parent",
      );
      Object.assign(parent, {
        snoozedUntil: Date.now() + 86_400_000,
        estimateSync: {
          remainingEstimateHours: {
            baselineValue: 2,
            remoteValue: 5,
            conflict: {
              detectedAt: 1,
              localValue: 3,
              remoteValue: 5,
              baselineValue: 2,
            },
          },
        },
      });
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    });
  },
);

When(
  "I follow the conflict mark on the parent's snoozed sidebar row",
  async ({ page }) => {
    const sidebar = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    await sidebar.getByRole("button", { name: /^Snoozed/ }).click();
    await conflictMark(
      sidebar.locator('[data-backlog-item-id="parent"]'),
    ).click();
  },
);

When(
  "I follow the conflict mark beside the parent's remaining estimate",
  async ({ page }) => {
    await page.goto("/backlog/parent");
    await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
    await conflictMark(page.locator("main")).click();
  },
);

Then(
  "Sync review opens on the parent's estimate conflict",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\/sync-review\?item=parent/);
    await expect(
      page.locator('[data-sync-issue-item="parent"]').getByText("Remaining"),
    ).toBeVisible();
  },
);

Given(
  "its description is in conflict with {string} in the source, and was edited here since to {string}",
  async ({ page }, remote: string, local: string) => {
    await seedParentDescription(page, local, {
      baseline: "Original",
      remote,
      conflict: {
        detectedAt: 1,
        localText: "My first notes",
        remoteText: remote,
      },
    });
  },
);

When("I open Sync review on the parent", async ({ page }) => {
  await page.goto("/settings/sync-review?item=parent");
});

Then(
  "Sync review shows {string} here, not the text from when the conflict began",
  async ({ page }, local: string) => {
    const section = conflictSection(page);
    await expect(section.getByText(local, { exact: true })).toBeVisible();
    await expect(section.getByText("My first notes")).toHaveCount(0);
  },
);

When(
  "I rename the parent to {string} in the side panel without saving",
  async ({ page }, title: string) => {
    await page
      .getByRole("complementary", { name: "Backlog item editor" })
      .getByRole("textbox", { name: "Item", exact: true })
      .fill(title);
  },
);

Then(
  "the parent's title is {string}, saved on the way",
  async ({ page }, title: string) => {
    const saved = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((item: { _id: string }) => item._id === "parent")
          .title,
    );
    expect(saved).toBe(title);
  },
);

/** A source that holds a description, and answers reads and writes of it. */
interface DescriptionSource {
  /** The text the sync brings. */
  synced: string;
  /** The text the source holds now. */
  text: string;
  /** Why it refuses writes, when it does. */
  refusal?: string;
}

const sources = new WeakMap<Page, DescriptionSource>();
const lines = (text: string) => text.replaceAll("\\n", "\n");

async function stubDescriptionSource(page: Page, source: DescriptionSource) {
  sources.set(page, source);
  const connection = `${apiUrl}/api/plugins/example/connections/fixture`;
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    route.fulfill({
      json: descriptionOverview({ write: true }),
      headers: cors,
    }),
  );
  await page.route(`${connection}/sync`, (route) =>
    route.fulfill({
      json: syncWithParentDescription({ text: source.synced }),
      headers: cors,
    }),
  );
  await page.route(`${connection}/description`, (route) =>
    route.fulfill({
      json: { description: { text: source.text } },
      headers: cors,
    }),
  );
  await page.route(`${connection}/description-write`, (route) => {
    if (source.refusal) {
      return route.fulfill({
        status: 502,
        json: { error: source.refusal },
        headers: cors,
      });
    }
    const request = route.request().postDataJSON() as {
      text: string;
      expected: string;
    };
    if (request.expected !== source.text) {
      return route.fulfill({
        json: { outcome: "conflict", description: { text: source.text } },
        headers: cors,
      });
    }
    source.text = request.text;
    return route.fulfill({
      json: { outcome: "written", description: { text: source.text } },
      headers: cors,
    });
  });
}

Given(
  "its description {string} is synced through a plugin that writes descriptions",
  async ({ page }, text: string) => {
    const synced = lines(text);
    await seedParentDescription(page, synced, {
      baseline: synced,
      remote: synced,
    });
    await stubDescriptionSource(page, { synced, text: synced });
  },
);

Given(
  "its description is in conflict between {string} here and {string} in a source that writes descriptions",
  async ({ page }, local: string, remote: string) => {
    await seedParentDescription(page, local, {
      baseline: "Original",
      remote,
      conflict: { detectedAt: 1, localText: local, remoteText: remote },
    });
    await stubDescriptionSource(page, { synced: remote, text: remote });
  },
);

Given(
  "someone changes it in the source to {string} after the sync",
  async ({ page }, text: string) => {
    sources.get(page)!.text = lines(text);
  },
);

Given(
  "the source refuses description writes with {string}",
  async ({ page }, refusal: string) => {
    sources.get(page)!.refusal = refusal;
  },
);

const descriptionEditor = (page: Page) =>
  page.getByRole("textbox", { name: "Description", exact: true });

When("I start editing the description", async ({ page }) => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(descriptionEditor(page)).toBeFocused();
});

When("I change the description to {string}", async ({ page }, text: string) => {
  await descriptionEditor(page).fill(lines(text));
});

When("I save the description", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(descriptionEditor(page)).toHaveCount(0);
});

Then(
  "the editor warns that the description changed in the source, with Load latest",
  async ({ page }) => {
    await expect(
      page.getByText("Changed in Work since the last sync.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Load latest", exact: true }),
    ).toBeVisible();
  },
);

When("I load the latest description", async ({ page }) => {
  await page.getByRole("button", { name: "Load latest", exact: true }).click();
});

Then(
  "the description editor holds {string}, and the warning is gone",
  async ({ page }, text: string) => {
    await expect(descriptionEditor(page)).toHaveText(lines(text));
    await expect(descriptionEditor(page)).toBeFocused();
    await expect(page.getByText(/^Changed in Work since/)).toHaveCount(0);
  },
);

Then("the editor says saving will merge the changes", async ({ page }) => {
  await expect(
    page.getByText(
      "Changed in Work since the last sync. Saving will merge the changes.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load latest", exact: true }),
  ).toHaveCount(0);
});

const parentDescription = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "parent",
      ).description as string | undefined,
  );

Then(
  "the source and the parent both hold {string}",
  async ({ page }, text: string) => {
    await expect.poll(() => sources.get(page)!.text).toBe(lines(text));
    await expect.poll(() => parentDescription(page)).toBe(lines(text));
  },
);

Then(
  "the source still holds {string}, and the parent {string}",
  async ({ page }, remote: string, local: string) => {
    await expect.poll(() => parentDescription(page)).toBe(lines(local));
    expect(sources.get(page)!.text).toBe(lines(remote));
  },
);

Then(
  "the description says it changed in the source too, with Resolve",
  async ({ page }) => {
    await expect(
      page.getByText("Changed in Work too, in the same lines.", {
        exact: true,
      }),
    ).toBeVisible();
  },
);

When("I choose Resolve beside the description", async ({ page }) => {
  await page
    .locator("main")
    .getByRole("button", { name: "Resolve", exact: true })
    .click();
});

Then(
  "the description says it is not saved to the source because {string}, with Retry",
  async ({ page }, reason: string) => {
    await expect(
      page.getByText(`Not saved to Work: ${reason}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("main").getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
  },
);

When("I keep my description", async ({ page }) => {
  await conflictSection(page)
    .getByRole("button", { name: "Keep mine", exact: true })
    .click();
});
