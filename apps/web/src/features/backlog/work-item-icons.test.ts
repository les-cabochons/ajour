import { describe, expect, it } from "vitest";
import { resolvePluginIconPaint } from "./work-item-icons";

describe("resolvePluginIconPaint", () => {
  it("uses a CSS mask for a currentColor-only icon", () => {
    const svg = "<svg><path fill='currentColor' d='M0 0h1v1z' /></svg>";

    expect(resolvePluginIconPaint(svg, "oklch(0.985 0 0)")).toEqual({
      usesMask: true,
      svg,
    });
  });

  it("preserves fixed paint and resolves currentColor in mixed icons", () => {
    const result = resolvePluginIconPaint(
      "<svg><path fill='#2684ff'/><path stroke='currentColor'/></svg>",
      "oklch(0.145 0 0)",
    );

    expect(result.usesMask).toBe(false);
    expect(result.svg).toContain("fill='#2684ff'");
    expect(result.svg).toContain("stroke='oklch(0.145 0 0)'");
  });

  it("recognizes fixed paint in inline and stylesheet CSS", () => {
    const inline = resolvePluginIconPaint(
      "<svg><path style='fill: #2684ff; stroke: currentColor'/></svg>",
      "oklch(0.985 0 0)",
    );
    const stylesheet = resolvePluginIconPaint(
      "<svg><style>.fixed { fill: #2684ff; }</style><path class='fixed'/><path fill='currentColor'/></svg>",
      "oklch(0.985 0 0)",
    );

    expect(inline.usesMask).toBe(false);
    expect(inline.svg).toContain("stroke: oklch(0.985 0 0)");
    expect(stylesheet.usesMask).toBe(false);
    expect(stylesheet.svg).toContain("fill='oklch(0.985 0 0)'");
  });
});
