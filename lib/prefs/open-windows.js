// Pure, GTK-free logic behind the Rules page's "Open Windows" list and its
// "Float Windows Like This" dialog. Kept separate from floating.js so it is
// unit-testable without GTK/Adw.

import { floatRuleMatches } from "../shared/window-rules.js";

/** @typedef {import('../shared/window-list.js').OpenWindow} OpenWindow */

/** How wide a rule made from an open window reaches. */
export const RULE_SCOPES = Object.freeze({
  /** Every window of the application. */
  APP: "app",
  /** Windows of the application whose title contains a text. */
  CONTAINS: "contains",
  /** Windows of the application whose title does not contain a text. */
  EXCLUDES: "excludes",
});

/**
 * Whether `text` can be the title text of a rule made in the dialog. In a rule,
 * a comma separates alternative titles and a leading `!` negates, so a text
 * using either would not mean what the dialog says it means.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPlainTitleText(text) {
  const trimmed = text.trim();
  return trimmed !== "" && !trimmed.includes(",") && !trimmed.startsWith("!");
}

/**
 * The float rule for `window` at `scope`, or null while the text is unusable.
 *
 * @param {OpenWindow} window
 * @param {string} scope - one of RULE_SCOPES
 * @param {string} [text] - the title text, for the two title scopes
 * @returns {{ wmClass: string, wmTitle?: string, mode: "float" } | null}
 */
export function buildFloatRule(window, scope, text = "") {
  if (scope === RULE_SCOPES.APP) return { wmClass: window.wmClass, mode: "float" };
  if (!isPlainTitleText(text)) return null;
  const title = text.trim();
  return {
    wmClass: window.wmClass,
    wmTitle: scope === RULE_SCOPES.EXCLUDES ? `!${title}` : title,
    mode: "float",
  };
}

/**
 * What a rule would do to the windows open now.
 *
 * @param {object} rule
 * @param {OpenWindow} window - the window the rule is being made from
 * @param {OpenWindow[]} windows - every open window, `window` among them
 * @returns {{ matchesWindow: boolean, otherMatches: number, otherTotal: number }}
 *   otherMatches of the otherTotal other open windows of the same class match
 */
export function previewRule(rule, window, windows) {
  const others = windows.filter((w) => w !== window && w.wmClass === window.wmClass);
  return {
    matchesWindow: floatRuleMatches(rule, window),
    otherMatches: others.filter((w) => floatRuleMatches(rule, w)).length,
    otherTotal: others.length,
  };
}

/**
 * The title text the dialog starts a scope with.
 *
 * CONTAINS: the last " - " segment of the title, which is where a title names
 * its site or document type ("… - YouTube"); the whole title when there is none.
 * EXCLUDES: the application's name, which an application's own windows carry in
 * their title and a picture-in-picture or similar helper window does not.
 *
 * @param {OpenWindow} window
 * @param {string} scope - one of RULE_SCOPES
 * @returns {string}
 */
export function suggestTitleText(window, scope) {
  let text = "";
  if (scope === RULE_SCOPES.EXCLUDES) {
    text = window.appName;
  } else if (scope === RULE_SCOPES.CONTAINS) {
    const cut = window.title.lastIndexOf(" - ");
    text = cut === -1 ? window.title : window.title.slice(cut + 1);
  }
  text = text.trim();
  return isPlainTitleText(text) ? text : "";
}

/**
 * The scope the dialog opens on: CONTAINS when the suggested text tells this
 * window apart from the application's other open windows, as "- YouTube" does
 * for a browser's picture-in-picture window; otherwise APP.
 *
 * Never EXCLUDES: a rule on what a title lacks also catches windows that are not
 * open to preview against. "Title does not contain Microsoft Edge" was a default
 * rule once, and floated every Edge window titled after its page alone.
 *
 * @param {OpenWindow} window
 * @param {OpenWindow[]} windows
 * @returns {string} one of RULE_SCOPES
 */
export function suggestScope(window, windows) {
  const text = suggestTitleText(window, RULE_SCOPES.CONTAINS);
  const rule = buildFloatRule(window, RULE_SCOPES.CONTAINS, text);
  if (rule) {
    const { matchesWindow, otherMatches, otherTotal } = previewRule(rule, window, windows);
    if (matchesWindow && otherTotal > 0 && otherMatches === 0) return RULE_SCOPES.CONTAINS;
  }
  return RULE_SCOPES.APP;
}

/** What previewRule found, as the one sentence the dialog shows for it. */
export const PREVIEW_KINDS = Object.freeze({
  /** The rule does not match the window it is being made from. */
  MISSES_WINDOW: "misses-window",
  /** The application has no other open window to compare against. */
  ONLY_WINDOW: "only-window",
  /** None of the application's other open windows match. */
  SPARES_OTHERS: "spares-others",
  /** Every other open window of the application matches too. */
  ALL_OTHERS: "all-others",
  /** Some, not all, of the application's other open windows match. */
  SOME_OTHERS: "some-others",
});

/**
 * @param {ReturnType<typeof previewRule>} preview
 * @returns {string} one of PREVIEW_KINDS
 */
export function previewKind({ matchesWindow, otherMatches, otherTotal }) {
  if (!matchesWindow) return PREVIEW_KINDS.MISSES_WINDOW;
  if (otherTotal === 0) return PREVIEW_KINDS.ONLY_WINDOW;
  if (otherMatches === 0) return PREVIEW_KINDS.SPARES_OTHERS;
  if (otherMatches === otherTotal) return PREVIEW_KINDS.ALL_OTHERS;
  return PREVIEW_KINDS.SOME_OTHERS;
}
