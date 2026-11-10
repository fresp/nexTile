/*
 * This file is part of the NexTile extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// How a windows.json rule matches a window. Shared so the extension, which
// applies the rules, and prefs, which previews them, cannot disagree.

/**
 * Whether a rule's wmClass names the window's class. Exact and case-sensitive;
 * commas separate alternatives.
 *
 * @param {string | null | undefined} ruleWmClass
 * @param {string | null | undefined} windowWmClass
 * @returns {boolean}
 */
export function wmClassMatches(ruleWmClass, windowWmClass) {
  if (!ruleWmClass || !windowWmClass) return false;
  return ruleWmClass.split(",").some((c) => c.trim() === windowWmClass);
}

/**
 * Whether a float (or launch) rule matches a window. `window` is read lazily,
 * one property per criterion the rule carries.
 *
 * @param {{ wmClass?: string, wmTitle?: string, wmId?: number }} rule
 * @param {{ wmClass?: string | null, title?: string | null, id?: number }} window
 * @returns {boolean}
 */
export function floatRuleMatches(rule, window) {
  let matchTitle = false;
  let matchClass = false;
  let matchId = false;

  if (rule.wmTitle) {
    const windowTitle = window.title;
    if (rule.wmTitle === " ") {
      matchTitle = rule.wmTitle === windowTitle;
    } else {
      // nextile-11k: titles are matched by substring (.includes), never exact,
      // so lowercasing both sides is safe and gives locale/casing fidelity for
      // titles like "Picture-in-Picture". The !-negation and comma-split are
      // preserved.
      const haystack = windowTitle ? windowTitle.toLowerCase() : windowTitle;
      let titles = rule.wmTitle.split(",");
      matchTitle =
        titles.filter((t) => {
          if (haystack) {
            if (t.startsWith("!")) {
              return !haystack.includes(t.slice(1).toLowerCase());
            } else {
              return haystack.includes(t.toLowerCase());
            }
          }
          return false;
        }).length > 0;
    }
  }
  if (rule.wmClass) {
    matchClass = wmClassMatches(rule.wmClass, window.wmClass);
  }
  if (rule.wmId) {
    matchId = rule.wmId === window.id;
  }

  // Bug #172 fix: If override has wmId (per-window), REQUIRE it to match
  // If no wmId (class-based), match all windows of that class
  if (rule.wmId) {
    return matchId && matchClass;
  }
  // nextile-n29i: a class-less float rule must be allowed to match on title
  // alone — when wmClass is absent, don't require matchClass. A rule with no
  // criteria at all (no wmClass, no wmTitle, no wmId) must match nothing.
  if (!rule.wmClass) {
    return Boolean(rule.wmTitle) && matchTitle;
  }
  return (!rule.wmTitle || matchTitle) && matchClass;
}
