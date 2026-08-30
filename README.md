# Route Analyser

Route Analyser turns GPX routes into climb, descent, rolling, and flat sections, then applies a personal gradient-to-pace curve to predict section and route times.

## Product flow

1. Import a GPX route.
2. Use its embedded elevations or enrich it from Mapterhorn terrain tiles.
3. Segment the route by terrain type.
4. Enter or edit a personal pace curve by gradient.
5. Calculate section splits and predicted total time.

The app also includes **Bob Graham — Luke’s Version** as a bundled example route. It can be loaded from the route settings without choosing a local file.

## Pace curves

- New browsers start with four built-in curves: **21h**, **24h**, **Optimistic**, and **24h Slower Downhill**.
- Any built-in curve can be loaded into the selected editable curve without affecting other saved curves.
- Create, duplicate, rename, and delete multiple named pace curves in the browser.
- Compare any selection of saved curves on shared pace and speed charts; optionally add dashed VAM overlays.
- Select the curve used for route and recorded-activity predictions from the route results.
- Export the complete curve library as a JSON backup and import it later. Imports add validated curves without replacing existing ones.
- Existing saved multi-curve libraries are retained and migrated to versioned storage. Obsolete standalone single-curve data is ignored so browsers without a current library start with the four built-ins.

## Principles

- Keep GPX analysis in the browser where possible.
- Treat elevation providers as replaceable adapters.
- Make section thresholds and pace assumptions visible and editable.
- Prefer stable, meaningful sections over noisy elevation changes.

## GPX handling

- Adjacent GPX track segments are joined only when their endpoints are within 100 m.
- Disconnected parts are not connected by an artificial straight-line leg; the longest continuous route chain is analysed and the page reports discarded parts.
- Activity recording gaps between `<trkseg>` elements do not add distance or moving time.
- Named waypoints more than 250 m from the analysed route are ignored and reported.
- Activity matching advances through route-distance windows rather than point-count windows, so sparse and dense versions of the same route behave consistently.
- Activity comparison is shown only when the route match passes visible distance-quality and ambiguity checks. Reverse-direction activities are detected and rejected rather than silently misaligned; repeated or retraced paths are reported as route-position ambiguous.
- Routes with at least 100,000 points or files of at least 25 MB retain full detail but show guidance that analysis and chart updates may take longer.

## Source layout

- `src/core.ts` contains reusable, DOM-independent distance, formatting, persistence, and route-matching calculations.
- `src/terrain.ts` contains the DOM-independent terrain smoothing, classification, bridging, and subsection engine.
- `src/gpx.ts` parses route, named-waypoint, and timestamped-activity GPX data and defines their shared point types.
- `src/activity.ts` contains DOM-independent activity alignment, moving-time, interpolation, comparison, and gradient-sample calculations.
- `src/waypoints.ts` snaps and merges named waypoints, adds route endpoints, and defines shared segment geometry.
- `src/pace.ts` contains pace/VAM parsing, validation, interpolation, and cumulative route prediction.
- `src/paceLibrary.ts` defines pace-library state transitions, chart preferences, versioned storage, backup preparation, and migration.
- `src/viewModels.ts` derives route summaries and complete terrain and waypoint rows independently of the DOM.
- `src/templates.ts` contains the stable route and pace workspace templates.
- `src/charts/` contains shared canvas utilities plus the terrain, curve-comparison, and recorded-activity renderers.
- `src/elevation.ts` defines the replaceable elevation-provider boundary and the current Mapterhorn adapter.
- `src/csv.ts` provides the shared CSV encoder, download handling, and spreadsheet-formula protection.
- `src/exportData.ts` builds complete route-analysis and activity-comparison CSV datasets independently of the DOM.
- `src/largeTrace.ts` centralises large-route and large-activity guidance thresholds.
- `src/pacePageController.ts` owns pace-page controls, browser persistence messages, comparison charts, and the pace-selection interface shared with route analysis.
- `src/routePageController.ts` owns route/activity file interaction, analysis controls, result rendering, and route-specific charts.
- `src/main.ts` is the application bootstrap: it creates the two page controllers, handles hash routing, and coordinates responsive redraws.
- `tests/*.test.ts` contains regression coverage for the calculation core, terrain rules, waypoint geometry, pace prediction, pace-library migration, view models, page-template invariants, and long-input chart bounds.

## Getting started

```powershell
pnpm install
pnpm dev
```

Run all compiler and regression checks with:

```powershell
pnpm check
```

Create the production build with `pnpm build` and preview it locally with `pnpm preview`.

## GitHub Pages deployment

The Pages workflow builds and deploys the application whenever `main` is pushed, and it can also be started manually from the Actions tab. The Vite base path is derived from `GITHUB_REPOSITORY`, so a normal project repository is published below `/<repository>/` while local development continues to use `/`.

For the first deployment:

1. Create the GitHub repository and add it as this repository's remote.
2. Push `main` to GitHub.
3. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Run **Deploy to GitHub Pages** from the Actions tab, or push another commit to `main`.
