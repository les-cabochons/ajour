import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

function changeList(page: Page) {
  return page.getByRole("list", { name: "Changes" });
}

function changeRow(page: Page, kind: string) {
  return changeList(page).getByRole("listitem", {
    name: new RegExp(`^${kind}: `),
  });
}

Given("I have a committed week of entries", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: true,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  // Seed on the first load only, so later page loads keep what the app saved.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("commit-week-fixture-ready")) return;
    sessionStorage.setItem("commit-week-fixture-ready", "true");
    const hour = 60 * 60 * 1000;
    const entry = (
      _id: string,
      localDate: string,
      taskId: string,
      durationMs: number,
      note: string,
      committedAt: number,
    ) => ({
      _id,
      localDate,
      projectId: "project-atlas",
      taskId,
      label: "",
      note,
      durationMs,
      sourceBlockIds: [],
      committedAt,
      commit: {
        at: 1,
        localDate,
        projectId: "project-atlas",
        taskId,
        note,
        durationMs,
      },
    });
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: [
          {
            _id: "project-atlas",
            name: "Client Atlas",
            displayName: "Atlas",
            code: "ATL",
            // Read only while the Workday (agent) plugin is mocked as active.
            pluginProperties: {
              "workday-agent": { name: "CA004 Tech & Design" },
            },
            color: "#1f7667",
            icon: { kind: "preset", name: "dot" },
            status: "active",
            tasks: [
              {
                _id: "task-dev",
                name: "Development",
                status: "active",
                createdAt: 1,
              },
              {
                _id: "task-review",
                name: "Code review",
                status: "active",
                createdAt: 1,
              },
            ],
          },
        ],
        timers: [],
        workItems: [],
        timesheetEntries: [
          entry("mon-login", "2026-10-05", "task-dev", hour, "Login form", 1),
          entry("mon-api", "2026-10-05", "task-dev", 2 * hour, "API", 2),
          entry(
            "tue-spec",
            "2026-10-06",
            "task-review",
            hour,
            "Spec review",
            3,
          ),
        ],
        timesheetTombstones: [],
        updatedAt: 1,
      }),
    );
  });
});

Then("the Commit page says everything is committed", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Commit week of Oct 5 to Oct 11" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Everything is committed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark as committed" }),
  ).toHaveCount(0);
});

When(
  "I change Monday's {string} entry to {string} hours",
  async ({ page }, note: string, hours: string) => {
    // The Time page opens the last view shown, so ask for Day.
    await page.goto("/time/2026-10-05?view=day");
    const row = page.locator(".time-entry-row").filter({ hasText: note });
    await row.dblclick();
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill(hours);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row).toContainText(hours);
  },
);

When("I duplicate Tuesday's {string} entry", async ({ page }, note: string) => {
  await page.goto("/time/2026-10-06");
  await page.getByText(note, { exact: true }).click({ button: "right" });
  // "Duplicate to…" also starts with "Duplicate".
  await page
    .getByRole("menuitem")
    .filter({ hasText: /^Duplicate/ })
    .filter({ hasNotText: "to…" })
    .click();
  await expect(page.getByText(note, { exact: true })).toHaveCount(2);
});

Then("the Commit page lists {int} changes", async ({ page }, count: number) => {
  await expect(changeList(page).getByRole("listitem")).toHaveCount(count, {
    timeout: 15_000,
  });
});

Then("each change kind shows its own symbol", async ({ page }) => {
  for (const kind of ["Added", "Updated", "Deleted"]) {
    await expect(
      changeRow(page, kind).getByRole("img", { name: kind }),
    ).toBeVisible();
  }
});

Then(
  "the {string} change shows {string}",
  async ({ page }, kind: string, text: string) => {
    await expect(changeRow(page, kind)).toContainText(text);
  },
);

When("I uncheck the {string} change", async ({ page }, kind: string) => {
  await changeRow(page, kind).getByRole("checkbox").click();
  await expect(changeRow(page, kind).getByRole("checkbox")).not.toBeChecked();
});

Then(
  "the Commit page lists only the {string} change",
  async ({ page }, kind: string) => {
    await expect(changeList(page).getByRole("listitem")).toHaveCount(1);
    await expect(changeRow(page, kind)).toBeVisible();
    // An unchecked change stays unchecked after the others are committed.
    await expect(changeRow(page, kind).getByRole("checkbox")).not.toBeChecked();
  },
);

When(
  "I mark Monday's {string} entry as not committed",
  async ({ page }, note: string) => {
    await page.goto("/time/2026-10-05");
    await page.getByText(note, { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark as not committed" }).click();
    await expect(page.getByText("Marked as not committed")).toBeVisible();
  },
);

Then(
  "the Commit page lists only an/a {string} change for {string}",
  async ({ page }, kind: string, note: string) => {
    await expect(changeList(page).getByRole("listitem")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(changeRow(page, kind)).toContainText(note);
  },
);

When(
  "I choose {string} from the {string} entry's menu",
  async ({ page }, item: string, note: string) => {
    await page.getByText(note, { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: item }).click();
  },
);

function changesHeading(page: Page) {
  return page.getByRole("button", { name: "Changes", exact: true });
}

When("I collapse the Changes section", async ({ page }) => {
  await expect(changesHeading(page)).toHaveAttribute("aria-expanded", "true", {
    timeout: 15_000,
  });
  await changesHeading(page).click();
});

When("I expand the Changes section", async ({ page }) => {
  await changesHeading(page).click();
  await expect(changesHeading(page)).toHaveAttribute("aria-expanded", "true");
});

Then("the Commit page shows no change rows", async ({ page }) => {
  await expect(changesHeading(page)).toHaveAttribute("aria-expanded", "false");
  await expect(changeList(page)).toHaveCount(0);
});

Then("{string} is still on the Commit page", async ({ page }, name: string) => {
  await expect(page.getByRole("button", { name })).toBeVisible();
});

function mondayLine(page: Page, task: string) {
  return page
    .getByRole("region", { name: "Monday, Oct 5" })
    .getByRole("listitem")
    .filter({ hasText: task });
}

Then(
  "Monday's {string} line shows {string}",
  async ({ page }, task: string, text: string) => {
    await expect(
      mondayLine(page, task).getByRole("button", {
        name: /^Copy project and task: /,
      }),
    ).toHaveText(text, { timeout: 15_000 });
  },
);

When("I show line names from {string}", async ({ page }, source: string) => {
  await page
    .getByRole("group", { name: "Names" })
    .getByRole("button", { name: source, exact: true })
    .click();
});

When(
  "I copy the project and task of Monday's {string} line",
  async ({ page, context }, task: string) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mondayLine(page, task)
      .getByRole("button", { name: /^Copy project and task: / })
      .click();
  },
);

Then("the clipboard holds {string}", async ({ page }, text: string) => {
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(text);
});
