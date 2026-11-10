import { describe, it, expect } from "vitest";
import {
  PREVIEW_KINDS,
  RULE_SCOPES,
  buildFloatRule,
  isPlainTitleText,
  previewKind,
  previewRule,
  suggestScope,
  suggestTitleText,
} from "../../../lib/prefs/open-windows.js";

const edge = {
  wmClass: "microsoft-edge",
  title: "New Tab and 1 more page - Profile 1 - Microsoft Edge",
  appName: "Microsoft Edge",
  floating: false,
};
const pip = {
  wmClass: "microsoft-edge",
  title: "(275) Some video - YouTube",
  appName: "Microsoft Edge",
  floating: false,
};
const terminal = {
  wmClass: "org.gnome.Ptyxis",
  title: "user@host: ~/src",
  appName: "Ptyxis",
  floating: false,
};
const open = [edge, pip, terminal];

describe("buildFloatRule", () => {
  it("makes a class rule for the whole application", () => {
    expect(buildFloatRule(pip, RULE_SCOPES.APP)).toEqual({
      wmClass: "microsoft-edge",
      mode: "float",
    });
  });

  it("makes a title rule for 'contains'", () => {
    expect(buildFloatRule(pip, RULE_SCOPES.CONTAINS, " - YouTube ")).toEqual({
      wmClass: "microsoft-edge",
      wmTitle: "- YouTube",
      mode: "float",
    });
  });

  it("makes a negated title rule for 'does not contain'", () => {
    expect(buildFloatRule(pip, RULE_SCOPES.EXCLUDES, "Microsoft Edge")).toEqual({
      wmClass: "microsoft-edge",
      wmTitle: "!Microsoft Edge",
      mode: "float",
    });
  });

  it.each(["", "   ", "a, b", "!negated"])("makes no title rule from %j", (text) => {
    expect(isPlainTitleText(text)).toBe(false);
    expect(buildFloatRule(pip, RULE_SCOPES.CONTAINS, text)).toBeNull();
    expect(buildFloatRule(pip, RULE_SCOPES.EXCLUDES, text)).toBeNull();
  });
});

describe("previewRule", () => {
  it("counts the other open windows of the same class a rule matches", () => {
    const rule = buildFloatRule(pip, RULE_SCOPES.APP);

    expect(previewRule(rule, pip, open)).toEqual({
      matchesWindow: true,
      otherMatches: 1,
      otherTotal: 1,
    });
  });

  it("shows a 'does not contain' rule sparing the browser window", () => {
    const rule = buildFloatRule(pip, RULE_SCOPES.EXCLUDES, "Microsoft Edge");

    expect(previewRule(rule, pip, open)).toEqual({
      matchesWindow: true,
      otherMatches: 0,
      otherTotal: 1,
    });
  });

  it("shows when a rule would not match the window it was made from", () => {
    const rule = buildFloatRule(edge, RULE_SCOPES.EXCLUDES, "Microsoft Edge");

    expect(previewRule(rule, edge, open).matchesWindow).toBe(false);
  });

  it("tells two open windows with the same class and title apart", () => {
    const twin = { ...terminal };
    const rule = buildFloatRule(terminal, RULE_SCOPES.APP);

    expect(previewRule(rule, terminal, [terminal, twin])).toMatchObject({
      otherMatches: 1,
      otherTotal: 1,
    });
  });
});

describe("suggestTitleText", () => {
  it("suggests the last title segment for 'contains'", () => {
    expect(suggestTitleText(pip, RULE_SCOPES.CONTAINS)).toBe("- YouTube");
  });

  it("suggests the whole title when it has no segments", () => {
    expect(suggestTitleText(terminal, RULE_SCOPES.CONTAINS)).toBe("user@host: ~/src");
  });

  it("suggests the application name for 'does not contain'", () => {
    expect(suggestTitleText(pip, RULE_SCOPES.EXCLUDES)).toBe("Microsoft Edge");
  });

  it("suggests nothing it could not build a rule from", () => {
    const comma = { ...terminal, title: "one, two", appName: "" };

    expect(suggestTitleText(comma, RULE_SCOPES.CONTAINS)).toBe("");
    expect(suggestTitleText(comma, RULE_SCOPES.EXCLUDES)).toBe("");
    expect(suggestTitleText(comma, RULE_SCOPES.APP)).toBe("");
  });
});

describe("suggestScope", () => {
  it("opens on 'contains' when the title's last segment sets the window apart", () => {
    expect(suggestScope(pip, open)).toBe(RULE_SCOPES.CONTAINS);
  });

  it("opens on the whole application when its other windows share that segment", () => {
    const otherVideo = { ...pip, title: "Another video - YouTube" };

    expect(suggestScope(pip, [pip, otherVideo])).toBe(RULE_SCOPES.APP);
  });

  it("opens on the whole application when it has no other open window", () => {
    expect(suggestScope(terminal, open)).toBe(RULE_SCOPES.APP);
    expect(suggestScope(pip, [pip])).toBe(RULE_SCOPES.APP);
  });

  it("never opens on 'does not contain'", () => {
    for (const window of open) {
      expect(suggestScope(window, open)).not.toBe(RULE_SCOPES.EXCLUDES);
    }
  });
});

describe("previewKind", () => {
  it.each([
    [{ matchesWindow: false, otherMatches: 1, otherTotal: 1 }, PREVIEW_KINDS.MISSES_WINDOW],
    [{ matchesWindow: true, otherMatches: 0, otherTotal: 0 }, PREVIEW_KINDS.ONLY_WINDOW],
    [{ matchesWindow: true, otherMatches: 0, otherTotal: 2 }, PREVIEW_KINDS.SPARES_OTHERS],
    [{ matchesWindow: true, otherMatches: 2, otherTotal: 2 }, PREVIEW_KINDS.ALL_OTHERS],
    [{ matchesWindow: true, otherMatches: 1, otherTotal: 2 }, PREVIEW_KINDS.SOME_OTHERS],
  ])("%j is %s", (preview, kind) => {
    expect(previewKind(preview)).toBe(kind);
  });
});
