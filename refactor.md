# Current refactor

This document tracks the improvements identified in the review of changes since commit `b45e45e`.

## 1. Pace-generator correctness

- [x] Allow generated pace text to represent all practical target times without being rejected by the pace parser.
- [x] Stop silently dropping generated points when a target is outside the representable range.
- [x] Reject a generated result when it is materially different from the requested target, with a clear unreachable-target message.
- [x] Add regression coverage for extreme slow and fast targets and output validity.

## 2. Reliable browser persistence

- [x] Centralise guarded browser-storage reads and writes in a small adapter.
- [x] Make generated-curve saving, reset-to-defaults, and one-off rounding conditional on successful persistence.
- [x] Preserve or restore the previous in-memory state when an explicit operation cannot be saved.
- [x] Show generator preference failures beside the generator rather than in Manage curves.
- [x] Add tests using a storage implementation that throws.

## 3. Human-readable UI structure

- [x] Extract the route-based pace-generator panel state, events, preview rendering, and chart interaction from `pacePageController.ts`.
- [x] Extract gradient-exposure panel rendering and hover interaction from `routePageController.ts`.
- [x] Keep the existing pure calculation modules (`paceGenerator.ts` and `gradientExposure.ts`) independent of the DOM.

## 4. Verification

- [x] Type-check and run the complete regression suite.
- [x] Run all browser smoke tests.
- [x] Run `git diff --check`.
- [x] Update this document with the completed outcome.

## Outcome

Completed. Pace generation now rejects unrepresentable or materially missed targets instead of creating a misleading curve. Related browser-storage writes are transactional where possible, explicit library actions restore their prior in-memory state on failure, and both large page controllers delegate their new feature-specific UI behavior to focused modules. Unit, regression, production-build, and browser smoke checks all pass.
