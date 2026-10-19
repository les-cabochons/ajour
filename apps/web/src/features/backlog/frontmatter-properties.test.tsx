import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyList } from "@/components/property-list";
import { splitDescription } from "@/domain/backlog/description-frontmatter";
import {
  FrontmatterRows,
  FrontmatterSections,
} from "@/features/backlog/frontmatter-properties";

const fields =
  splitDescription(
    [
      "---",
      "Teamwork: https://acme.teamwork.com/app/tasks/123",
      "Owner: Ada",
      "Links:",
      "  - https://one.example",
      "  - https://two.example",
      "Client:",
      "  Contact: Grace",
      "timelog:",
      "  project: Acme",
      "---",
    ].join("\n"),
  ).frontmatter?.fields ?? [];

describe("frontmatter in the properties", () => {
  it("lists plain values as property rows, a link as a link", () => {
    const html = renderToStaticMarkup(
      <PropertyList>
        <FrontmatterRows fields={fields} />
      </PropertyList>,
    );

    expect(html).toContain("<dt");
    expect(html).toContain(">Teamwork</dt>");
    expect(html).toContain('href="https://acme.teamwork.com/app/tasks/123"');
    expect(html).toContain(">Owner</dt>");
    expect(html).toContain(">Ada<");
    expect(html).not.toContain("Links");
    expect(html).not.toContain("Client");
    expect(html).not.toContain("timelog");
  });

  it("shows each list and nested key as a section that starts closed", () => {
    const html = renderToStaticMarkup(<FrontmatterSections fields={fields} />);

    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).toContain("Links");
    expect(html).toContain("Client");
    expect(html).not.toContain("one.example");
    expect(html).not.toContain("Grace");
    expect(html).not.toContain("Teamwork");
  });
});
