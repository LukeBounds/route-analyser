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
                <details><summary>How settings work</summary><ul><li><b>Grade threshold</b> is the sustained gradient classified as climbing or descending.</li><li><b>Rolling window</b> smooths the profile and sets the maximum span for a rolling section with internal uphill and downhill movements.</li><li><b>Minimum section</b> merges small fragments into their adjacent section.</li><li><b>Flat/rolling bridge</b> optionally joins same-direction climbs/descents across a short flat or rolling interruption that is also small compared with both adjacent sections.</li><li><b>Total ascent and descent</b> use the original terrain profile so small route undulations are retained.</li></ul></details>
                <p id="status">Choose a GPX file to begin.</p>
                <p id="error" role="alert"></p>
                <div id="fill" hidden><p>This GPX has no complete elevation profile. Fill it with full-detail Mapterhorn terrain tiles; only tiles crossed by the route are requested. <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noreferrer">Attribution</a>.</p><button id="fillBtn">Fill terrain elevation</button></div>
            </section>
            <section id="result" hidden>
                <div class="result-head"><div><p class="eyebrow">Analysis</p><h2>Route breakdown</h2></div><button id="csv">Download sections CSV</button></div>
                <div id="stats"></div>
                <div id="plot-range"><label>View from <input id="view-start" type="number" min="0" step="0.01"> km</label><label>to <input id="view-end" type="number" min="0" step="0.01"> km</label><button id="view-full" type="button">Full route</button><span>Click a table row to focus its primary section.</span></div>
                <div class="legend"><span class="climb">● Climb</span><span class="descent">● Descent</span><span class="flat">● Flat</span><span class="rolling">● Rolling</span></div>
                <canvas id="chart" aria-label="Terrain colour coded elevation profile">The terrain sections and their numerical values are available in the table below.</canvas>
                <div class="table"><table><thead></thead><tbody id="rows"></tbody></table></div>
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
        <section class="pace-workspace-section">
            <div class="pace-section-header"><h3>Manage curves</h3><p>Create new curves and edit existing curves.</p></div>
            <div class="curve-library">
                <label>Curve to edit<select id="pace-curve-select"></select></label>
                <div class="curve-library-actions"><button id="new-pace-curve" type="button">New curve</button><button id="duplicate-pace-curve" type="button">Duplicate</button><button id="delete-pace-curve" type="button">Delete</button><button id="export-pace-curves" type="button">Export all</button><label class="file-button">Import backup<input id="import-pace-curves" type="file" accept=".json,application/json"></label></div>
                <p id="pace-library-status" role="status"></p>
            </div>
            <div id="pace-editor">
                <label class="pace-editor-name">Curve name<input id="pace-curve-name" type="text" maxlength="80"></label>
                <h3 class="curve-data-heading">Curve data</h3>
                <table><thead><tr><th>Grade</th><th>Method</th><th>Pace / VAM</th><th></th></tr></thead><tbody></tbody></table>
                <div class="pace-editor-toolbar">
                    <div class="pace-editor-action"><strong>Grade points</strong><span>Add another gradient to the selected curve.</span><button id="add-pace-point" type="button">＋ Add grade point</button></div>
                    <div class="pace-editor-action built-in-loader"><strong>Load built-in values</strong><span>Replace the selected curve’s points with a built-in curve.</span><label>Built-in curve<select id="built-in-pace-select">${builtInOptions}</select></label><button id="load-built-in-pace" type="button">Load values</button></div>
                </div>
            </div>
        </section>
    </section>`;
}
