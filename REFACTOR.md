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
- [ ] Decide and test raw versus smoothed endpoint elevation semantics.

### Phase 2 — centralise pace calculations

- [ ] Extract pace/VAM parsing and semantic validation.
- [ ] Create one pace interpolator used by route, waypoint, activity, and CSV calculations.
- [ ] Create one local-gradient function used by terrain plots and all predictions.
- [ ] Version the browser pace-library state and retain legacy migration.

### Phase 3 — make rendering deterministic

- [ ] Introduce route, terrain-row, waypoint-row, and activity-comparison view models.
- [ ] Render complete table headers and rows in one pass.
- [ ] Remove numeric `row.cells[...]` dependencies.
- [ ] Extract the route and pace page templates.
- [ ] Replace page reload routing with workspace visibility changes.

### Phase 4 — extract and improve charts

- [ ] Extract the terrain profile chart.
- [ ] Share pace/speed comparison chart infrastructure.
- [ ] Extract activity charts.
- [ ] Add resize-driven redraws.
- [ ] Replace large array spreads with iterative bounds calculations.
- [ ] Preserve table/text alternatives and improve keyboard access where practical.

### Phase 5 — hardening

- [ ] Use a shared CSV encoder with formula-prefix protection.
- [ ] Move Mapterhorn lookup behind an elevation-provider interface.
- [ ] Change route matching to distance-based progress windows.
- [ ] Detect and report ambiguous crossing/retrace matches.
- [ ] Add large-file guidance and move heavy pure calculations to a Web Worker if profiling justifies it.
- [ ] Complete dark-mode theming with CSS custom properties.
- [ ] Format and consolidate styles.
- [ ] Update the README to use the declared pnpm workflow consistently.

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

Add a small browser smoke test for loading the bundled example, running pace analysis, switching pages without losing route state, and rendering the expected table column groups.

## Definition of done

The refactor is complete when:

- `main.ts` is primarily bootstrap/routing code.
- Domain calculations do not read or mutate DOM state.
- Route, waypoint, activity, and CSV calculations share the same gradient and pace functions.
- Tables are rendered from complete view models rather than modified by cell index.
- The current bundled example and regression fixtures produce intentional, documented results.
- Type-checks, unit tests, browser smoke tests, and the production build pass in CI.
