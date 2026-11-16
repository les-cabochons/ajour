// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  HandoffTemplateEditor,
  PluginHandoffTemplates,
} from "./handoff-template-editor";
import { handoffTemplateDefaults } from "@ajour/shared/handoff-templates";
import { listRepositoryFolders } from "@/lib/app-api";
vi.mock("@/lib/local-hooks", () => ({
  useLocalState: () => ({
    projects: [
      { _id: "p1", name: "First" },
      { _id: "p2", name: "Second" },
    ],
    workItems: [
      { _id: "one", projectId: "p1", title: "First item" },
      { _id: "two", projectId: "p2", title: "Second item" },
    ],
  }),
}));
vi.mock("@/lib/app-api", () => ({
  getHandoffTemplates: vi.fn(async () => ({
    prompt: "{{repo.name}}",
    title: "T",
    branch: "",
  })),
  saveHandoffTemplates: vi.fn(),
  listRepositoryFolders: vi.fn(async () => [
    { id: "folder", name: "Chosen repo", lastUsedAt: 1 },
  ]),
}));
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
  expect(
    screen.queryByRole("button", { name: "Preview PAY-12 Fix" }),
  ).toBeNull();
  const picker = screen.getByRole("combobox", { name: "Preview item" });
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "PAY-12" } });
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(screen.getByLabelText("Title preview").textContent).toBe(
    "[PAY-12] Fix",
  );
  const title = screen.getByLabelText("Title template");
  if (!(title instanceof HTMLInputElement))
    throw new Error("Expected a single-line title input");
  fireEvent.focus(title);
  title.setSelectionRange(0, 0);
  fireEvent.click(screen.getByRole("button", { name: "Insert item.type" }));
  expect(screen.getByLabelText("Title preview").textContent).toBe(
    "Bug[PAY-12] Fix",
  );
  expect(screen.getByLabelText("Branch template")).toBeInstanceOf(
    HTMLInputElement,
  );
  fireEvent.change(screen.getByLabelText("Branch template"), {
    target: { value: "bad branch" },
  });
  expect(screen.getByRole("alert").textContent).toContain("branch template");
  fireEvent.change(screen.getByLabelText("Branch template"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save templates" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Save refused"),
  );
  view.unmount();
});

it("loads folders only for the chosen item's project and keeps drafts independent", async () => {
  vi.mocked(listRepositoryFolders).mockClear();
  const view = await renderRoutes({
    routes: { "/": () => <PluginHandoffTemplates pluginId="tool" /> },
  });
  const picker = await screen.findByRole("combobox", { name: "Preview item" });
  expect(listRepositoryFolders).not.toHaveBeenCalled();
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "Second item" } });
  fireEvent.keyDown(picker, { key: "Enter" });
  await waitFor(() =>
    expect(screen.getByLabelText("Prompt preview").textContent).toBe(
      "Chosen repo",
    ),
  );
  expect(listRepositoryFolders).toHaveBeenCalledExactlyOnceWith("p2");
  fireEvent.change(screen.getByLabelText("Title template"), {
    target: { value: "Draft" },
  });
  expect(listRepositoryFolders).toHaveBeenCalledTimes(1);
  view.unmount();
});
