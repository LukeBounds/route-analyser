# Route Analyser refactor plan

This document records the August 2026 architecture review and provides a durable checklist for improving the application without losing its current behaviour.

## Overall assessment

The product model and technology choice are sound. Vite and plain TypeScript remain appropriate for a browser-only GitHub Pages application, and a framework rewrite is not currently justified.

The main issue is accumulation: `src/main.ts` owns page construction, global state, GPX parsing, terrain analysis, pace prediction, activity comparison, charts, tables, persistence, elevation lookup, and CSV export. These responsibilities should be separated into a small number of cohesive modules.

The refactor should preserve full-detail route analysis. Long-route support should be improved through safer iteration, clearer calculation boundaries, and eventually background processing—not by reducing calculation detail.

## Existing strengths to preserve

- Strict TypeScript compilation.
- No runtime framework dependencies and a small production bundle.
- Browser-local route processing and pace-curve storage.
- HTML escaping for route, waypoint, and pace-curve names.
- Validated, size-limited pace-curve backup imports.
- Correct handling of disconnected GPX chains and track-segment gaps.
- Visible activity route-match quality checks.
- Automated pull-request checks and GitHub Pages deployment.
- `src/core.ts` and `src/builtInPaceCurves.ts` already provide useful module boundaries.

## Prioritised findings

### 1. Terrain analysis is coupled to the DOM

The core terrain rules rely on global route state and directly read some page controls. `smooth(_w)` ignores its argument and reads the smoothing slider; `primarySections()` receives some settings as parameters but reads counter-slope controls directly.

Target: a pure `analyseTerrain(points, settings)` function returning the smoothed profile, primary sections, subsections, totals, and any calculation warnings.

### 2. Raw and smoothed elevation responsibilities are unclear

- Initial terrain classification uses smoothed elevation, while the flat/rolling revalidation step uses raw endpoint elevation.
- Waypoint segment elevation change and average grade currently use the smoothed profile, while terrain section elevation change and total ascent/descent use raw elevation.

Preferred rule unless later evidence suggests otherwise:

- Raw elevation for displayed endpoint elevation change and total ascent/descent.
- Smoothed elevation for local-gradient classification and pace prediction.
- If raw endpoint grade remains a rolling/flat sanity check, expose it as an explicit, documented rule.

Decision implemented: Waypoint Segment elevation change and Segment Average use the same endpoint elevations displayed in the Waypoints table. A named waypoint's GPX elevation takes precedence; if it is absent, the unsmoothed elevation of the snapped route point is used. Local Gradient continues to use the smoothed 100 m profile.

### 3. Tables are rendered and then mutated by column number

Terrain rows are rendered with base columns, predicted columns are appended later, and activity columns are removed and appended again. Subsection data is written using hard-coded cell indexes.

Target: create complete terrain and waypoint row view models, then render each table once from the current state.

### 4. Activity matching depends on point density

The route matcher constrains progress using route-point indexes rather than route distance. A 450-point window represents very different distances in sparse and high-detail files. Crossings and repeated paths can also produce spatially good but route-position-ambiguous matches.

Target: use distance-based matching windows and report ambiguous matches where geographically similar candidates represent substantially different route positions.

### 5. Page navigation reloads and loses analysis state

Hash changes currently reload the document. Moving to the pace page and back therefore loses the uploaded route and activity even though both pages are already built in the same application.

Target: use a small in-page hash router that toggles the route and pace workspaces without reloading.

### 6. Dark mode is incomplete

Newer light panels, cards, and selects are not covered by the base dark-mode rules. Some controls can inherit light text while retaining a white background.

Target: centralise theme colours as CSS custom properties and use them across all components and canvas renderers.

### 7. CSV text needs spreadsheet-formula protection

CSV quoting prevents malformed CSV but does not stop user-controlled names beginning with `=`, `+`, `-`, or `@` from being interpreted as formulas by spreadsheet software.

Target: use one shared CSV encoder and neutralise formula prefixes on user-controlled text.

### 8. Very detailed long files need safer processing

XML parsing, analysis, matching, and chart preparation run on the main thread. Route/activity uploads have no size guidance, and chart bounds currently use array spreading that can exceed the JavaScript argument limit on very large traces.

Target:

- Replace large array spreads with iterative bounds calculations.
- Add a point-count/file-size warning without rejecting legitimate long routes.
- Downsample chart rendering only, never calculations.
- Consider a Web Worker once the calculation modules are pure.

### 9. Styles and page templates are fragmented

Base CSS is minified into one line, more CSS is inline in `index.html`, and newer CSS lives in `pace.css`. Large HTML strings are subsequently rearranged or rewritten by JavaScript, including explanatory text with an outdated initial version.

Target: formatted stylesheets, stable page templates, and small UI components that do not immediately restructure their own generated DOM.

### 10. Core domain validation and persistence can be strengthened

- Pace backup validation checks basic types but not a practical gradient range or valid pace/VAM syntax.
- Browser pace-library storage is not versioned, making future migrations harder.
- `core.ts` combines geography, formatting, pace persistence, persistent runs, and route matching and will otherwise become another catch-all module.

## Proposed source layout

```text
src/
  main.ts                    Bootstrap and page routing
  domain/
    types.ts
    gpx.ts                   Route and activity XML parsing
    terrain.ts               Smoothing and terrain sections
    pace.ts                  Curve parsing, interpolation, prediction
    activity.ts              Moving time, matching, comparison
    elevation.ts             Mapterhorn adapter and tile decoding
  state/
    appState.ts
    paceLibrary.ts           Storage, import/export, migrations
  ui/
    routePage.ts
    pacePage.ts
    terrainTable.ts
    waypointTable.ts
  charts/
    terrainChart.ts
    curveComparisonChart.ts
    activityCharts.ts
  exports/
    csv.ts
  styles/
    base.css
    route.css
    pace.css
```

This is a direction rather than a requirement to create every file immediately. Prefer cohesive modules of a few hundred lines over one file per function.

## Implementation sequence

### Phase 1 — protect and extract terrain behaviour

- [x] Add synthetic regression fixtures for terrain classification.
- [x] Cover rolling detection, minimum-section absorption, flat/rolling bridges, counter-slope distance and reversal limits, smoothing, and subsection labels.
- [x] Add shared terrain types and `TerrainSettings`.
- [x] Extract a pure terrain analysis module.
- [x] Make the page consume the returned `TerrainAnalysis` without intentionally changing visible results.
- [x] Decide and test raw versus smoothed waypoint endpoint elevation semantics.

### Phase 2 — centralise pace calculations

- [x] Extract pace/VAM parsing and semantic validation.
- [x] Create one pace interpolator and cumulative route prediction used by route, waypoint, activity, and CSV calculations.
- [x] Create one local-gradient function used by terrain classification, terrain plots, activity samples, and all predictions.
- [x] Version the browser pace-library state and retain migration of saved multi-curve arrays. Obsolete standalone single-curve data is deliberately ignored so an otherwise fresh browser starts with the four built-ins.

### Phase 3 — make rendering deterministic

- [x] Introduce route, terrain-row, waypoint-row, and activity-comparison view models.
- [x] Render complete table headers and rows in one pass.
- [x] Remove numeric `row.cells[...]` dependencies.
- [x] Extract the route and pace page templates.
- [x] Replace page reload routing with workspace visibility changes.

Phase 3 result: `src/viewModels.ts` now derives route summaries and complete terrain/waypoint table rows before rendering, while `src/templates.ts` owns the stable route and pace workspace markup. Terrain and waypoint tables are regenerated from state when prediction or activity data changes; they are no longer extended or patched by cell position. Hash navigation changes workspace visibility and preserves the loaded route, selected zoom, pace result, and activity state.

### Phase 4 — extract and improve charts

- [x] Extract the terrain profile chart.
- [x] Share pace/speed comparison chart infrastructure.
- [x] Extract activity charts.
- [x] Add resize-driven redraws.
- [x] Replace large array spreads with iterative bounds calculations.
- [x] Preserve table/text alternatives and improve keyboard access where practical.

Phase 4 result: chart rendering now lives under `src/charts/`. Pace and speed use one configurable comparison renderer, activity charts share canvas preparation, and the terrain renderer owns its complete profile drawing path. Bounds are calculated by iteration rather than large function-argument spreads, including long activity match errors and joined GPX segments. Window and application-width changes schedule a redraw. Terrain table rows are keyboard-focusable and Enter/Space performs the same plot focus action as a click; canvas fallback text points to the corresponding tables and summaries.

### Phase 5 — hardening

- [x] Use a shared CSV encoder with formula-prefix protection.
- [x] Move Mapterhorn lookup behind an elevation-provider interface.
- [x] Change route matching to distance-based progress windows.
- [x] Detect and report ambiguous crossing/retrace matches.
- [x] Add large-file guidance and move heavy pure calculations to a Web Worker if profiling justifies it.
- [x] Complete dark-mode theming with CSS custom properties.
- [x] Format and consolidate styles.
- [x] Update the README to use the declared pnpm workflow consistently.

Phase 5 result: CSV generation now has one formula-safe encoder, elevation lookup is isolated behind a provider contract, and route matching uses metre-based progress windows with explicit ambiguity metrics for crossings and retraces. Large traces retain full detail and receive visible performance guidance. Current browser smoke testing and the bundled long route did not show UI blocking that justified the complexity of a worker; the pure calculation modules remain worker-ready if profiling of 100,000+ point traces later demonstrates a need. Page styles are consolidated out of `index.html`, share light/dark custom properties, and canvas renderers read the same theme. The README and CI now consistently use pnpm.

### Phase 6 — extract GPX and activity domains

- [x] Move route, waypoint, and recorded-activity GPX parsing out of `main.ts`.
- [x] Define shared route, waypoint, and activity point types at the parsing boundary.
- [x] Extract activity alignment, moving-time, interpolation, comparison, and gradient-sample calculations.
- [x] Add regression coverage for pause gaps, stationary-rest detection, interpolation, and comparison.
- [x] Keep file controls, status messages, and rendering in the page controller.

This phase addresses the remaining domain logic in `main.ts` without combining it with a simultaneous UI-controller rewrite. GPX parsing may use browser XML APIs, but it must not read application controls or mutate page state. Activity calculations must remain pure and independently testable.

Phase 6 result: `src/gpx.ts` now owns route, named-waypoint, and timestamped-activity XML extraction and defines the shared point types used by the application. `src/activity.ts` owns route alignment, moving-time filtering, predicted/actual interpolation, interval comparison, and actual gradient samples. `main.ts` supplies control values and presents errors but no longer implements those calculations. Regression fixtures cover recording gaps, optional stationary-rest removal, interpolation boundaries, comparisons, and 100 m actual-pace samples.

### Phase 7 — extract remaining domain and state preparation

- [x] Extract named-waypoint snapping, endpoint insertion, and duplicate-position merging.
- [x] Build route-analysis and activity-comparison CSV datasets outside the DOM controller.
- [x] Centralise pace-library and chart-preference state transitions and persistence preparation.
- [x] Add regression fixtures for each extracted boundary.
- [x] Leave rendering and browser event wiring for the dedicated UI-controller phase.

Phase 7 should reduce `main.ts` without prematurely mixing domain extraction with the larger route/pace controller split. Export modules return rows rather than initiating downloads, and state modules return results rather than writing status messages.

Phase 7 result: waypoint preparation now lives alongside waypoint geometry and returns snapped points plus ignored names. `src/exportData.ts` builds complete route and activity CSV datasets without reading controls or initiating downloads. `PaceLibraryModel` owns curve selection, naming, creation, duplication, deletion, import, comparison membership, chart visibility, and persistence/backup preparation; the page controller retains storage error messages, file interaction, and confirmation UI. Regression fixtures cover all three boundaries.

### Phase 8 — split browser controllers and finish bootstrap

- [x] Move pace-page DOM binding, persistence messages, and chart orchestration into a dedicated controller.
- [x] Move route-page DOM binding, file interaction, analysis orchestration, and table/chart rendering into a dedicated controller.
- [x] Reduce `main.ts` to application bootstrap, hash routing, and shared redraw scheduling.
- [x] Preserve page state and the pace-selection contract across both controllers.
- [x] Run the complete regression suite, production build, and bundled-route browser smoke test.

This phase completes the structural refactor without changing the terrain, pace, waypoint, activity, or export calculations. Controllers may read controls and update the DOM, but they consume the pure domain modules and expose only the small cross-page contracts needed by bootstrap code.

Phase 8 result: `src/pacePageController.ts` owns the pace-library controls, browser persistence, comparison charts, and the shared pace-selection interface. `src/routePageController.ts` owns route/activity file interaction, analysis controls, route state, result rendering, and route charts. `main.ts` is now a 50-line bootstrap that creates both controllers, switches hash-routed workspaces, and schedules responsive redraws. The bundled 101.91 km route, pace prediction, page switching, selected-curve synchronisation, full regression suite, and production build pass without browser console warnings.

### Phase 9 — automate the browser smoke test

- [x] Add a deterministic browser test that starts from clean browser storage.
- [x] Load the bundled 101.91 km route and verify terrain and waypoint analysis.
- [x] Run a prediction with a complete built-in pace curve and verify grouped table headers.
- [x] Switch between route and pace pages and verify route and selected-curve state are preserved.
- [x] Run the browser smoke test in pull-request CI alongside type-checks, regressions, and the production build.

This phase closes the final definition-of-done gap. The smoke test deliberately uses the bundled route rather than an external elevation request or user file, keeping it repeatable and independent of network services after dependencies are installed.

Phase 9 result: Playwright starts the production preview through Vite’s programmatic API, giving the test a deterministic lifecycle on local Windows development and Linux CI. A fresh Chromium context loads the bundled route, verifies terrain and waypoint results, selects the 24h curve, runs pace analysis, checks the grouped prediction columns, switches pages in both directions, and confirms route and curve state are retained. Pull-request CI installs only Chromium and runs this test after the full build. The structural refactor now meets its definition of done.

## Required regression coverage

Before intentionally changing terrain behaviour, add compact synthetic routes covering:

- Sustained climb, descent, and flat classification.
- Internally alternating rolling terrain versus merely surrounding up/down terrain.
- Two climbs joined across a qualifying flat/rolling bridge.
- The 25% adjoining-section bridge rule.
- A short counter-slope inside a longer climb or descent.
- Counter-slope distance and elevation-reversal percentage limits independently.
- Subsection band persistence and local versus bridged counter-slope labels.
- Duplicate-distance points and route endpoints.
- Smoothing set to zero and to the default 50 m.
- Raw total ascent/descent remaining independent of profile smoothing.
- Waypoint endpoint elevation semantics once explicitly decided.
- Sparse and dense representations of the same route producing equivalent activity matching.
- An activity on a crossing or repeated path producing either a correct match or an ambiguity warning.

The automated browser smoke test loads the bundled example, runs pace analysis, switches pages without losing route state, and verifies the expected table column groups in Chromium locally and in pull-request CI.

## Definition of done

The refactor is complete when:

- `main.ts` is primarily bootstrap/routing code.
- Domain calculations do not read or mutate DOM state.
- Route, waypoint, activity, and CSV calculations share the same gradient and pace functions.
- Tables are rendered from complete view models rather than modified by cell index.
- The current bundled example and regression fixtures produce intentional, documented results.
- Type-checks, unit tests, browser smoke tests, and the production build pass in CI.
