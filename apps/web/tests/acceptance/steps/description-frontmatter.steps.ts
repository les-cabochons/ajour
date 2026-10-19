import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const ITEM_ID = "frontmatter-item";
const DESCRIPTION = [
  "---",
  "Teamwork: https://acme.teamwork.com/app/tasks/123",
  "Links:",
  "  - https://figma.com/file/hero",
  "timelog:",
  "  project: Beta Corp",
  "  task: Integration",
  "---",
  "",
  "Build the hero section from [the mockup](https://figma.com/file/hero).",
].join("\n");

/** The external addresses each page's tabs loaded, in order. */
const openedByPage = new WeakMap<Page, string[]>();

function opened(page: Page) {
  return openedByPage.get(page) ?? [];
}

function properties(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

function description(page: Page) {
  return page.locator(".backlog-item-page-columns > div").first();
}

/** The link in the property row labelled `label`. */
function propertyLink(page: Page, label: string) {
  return properties(page)
    .locator("dt", { hasText: label })
    .locator("xpath=following-sibling::dd[1]")
    .getByRole("link");
}

function linkQuestion(page: Page) {
  return page.getByRole("alertdialog", { name: "Open this link?" });
}

Given("a backlog item's description has frontmatter", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  // Links open in new tabs; record each instead of leaving the test machine.
  const loaded: string[] = [];
  openedByPage.set(page, loaded);
  await page
    .context()
    .route(/^https:\/\/(figma\.com|acme\.teamwork\.com)\//, (route) => {
      loaded.push(route.request().url());
      return route.fulfill({ body: "opened", contentType: "text/html" });
    });
  await page.addInitScript(
    ({ itemId, description }) => {
      // Seed once, so a reload keeps what the scenario changed.
      if (sessionStorage.getItem("frontmatter-fixture")) return;
      localStorage.clear();
      sessionStorage.setItem("frontmatter-fixture", "true");
      localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          projects: [],
          workItems: [
            {
              _id: itemId,
              title: "Landing page hero",
              status: "active",
              source: "manual",
              description,
              createdAt: Date.now(),
            },
          ],
        }),
      );
    },
    { itemId: ITEM_ID, description: DESCRIPTION },
  );
});

When("I open that backlog item's page", async ({ page }) => {
  await page.goto(`/backlog/${ITEM_ID}`);
  await expect(properties(page)).toBeVisible();
});

Then("the description shows only {string}", async ({ page }, text: string) => {
  await expect(description(page).getByText(text)).toBeVisible();
  await expect(description(page)).not.toContainText("timelog");
  await expect(description(page)).not.toContainText("---");
});

Then(
  "the property {string} links to {string}",
  async ({ page }, label: string, url: string) => {
    await expect(propertyLink(page, label)).toHaveAttribute("href", url);
  },
);

Then(
  "the frontmatter section {string} is closed",
  async ({ page }, title: string) => {
    await expect(
      properties(page).getByRole("button", { name: title }),
    ).toHaveAttribute("aria-expanded", "false");
  },
);

Then(
  "the frontmatter section {string} is open",
  async ({ page }, title: string) => {
    await expect(
      properties(page).getByRole("button", { name: title }),
    ).toHaveAttribute("aria-expanded", "true");
  },
);

When(
  "I toggle the frontmatter section {string}",
  async ({ page }, title: string) => {
    await properties(page).getByRole("button", { name: title }).click();
  },
);

Then(
  "the frontmatter section {string} lists {string}",
  async ({ page }, title: string, url: string) => {
    const contentId = await properties(page)
      .getByRole("button", { name: title })
      .getAttribute("aria-controls");
    await expect(
      page
        .locator(`[id="${contentId}"]`)
        .getByRole("listitem")
        .getByRole("link", { name: url }),
    ).toBeVisible();
  },
);

When(
  "I click the description link {string}",
  async ({ page }, name: string) => {
    await description(page).getByRole("link", { name }).click();
  },
);

When(
  "I press Enter on the description link {string}",
  async ({ page }, name: string) => {
    await description(page).getByRole("link", { name }).focus();
    await page.keyboard.press("Enter");
  },
);

When("I click the property link {string}", async ({ page }, label: string) => {
  await propertyLink(page, label).click();
});

When(
  "I middle-click the property link {string}",
  async ({ page }, label: string) => {
    await propertyLink(page, label).click({ button: "middle" });
  },
);

Then("Ajour asks to open {string}", async ({ page }, url: string) => {
  await expect(linkQuestion(page)).toBeVisible();
  await expect(linkQuestion(page)).toContainText(url);
});

When(
  "I answer the link question with {string}",
  async ({ page }, answer: string) => {
    await linkQuestion(page).getByRole("button", { name: answer }).click();
    await expect(linkQuestion(page)).toBeHidden();
  },
);

When(
  "I check {string} and answer the link question with {string}",
  async ({ page }, checkbox: string, answer: string) => {
    await linkQuestion(page).getByRole("checkbox", { name: checkbox }).check();
    await linkQuestion(page).getByRole("button", { name: answer }).click();
    await expect(linkQuestion(page)).toBeHidden();
  },
);

Then("no link opened", async ({ page }) => {
  // Give a wrongly opened tab time to load before checking.
  await page.waitForTimeout(500);
  expect(opened(page)).toEqual([]);
  expect(page.context().pages()).toHaveLength(1);
});

Then("{string} opened in a new tab", async ({ page }, url: string) => {
  await expect.poll(() => opened(page)).toContain(url);
});

Then(
  "{string} opened in a new tab without a question",
  async ({ page }, url: string) => {
    await expect.poll(() => opened(page)).toContain(url);
    await expect(linkQuestion(page)).toBeHidden();
  },
);

When(
  "I turn on {string} in Settings › Backlog",
  async ({ page }, label: string) => {
    await page.goto("/settings/backlog");
    const toggle = page.getByRole("switch", { name: label });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
  },
);

Then("the backlog item has no project", async ({ page }) => {
  await expect(
    properties(page).getByRole("combobox", { name: "Project" }),
  ).toHaveValue("");
});

When(
  "I create the timelog's project from the warning after Project",
  async ({ page }) => {
    await properties(page)
      .getByRole("button", { name: "Create project Beta Corp" })
      .click();
    const question = page.getByRole("alertdialog", {
      name: "Create project Beta Corp?",
    });
    await expect(question).toContainText("with the task Integration");
    await question.getByRole("button", { name: "Create project" }).click();
    await expect(question).toBeHidden();
  },
);

Then(
  "the backlog item's project is {string} and its task {string}",
  async ({ page }, projectName: string, taskName: string) => {
    await expect(
      properties(page).getByRole("combobox", { name: "Project" }),
    ).toHaveValue(projectName);
    await expect(
      properties(page).getByRole("combobox", { name: "Task" }),
    ).toHaveValue(taskName);
    await expect(
      properties(page).getByRole("button", { name: /Create project/ }),
    ).toHaveCount(0);
  },
);
