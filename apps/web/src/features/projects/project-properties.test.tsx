// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ProjectSourceSnapshot } from "@ajour/shared";
import type { LocalProject } from "@/domain/local-state";
import {
  ProjectPropertiesCard,
  ProjectTitle,
} from "@/features/projects/project-properties";
import { ManagedProjectTitleMark } from "@/features/projects/project-source-ui";
import { getProjectSourceLabel } from "@/domain/projects/source-link";
import { localStore } from "@/lib/local-store";
import { installDomShims } from "@/test-support/dom";
import { fixtureSnapshot } from "../../../../../packages/example/index.ts";

/*
 * A managed project's Properties card (#506): what its source owns reads as
 * locked text, and the user's own fields still edit in place. The project
 * comes from the example plugin's snapshot, applied through the store.
 */

const CONNECTION = { pluginId: "example-planner", connectionId: "planner" };

beforeAll(installDomShims);

beforeEach(() => {
  localStore.removeConnectionProjectSource(CONNECTION.connectionId);
});

afterEach(cleanup);

/** Applies the snapshot and returns the managed project it brought for `code`. */
function syncedProject(
  code: string,
  snapshot: ProjectSourceSnapshot = fixtureSnapshot,
): LocalProject {
  localStore.applyProjectSourceSync(CONNECTION, snapshot, Date.now());
  return localStore
    .snapshot()
    .projects.find((project) => project.code === code)!;
}

function renderCard(project: LocalProject) {
  return render(
    <ProjectPropertiesCard
      project={project}
      sourceLabel={getProjectSourceLabel(
        project,
        localStore.snapshot().projectSources,
      )}
      isImporting={false}
      onImport={() => {}}
      onArchive={() => {}}
      onRestore={() => {}}
    />,
  );
}

/** The value cell of the card's row labelled `label`. */
function row(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling as HTMLElement;
}

describe("a managed project's Properties card", () => {
  it("shows the full name, code and client as locked text that its source sets", () => {
    renderCard(syncedProject("ACME-SUP"));

    for (const [label, value] of [
      ["Full name", "Acme - Support"],
      ["Code", "ACME-SUP"],
      ["Client", "Acme inc."],
    ] as const) {
      const cell = row(label);
      expect(cell.textContent).toContain(value);
      expect(within(cell).queryByRole("button")).toBeNull();
      expect(
        within(cell).getByText("Locked. Example planner sets it."),
      ).toBeTruthy();
      // The lock adds no tab stop: the row reads as read-only.
      expect(cell.querySelector("[tabindex]")).toBeNull();
      expect(within(cell).queryByRole("img")).toBeNull();
    }
    expect(
      screen.queryByRole("button", { name: /^Edit full name/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit code/ })).toBeNull();
  });

  it("offers no Import tasks…, which its source replaces", () => {
    renderCard(syncedProject("ACME-SUP"));

    expect(screen.queryByRole("button", { name: /Import tasks/ })).toBeNull();
  });

  it("keeps the color and icon pickers", () => {
    renderCard(syncedProject("ACME-SUP"));

    expect(screen.getByRole("button", { name: /^Project color/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Project icon/ })).toBeTruthy();
  });

  it("opens the project in its source from the link the snapshot gave", () => {
    renderCard(syncedProject("ACME-SUP"));

    const link = screen.getByRole("link", { name: "Open in Example planner" });
    expect(link.getAttribute("href")).toBe(
      "https://planner.example/projects/ACME-SUP",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("syncs its source from Sync now, which waits while a sync runs (#686)", () => {
    const project = syncedProject("ACME-SUP");
    const label = getProjectSourceLabel(
      project,
      localStore.snapshot().projectSources,
    );
    const onSyncSource = vi.fn();
    const card = (sourceSyncing: boolean) => (
      <ProjectPropertiesCard
        project={project}
        sourceLabel={label}
        isImporting={false}
        onImport={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        sourceSyncing={sourceSyncing}
        onSyncSource={onSyncSource}
      />
    );
    const { rerender } = render(card(false));

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(onSyncSource).toHaveBeenCalledOnce();

    rerender(card(true));
    const busy = screen.getByRole("button", { name: "Syncing…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no Open in link when the source gave no URL", () => {
    const snapshot = structuredClone(fixtureSnapshot);
    delete snapshot.projects[0]!.url;
    renderCard(syncedProject("ACME-SUP", snapshot));

    expect(screen.queryByRole("link", { name: /^Open in/ })).toBeNull();
  });

  it("still saves the display name the user types", () => {
    const project = syncedProject("ACME-SUP");
    render(<ProjectTitle project={project} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Acme - Support" }));
    const field = screen.getByRole("textbox", { name: "Display name" });
    fireEvent.change(field, { target: { value: "Support" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const saved = localStore
      .snapshot()
      .projects.find(({ _id }) => _id === project._id);
    expect(saved).toMatchObject({
      displayName: "Support",
      name: "Acme - Support",
    });
  });
});

describe("a managed project's dates (#508)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 5, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the source's dates as a locked row, the year only when it is not this year's", () => {
    renderCard(syncedProject("ACME-SUP"));

    const cell = row("Dates");
    expect(within(cell).getByText("Jan 1 – Dec 31")).toBeTruthy();
    expect(
      within(cell).getByText("Locked. Example planner sets it."),
    ).toBeTruthy();
    expect(screen.queryByText(/^Ended on/)).toBeNull();
  });

  it("shows a start alone, or an end alone, on its side of the dash", () => {
    const startOnly = structuredClone(fixtureSnapshot);
    delete startOnly.projects[0]!.endsOn;
    renderCard(syncedProject("ACME-SUP", startOnly));
    expect(within(row("Dates")).getByText("Jan 1 –")).toBeTruthy();
    cleanup();

    const endOnly = structuredClone(fixtureSnapshot);
    delete endOnly.projects[0]!.startsOn;
    endOnly.projects[0]!.endsOn = "2027-03-31";
    renderCard(syncedProject("ACME-SUP", endOnly));
    expect(within(row("Dates")).getByText("– Mar 31, 2027")).toBeTruthy();
  });

  it("says when a project past its end ended, in a muted line", () => {
    renderCard(syncedProject("GLOBEX-INT"));

    expect(within(row("Dates")).getByText("Feb 2 – Oct 31, 2025")).toBeTruthy();
    const ended = screen.getByText("Ended on Oct 31, 2025");
    expect(ended.className).toContain("text-muted-foreground");
  });

  it("hides the Dates and Client rows when the source gave none", () => {
    const bare = structuredClone(fixtureSnapshot);
    delete bare.projects[0]!.startsOn;
    delete bare.projects[0]!.endsOn;
    delete bare.projects[0]!.client;
    renderCard(syncedProject("ACME-SUP", bare));

    expect(screen.queryByText("Dates", { selector: "dt" })).toBeNull();
    expect(screen.queryByText("Client", { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Ended on/)).toBeNull();
    expect(row("Code").textContent).toContain("ACME-SUP");
  });
});

describe("the From mark by a managed project's title", () => {
  it("gives the last sync to a screen reader and a focus ring to the keyboard", () => {
    render(
      <ManagedProjectTitleMark label="Example planner" syncedAt={1_000} />,
    );

    const mark = screen.getByRole("group", { name: "From Example planner" });
    const description = document.getElementById(
      mark.getAttribute("aria-describedby") ?? "",
    );
    expect(description?.textContent).toMatch(/^Last sync /);
    expect(mark.getAttribute("tabindex")).toBe("0");
    expect(mark.className).toContain("focus-visible:ring-2");
  });

  it("does not take the room after it, so a chip follows the mark", () => {
    render(
      <ManagedProjectTitleMark label="Example planner" syncedAt={1_000} />,
    );

    const wrapper = screen.getByRole("group").parentElement!;
    expect(wrapper.className).not.toMatch(/(^|\s)grow(\s|$)/);
  });
});

describe("a local project's Properties card", () => {
  it("edits its full name and code in place, with no lock and no Open in link", () => {
    const project: LocalProject = {
      _id: "local",
      name: "Internal",
      code: "INT",
      color: "#123456",
      icon: { kind: "preset", name: "dot" },
      status: "active",
      tasks: [],
    };
    renderCard(project);

    expect(
      screen.getByRole("button", { name: "Edit full name, Internal" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit code, INT" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import tasks…" })).toBeTruthy();
    expect(screen.queryByText("Client", { selector: "dt" })).toBeNull();
    expect(screen.queryByLabelText(/^Locked/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Open in/ })).toBeNull();
  });

  it("says what to type where a value is missing, never a value", () => {
    const project: LocalProject = {
      _id: "local",
      name: "Internal",
      color: "#123456",
      icon: { kind: "preset", name: "dot" },
      status: "active",
      tasks: [],
    };
    renderCard(project);

    const code = screen.getByRole("button", { name: "Edit code, empty" });
    expect(code.textContent).toBe("Add");
    // Drawn as a placeholder (styles/projects.css).
    expect(code.querySelector("[data-placeholder]")).toBeTruthy();
    fireEvent.click(code);
    expect(
      screen.getByRole("textbox", { name: "Code" }).getAttribute("placeholder"),
    ).toBe("Add");

    cleanup();
    render(<ProjectTitle project={project} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Internal" }));
    // Emptied, the display name falls back to the full name.
    expect(
      screen
        .getByRole("textbox", { name: "Display name" })
        .getAttribute("placeholder"),
    ).toBe("Same as full name");
  });
});
