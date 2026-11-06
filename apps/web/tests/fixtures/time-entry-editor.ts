import type { Page } from "@playwright/test";

/**
 * The Time page's entry editor wherever it shows: the side panel on a
 * desktop width, or the dialog in the narrow view and off the Time page.
 */
export function timeEntryEditor(page: Page) {
  return page
    .getByRole("complementary", { name: "Time entry editor" })
    .or(page.getByRole("dialog", { name: /^(New|Edit) time entry$/ }));
}
