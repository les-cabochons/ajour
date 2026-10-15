import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownRenderer from "./markdown-renderer";

const render = (markdown: string) =>
  renderToStaticMarkup(<MarkdownRenderer>{markdown}</MarkdownRenderer>);

describe("MarkdownRenderer", () => {
  it("keeps single line breaks of plain-text notes", () => {
    expect(render("First line\nSecond line")).toBe(
      "<p>First line<br/>\nSecond line</p>",
    );
  });

  it("shows raw HTML as text", () => {
    const html = render("<script>alert(1)</script> <b>bold</b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });

  it("opens web and mail links outside the app", () => {
    expect(render("[spec](https://example.com)")).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">spec</a>',
    );
    expect(render("[mail](mailto:a@example.com)")).toContain(
      'href="mailto:a@example.com"',
    );
  });

  it.each(["javascript:alert(1)", "/settings", "#top"])(
    "keeps a %s link as text",
    (url) => {
      const html = render(`[label](${url})`);
      expect(html).not.toContain("<a");
      expect(html).toContain("<span>label</span>");
    },
  );

  it("turns images into links instead of loading them", () => {
    const html = render("![diagram](https://example.com/pixel.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain(
      '<a href="https://example.com/pixel.png" target="_blank" rel="noreferrer">diagram</a>',
    );
  });

  it("draws task list items with the app checkbox", () => {
    const html = render("- [x] done\n- [ ] open");
    expect(html).not.toContain('type="checkbox" disabled');
    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2);
  });
});
