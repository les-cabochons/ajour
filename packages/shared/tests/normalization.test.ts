import { describe, expect, it } from "vitest";
import { normalizeActivityContext } from "../index";

const capture = {
  urlMode: "sanitized_path" as const,
  titleMode: "normalized" as const,
  blockedDomains: ["blocked.example.com"],
  sensitiveDomains: ["sensitive.example.com"],
  maxPathSegments: 4,
};

describe("normalizeActivityContext", () => {
  it("strips query and hash from URLs", () => {
    const result = normalizeActivityContext(
      {
        url: "https://github.com/myorg/payments/issues/123?foo=bar#top",
        title: "Issue 123 · myorg/payments",
      },
      { capture },
    );

    expect(result.url).toBe("github.com/myorg/payments/issues/:id");
    expect(result.pathname).toBe("/myorg/payments/issues/:id");
  });

  it("downgrades sensitive domains to domain only", () => {
    const result = normalizeActivityContext(
      {
        url: "https://sensitive.example.com/clients/123/private",
        title: "Private Area",
      },
      { capture },
    );

    expect(result.url).toBe("sensitive.example.com");
    expect(result.pathname).toBe("/");
  });

  it("returns blocked placeholders for blocked domains", () => {
    const result = normalizeActivityContext(
      {
        url: "https://blocked.example.com/secret",
        title: "Secret",
      },
      { capture },
    );

    expect(result.pathname).toBe("/blocked");
    expect(result.title).toBe("");
  });
});
