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
- Existing single-curve browser data is migrated automatically the first time the named curve library is loaded.

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
- Activity comparison is shown only when the route match passes visible distance-quality checks. Reverse-direction activities are detected and rejected rather than silently misaligned.

## Source layout

- `src/core.ts` contains reusable, DOM-independent distance, formatting, persistence, and route-matching calculations.
- `src/terrain.ts` contains the DOM-independent terrain smoothing, classification, bridging, and subsection engine.
- `src/main.ts` currently owns browser state, GPX XML extraction, charts, tables, and exports; the staged split is tracked in `REFACTOR.md`.
- `tests/core.test.ts` and `tests/terrain.test.ts` contain regression coverage for the calculation core and terrain rules.

## Getting started

```powershell
npm install
npm run dev
```

Run all compiler and regression checks with:

```powershell
npm run check
```

## GitHub Pages deployment

The Pages workflow builds and deploys the application whenever `main` is pushed, and it can also be started manually from the Actions tab. The Vite base path is derived from `GITHUB_REPOSITORY`, so a normal project repository is published below `/<repository>/` while local development continues to use `/`.

For the first deployment:

1. Create the GitHub repository and add it as this repository's remote.
2. Push `main` to GitHub.
3. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Run **Deploy to GitHub Pages** from the Actions tab, or push another commit to `main`.
