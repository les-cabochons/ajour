import { describe, expect, it } from "vitest";
import { withSuggestion } from "./suggestion";

describe("withSuggestion", () => {
  it("starts an empty comment with the lines to change, in a suggestion block", () => {
    expect(withSuggestion("", "const a = 1;\nconst b = 2;")).toBe(
      "```suggestion\nconst a = 1;\nconst b = 2;\n```",
    );
  });

  it("follows the words already written, after a blank line", () => {
    expect(withSuggestion("Rename it:\n", "let x;")).toBe(
      "Rename it:\n\n```suggestion\nlet x;\n```",
    );
  });

  it("fences lines holding backticks with a longer fence", () => {
    expect(withSuggestion("", "const md = ```code```;")).toBe(
      "````suggestion\nconst md = ```code```;\n````",
    );
  });

  it("suggests removing a blank line as an empty block", () => {
    expect(withSuggestion("", "")).toBe("```suggestion\n\n```");
  });
});
