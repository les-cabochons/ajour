import { expect, type Page } from "@playwright/test";

/** The app sidebar's view switcher, named after the open view. */
export function viewSwitcher(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: /^(Time|Backlog|Pull requests|Projects)$/ });
}

/** The views the switcher lists, read by opening and closing its menu. */
export async function viewSwitcherOptions(page: Page) {
  await viewSwitcher(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const options = await menu.getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return options.map((text) => text.split("\n")[0]!.trim());
}
