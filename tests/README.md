# Unit tests

Vitest, with GNOME APIs mocked in `tests/mocks/` and installed globally by
`tests/setup.js`. `npm test` runs the suite and `npm run test:coverage` adds coverage;
`make unit-test-docker` runs it in the canonical container. Tests live in
`tests/unit/<module>/`, `tests/integration/` and `tests/regression/`, as `*.test.js`.

## Writing a test that can fail

Drive the real code in `lib/`, built through the fixtures in
`tests/mocks/helpers/` (`createWindowManagerFixture`, `createMockWindow`, …). A test
that reimplements the logic, or asserts on a mock it configured itself, stays green
when the code breaks. Check that yours fails without your change.

Extend a mock only as far as a test needs it, and make it behave like the real API:
a mock that is more forgiving than Mutter hides bugs.

## Version-gated behavior

The suite runs as GNOME 47 (`PACKAGE_VERSION` in `tests/setup.js`), so `Compat`
shims take their 47 branch, and a test of an API GNOME 47 lacks exercises code that
never runs there.

- **One version-specific assertion:** `vi.resetModules()`, `vi.doMock` the
  `resource:///org/gnome/shell/misc/config.js` module with the version, dynamically
  `import()` the module under test, and `vi.doUnmock` + `vi.resetModules()` in
  `finally` (see the GNOME 51 case in `tests/unit/tree/Tree-layout.test.js`).
- **A whole file that needs a newer API** (e.g. window minimum sizes, Mutter 50+):
  a file-level `vi.mock("resource:///org/gnome/shell/misc/config.js", () => ({
  PACKAGE_VERSION: "50.0" }))` (see `tests/regression/bug-s6g-minsize-redistribution.test.js`).

## Coverage

`vitest.config.js` sets the coverage floor (raise it, never lower it; recalibrate it
only when a new coverage tool measures the same code differently) and excludes
only UI glue that would need GTK4 or a real St/Clutter stack: the prefs, the
cheatsheet, the quick-settings indicator and the extension's theme manager.

## Launch-to-workspace tests

`tests/unit/extension/LaunchWorkspaceManager.test.js` covers the launch → new
workspace → auto-tile feature. It binds the real signal surface
(`ctx.windowManager._bindSignals()`) and emits `window-created` on the mock
display, so the production wiring — not just the manager — is under test. The
mock workspace manager's `append_new_workspace` mirrors Mutter by appending a
workspace and emitting `workspace-added` synchronously; that synchronous
emission is what drives the tree scaffolding in production, so the mock must
keep it.
