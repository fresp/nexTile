import { describe, it, expect } from "vitest";
import { floatRuleMatches, wmClassMatches } from "../../../lib/shared/window-rules.js";

describe("wmClassMatches", () => {
  it("matches exactly and case-sensitively, with comma alternatives", () => {
    expect(wmClassMatches("Steam,steam", "steam")).toBe(true);
    expect(wmClassMatches("steam", "Steam")).toBe(false);
    expect(wmClassMatches("steam", "steamwebhelper")).toBe(false);
    expect(wmClassMatches("steam", null)).toBe(false);
  });
});

describe("floatRuleMatches", () => {
  const edge = { wmClass: "microsoft-edge", title: "New Tab - Microsoft Edge", id: 7 };
  const pip = { wmClass: "microsoft-edge", title: "Some video - YouTube", id: 8 };

  it("matches a class rule on class alone", () => {
    expect(floatRuleMatches({ wmClass: "microsoft-edge" }, edge)).toBe(true);
    expect(floatRuleMatches({ wmClass: "firefox" }, edge)).toBe(false);
  });

  it("matches a title by case-insensitive substring", () => {
    expect(floatRuleMatches({ wmClass: "microsoft-edge", wmTitle: "youtube" }, pip)).toBe(true);
    expect(floatRuleMatches({ wmClass: "microsoft-edge", wmTitle: "youtube" }, edge)).toBe(false);
  });

  it("negates a title pattern that starts with !", () => {
    const rule = { wmClass: "microsoft-edge", wmTitle: "!Microsoft Edge" };

    expect(floatRuleMatches(rule, pip)).toBe(true);
    expect(floatRuleMatches(rule, edge)).toBe(false);
  });

  it("matches a title-only rule whatever the class, and nothing without criteria", () => {
    expect(floatRuleMatches({ wmTitle: "YouTube" }, pip)).toBe(true);
    expect(floatRuleMatches({}, pip)).toBe(false);
  });

  it("requires the id of a per-window rule", () => {
    expect(floatRuleMatches({ wmClass: "microsoft-edge", wmId: 8 }, pip)).toBe(true);
    expect(floatRuleMatches({ wmClass: "microsoft-edge", wmId: 8 }, edge)).toBe(false);
  });

  it("never matches a title rule against a window without a title", () => {
    const untitled = { wmClass: "microsoft-edge", title: null };

    expect(floatRuleMatches({ wmClass: "microsoft-edge", wmTitle: "!x" }, untitled)).toBe(false);
  });

  it("reads only the window properties the rule has criteria for", () => {
    const window = {
      wmClass: "foot",
      get title() {
        throw new Error("title read for a class-only rule");
      },
      get id() {
        throw new Error("id read for a class-only rule");
      },
    };

    expect(floatRuleMatches({ wmClass: "foot" }, window)).toBe(true);
  });
});
