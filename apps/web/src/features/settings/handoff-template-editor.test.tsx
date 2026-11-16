// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { HandoffTemplateEditor } from "./handoff-template-editor";
import { handoffTemplateDefaults } from "@ajour/shared/handoff-templates";
installDomShims();
it("previews a chosen item, inserts a slot at the caret and reports save errors", async () => {
  const save = vi.fn().mockRejectedValue(new Error("Save refused"));
  const view = await renderRoutes({
    routes: {
      "/": () => (
        <HandoffTemplateEditor
          initial={handoffTemplateDefaults()}
          items={[
            {
              id: "a",
              label: "PAY-12 Fix",
              context: {
                item: { key: "PAY-12", title: "Fix", url: "", type: "Bug" },
                projectName: "Project",
                repoName: "Repo",
              },
            },
          ]}
          onSave={save}
        />
      ),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview PAY-12 Fix" }));
  expect(screen.getByLabelText("Title preview").textContent).toBe(
    "[PAY-12] Fix",
  );
  const title = screen.getByLabelText("Title template");
  if (!(title instanceof HTMLTextAreaElement))
    throw new Error("Expected a template textarea");
  fireEvent.focus(title);
  title.setSelectionRange(0, 0);
  fireEvent.click(screen.getByRole("button", { name: "Insert item.type" }));
  expect(screen.getByLabelText("Title preview").textContent).toBe(
    "Bug[PAY-12] Fix",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save templates" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Save refused"),
  );
  view.unmount();
});
