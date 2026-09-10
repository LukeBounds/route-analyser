import type { BuiltInPaceCurve } from './builtInPaceCurves.js';
import { escapeHtml } from './core.js';

export function routePageTemplate() {
    return `<main>
        <header>
            <nav class="page-nav" aria-label="Application pages"><a href="#route" data-page-link="route">Terrain analyser</a><a href="#pace" data-page-link="pace">Pace curve</a></nav>
            <p class="eyebrow">Route Analyser</p>
            <h1>Terrain analyser</h1>
            <p>Break GPX routes into useful climb, descent, flat, and rolling sections.</p>
        </header>
        <div id="route-page">
            <section class="panel">
                <h2>Route and settings</h2>
                <div class="controls">
                    <label>GPX route<input id="file" type="file" accept=".gpx,application/gpx+xml"></label>
                    <label>Grade threshold <output id="gradeOut">2%</output><input id="grade" type="range" min="1" max="12" step=".5" value="2"></label>
                    <label>Rolling window <output id="windowOut">500 m</output><input id="window" type="range" min="200" max="1500" step="50" value="500"></label>
                    <label>Minimum section <output id="minOut">150 m</output><input id="min" type="range" min="25" max="1000" step="25" value="150"></label>
                    <label>Flat/rolling bridge <output id="bridgeOut">300 m</output><input id="bridge" type="range" min="0" max="1500" step="25" value="300"></label>
                </div>
                <details><summary>How settings work</summary><ul><li><b>Grade threshold</b> is the sustained gradient classified as climbing or descending.</li><li><b>Rolling window</b> smooths the profile and sets the maximum span for a rolling section with internal uphill and downhill movements.</li><li><b>Minimum section</b> merges small fragments into their adjacent section.</li><li><b>Flat/rolling bridge</b> optionally joins same-direction climbs/descents across a short flat or rolling interruption that is also small compared with both adjacent sections.</li><li><b>Raw elevation gain and loss</b> use the original point-to-point terrain profile. Terrain-category totals use the displayed leaf-level subsections.</li></ul></details>
                <div id="analysis-progress" class="analysis-progress" role="status" aria-live="polite" hidden><span class="analysis-spinner" aria-hidden="true"></span><span id="analysis-progress-text">Analysing GPX…</span></div>
                <p id="status" aria-live="polite">Choose a GPX file to begin.</p>
                <p id="error" role="alert"></p>
                <div id="fill" hidden><p>This GPX has no complete elevation profile. Fill it with full-detail Mapterhorn terrain tiles; only tiles crossed by the route are requested. <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noreferrer">Attribution</a>.</p><button id="fillBtn">Fill terrain elevation</button></div>
            </section>
            <section id="result" hidden>
                <div class="result-head"><div><p class="eyebrow">Analysis</p><h2>Route breakdown</h2></div><button id="csv">Download sections CSV</button></div>
                <div id="stats"></div>
                <div id="plot-range"><label>View from <input id="view-start" type="number" min="0" step="0.01"> km</label><label>to <input id="view-end" type="number" min="0" step="0.01"> km</label><button id="view-full" type="button">Full route</button><span>Click a table row to focus its primary section.</span></div>
                <div class="legend"><span class="climb">● Climb</span><span class="descent">● Descent</span><span class="flat">● Flat</span><span class="rolling">● Rolling</span></div>
                <canvas id="chart" aria-label="Terrain colour coded elevation profile">The terrain sections and their numerical values are available in the table below.</canvas>
                <div class="table"><table><thead></thead><tbody id="rows"></tbody><tfoot id="section-summary"></tfoot></table></div>
            </section>
        </div>
    </main>`;
}

export function pacePageTemplate(curves: BuiltInPaceCurve[]) {
    const builtInOptions = curves
        .map(curve => `<option value="${escapeHtml(curve.key)}">${escapeHtml(curve.name)}</option>`)
        .join('');
    return `<section class="panel" id="pace-panel" hidden>
        <h2>Your pace curves</h2>
        <p>Create named curves for different effort levels or conditions. New browsers start with the built-in curves; curves and edits are stored only in this browser. Export your curve library for safe storage, then import the backup to restore it if your browser data is cleared.</p>
        <section class="pace-workspace-section">
            <div class="pace-section-header"><h3>View and compare</h3><p>Choose the curves and measurements shown on the comparison charts.</p></div>
            <fieldset class="curve-comparison">
                <legend>Chart comparison</legend><p>Select the saved curves to plot together.</p><div id="curve-comparison-list"></div>
                <div class="chart-series-controls"><label><input id="show-pace-curves" type="checkbox" checked> Pace chart</label><label><input id="show-speed-curves" type="checkbox" checked> Speed chart</label><label><input id="show-vam-curves" type="checkbox"> VAM overlays</label></div>
                <div id="curve-chart-legend"></div>
            </fieldset>
            <h3 id="pace-chart-heading">Pace comparison</h3>
            <canvas id="pace-chart" aria-label="Pace curve comparison">The selected curves' editable gradient points are listed in the Curve data table.</canvas>
            <p id="pace-note">Pace is min/km. VAM is vertical metres per hour.</p>
            <h3 id="speed-chart-heading">Speed comparison</h3>
            <canvas id="speed-chart" aria-label="Personal speed curve">The selected curves' editable gradient points are listed in the Curve data table.</canvas>
            <label class="vam-guides"><input type="checkbox"> Show VAM gridlines</label>
        </section>
        <section class="pace-workspace-section" id="pace-generator">
            <div class="pace-section-header"><h3>Generate from a route</h3><p>Scale the shape of an existing curve to meet a target time on the currently analysed route.</p></div>
            <p id="pace-generator-route" class="generator-route-summary">Upload and analyse a route on the Terrain analyser page to begin.</p>
            <fieldset id="pace-generator-controls" class="pace-generator-controls" disabled>
                <legend>Generator settings</legend>
                <label>Starting curve<select id="pace-generator-source"></select></label>
                <label>Target represents<select id="pace-generator-mode"><option value="elapsed">Elapsed time</option><option value="moving">Moving time</option></select></label>
                <fieldset class="generator-duration"><legend>Target time</legend><label>Hours<input id="pace-generator-target-hours" type="number" min="0" max="999" step="1" value="24"></label><label>Minutes<input id="pace-generator-target-minutes" type="number" min="0" max="59" step="1" value="0"></label></fieldset>
                <fieldset id="pace-generator-stopped" class="generator-duration"><legend>Expected stopped time</legend><label>Hours<input id="pace-generator-stop-hours" type="number" min="0" max="999" step="1" value="0"></label><label>Minutes<input id="pace-generator-stop-minutes" type="number" min="0" max="59" step="1" value="0"></label></fieldset>
                <label class="generator-option"><input id="pace-generator-preserve-flat" type="checkbox" checked> Keep the 0% gradient pace the same as the starting curve</label>
                <label class="generator-option"><input id="nice-curve-values" type="checkbox"> Nice-number rounding <span>Round generated pace values to the nearest 5 seconds and VAM values to the nearest 5 m/h.</span></label>
                <button id="preview-generated-curve" type="button">Generate preview</button>
            </fieldset>
            <p id="pace-generator-status" role="status"></p>
            <div id="pace-generator-preview" hidden>
                <div id="pace-generator-preview-stats" class="generator-preview-stats"></div>
                <p id="pace-generator-explanation"></p>
                <p id="pace-generator-warning" class="generator-warning" hidden></p>
                <section class="generator-chart-preview">
                    <div class="pace-section-header"><h4>Curve preview</h4><p>Compare the generated pace curve with its starting curve and any other saved curves before saving it.</p></div>
                    <div id="pace-generator-comparison-list" class="generator-comparison-list"></div>
                    <label class="generator-vam-option"><input id="pace-generator-show-vam" type="checkbox"> Show VAM overlays</label>
                    <div id="pace-generator-chart-legend" class="generator-chart-legend"></div>
                    <canvas id="pace-generator-chart" aria-label="Generated pace curve preview"></canvas>
                </section>
                <div class="generator-save"><label>Generated curve name<input id="pace-generator-name" type="text" maxlength="80"></label><button id="save-generated-curve" type="button">Save as new curve</button></div>
            </div>
        </section>
        <section class="pace-workspace-section">
            <div class="pace-section-header"><h3>Manage curves</h3><p>Create new curves and edit existing curves.</p></div>
            <div class="curve-library">
                <label>Curve to edit<select id="pace-curve-select"></select></label>
                <div class="curve-library-actions"><button id="new-pace-curve" type="button">New curve</button><button id="duplicate-pace-curve" type="button">Duplicate</button><button id="delete-pace-curve" type="button">Delete</button><button id="export-pace-curves" type="button">Export all</button><label class="file-button">Import backup<input id="import-pace-curves" type="file" accept=".json,application/json"></label><button id="reset-pace-curves" class="danger-action" type="button">Reset all to defaults</button></div>
                <p id="pace-library-status" role="status"></p>
            </div>
            <div id="pace-editor">
                <label class="pace-editor-name">Curve name<input id="pace-curve-name" type="text" maxlength="80"></label>
                <h3 class="curve-data-heading">Curve data</h3>
                <div class="curve-value-rounding"><strong>Nice-number rounding</strong><span>Round this curve’s pace values to the nearest 5 seconds and VAM values to the nearest 5 m/h.</span><button id="round-current-curve" class="secondary-action" type="button">Round current curve now</button></div>
                <table><thead><tr><th>Grade</th><th>Method</th><th>Pace / VAM</th><th></th></tr></thead><tbody></tbody></table>
                <div class="pace-editor-toolbar">
                    <div class="pace-editor-action"><strong>Grade points</strong><span>Add another gradient to the selected curve.</span><button id="add-pace-point" type="button">＋ Add grade point</button></div>
                    <div class="pace-editor-action built-in-loader"><strong>Load built-in values</strong><span>Replace the selected curve’s points with a built-in curve.</span><label>Built-in curve<select id="built-in-pace-select">${builtInOptions}</select></label><button id="load-built-in-pace" type="button">Load values</button></div>
                </div>
            </div>
        </section>
    </section>`;
}
