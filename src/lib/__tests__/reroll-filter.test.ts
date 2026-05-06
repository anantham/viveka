import { describe, it, expect } from "vitest";
import { filterRerollAlternatives } from "../reroll-filter";

describe("filterRerollAlternatives", () => {
  it("returns [] when input is not an array", () => {
    expect(filterRerollAlternatives(null, "x")).toEqual([]);
    expect(filterRerollAlternatives("not an array", "x")).toEqual([]);
    expect(filterRerollAlternatives({ a: 1 }, "x")).toEqual([]);
  });

  it("filters out non-string entries", () => {
    expect(filterRerollAlternatives(["ok", 5, null, "fine"], "x")).toEqual([
      "ok",
      "fine",
    ]);
  });

  it("trims and drops empty strings", () => {
    expect(filterRerollAlternatives(["  hello ", "", "   "], "x")).toEqual([
      "hello",
    ]);
  });

  it("dedupes (after trim)", () => {
    expect(
      filterRerollAlternatives(["dog", "  dog  ", "cat", "dog"], "x"),
    ).toEqual(["dog", "cat"]);
  });

  it("drops alternatives that equal the original phrase", () => {
    expect(
      filterRerollAlternatives(["friction", "resistance", "drag"], "friction"),
    ).toEqual(["resistance", "drag"]);
  });

  it("drops alternatives containing the original word as a token (the bug)", () => {
    // Model returned "intentional friction" for "friction" — must be filtered.
    expect(
      filterRerollAlternatives(
        ["intentional friction", "resistance", "guardrails"],
        "friction",
      ),
    ).toEqual(["resistance", "guardrails"]);
  });

  it("is case-insensitive on the word-boundary check", () => {
    expect(
      filterRerollAlternatives(["Friction barrier", "resistance"], "friction"),
    ).toEqual(["resistance"]);
  });

  it("does NOT drop substrings that aren't whole-word matches", () => {
    // "frictionless" contains "friction" as a substring but not as a word — keep.
    expect(
      filterRerollAlternatives(["frictionless", "resistance"], "friction"),
    ).toEqual(["frictionless", "resistance"]);
  });

  it("escapes regex metacharacters in the original phrase", () => {
    // Original contains regex special chars — escaping must prevent them from
    // becoming a regex pattern (which would either throw or match weirdly).
    const result = filterRerollAlternatives(
      ["a.b alternative", "c.d alternative"],
      "a.b",
    );
    // "a.b alternative" contains "a.b" as a token → should be dropped
    expect(result).toEqual(["c.d alternative"]);
  });

  it("handles multi-word original phrases", () => {
    expect(
      filterRerollAlternatives(
        ["sprinting fast", "running quickly indeed", "darting ahead"],
        "running quickly",
      ),
    ).toEqual(["sprinting fast", "darting ahead"]);
  });

  it("returns [] when every candidate is filtered out", () => {
    expect(
      filterRerollAlternatives(["friction", "more friction"], "friction"),
    ).toEqual([]);
  });
});
