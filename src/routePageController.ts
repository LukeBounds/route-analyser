import { drawActivityComparisonChart, drawActivityGradientChart } from './charts/activityCharts';
import { drawTerrainProfile, terrainDistanceAt } from './charts/terrainProfileChart';
import {
    escapeHtml,
    formatDuration,
    formatPace,
    isConfidentRouteMatch,
    type RouteMatchQuality,
} from './core';
import {
    alignActivityToRoute,
    calculateActivityMovingTime,
    compareActivityTimes,
    createActivityGradientSamples,
    interpolateActivityMovingTime,
    interpolateRouteCumulativeTime,
    type ActivityPoint,
} from './activity';
import { downloadCsv } from './csv';
import { buildActivityComparisonCsv, buildRouteAnalysisCsv } from './exportData';
import { createMapterhornProvider } from './elevation';
import { largeTraceGuidance } from './largeTrace';
import {
    parseActivityGpx,
    parseRouteGpx,
    type NamedWaypoint,
    type ParsedRoute,
    type RecordedActivityPoint,
    type RoutePoint,
} from './gpx';
import { createPaceInterpolator, predictRoutePace, type RoutePacePrediction } from './pace';
import type { PacePageController } from './pacePageController';
import { analyseTerrain, localGradeAtDistance } from './terrain';
import type {
    PrimaryTerrainSection as M,
    TerrainKind as K,
    TerrainSection as S,
} from './terrain';
import { snapNamedWaypoints, waypointSegmentGeometry, type SnappedWaypoint } from './waypoints';
import {
    createTerrainRows,
    createTerrainSummary,
    createRouteViewModel,
    createWaypointSegmentRows,
    type ActivityComparisonViewModel,
    type ActivityViewAccessor,
    type PaceMetricsViewModel,
    type TerrainRowViewModel,
    type TerrainAggregateViewModel,
    type WaypointSegmentsViewModel,
} from './viewModels';

export interface RoutePageController {
    readonly page: HTMLElement;
    redraw(): void;
}

export function createRoutePageController(A: HTMLDivElement, paceController: PacePageController): RoutePageController {
let paceEstimate: {
    total: number;
    sections: number[];
} | null = null;
const collapsedPrimary = new Set<number>();
type P = RoutePoint;
type W = NamedWaypoint;
type RouteWaypoint = SnappedWaypoint;
let activity: ActivityPoint[] = [], routePrediction: RoutePacePrediction | null = null, activityMatchQuality: RouteMatchQuality | null = null;
const C: Record<K, string> = { climb: '#c84735', descent: '#31805a', flat: '#607183', rolling: '#b67812' };
const elevationProvider = createMapterhornProvider();
let p: P[] = [], waypoints: W[] = [], routeName = '', routeWaypoints: RouteWaypoint[] = [], ss: S[] = [], ms: M[] = [], tot = { up: 0, down: 0 }, profile: number[] = [], routeWarnings: string[] = [], hovered: number | null = null, hoverDistance: number | null = null, selectionStart: number | null = null, selectionEnd: number | null = null, viewStart = 0, viewEnd = Infinity;
function routeWaypointGeometry(start: RouteWaypoint, end: RouteWaypoint) {
    return waypointSegmentGeometry(
        p,
        { index: start.index, elevation: start.waypoint.ele },
        { index: end.index, elevation: end.waypoint.ele },
    );
}
function hasTerrainChildren(section: M) {
    return (section.k === 'climb' || section.k === 'descent') && section.c.length > 0;
}
const $ = <T extends Element>(x: string) => document.querySelector<T>(x)!, $f = $('#file') as HTMLInputElement, status = $('#status'), error = $('#error'), fill = $('#fill') as HTMLElement, result = $('#result') as HTMLElement, chart = $('#chart') as HTMLCanvasElement;
status.textContent = 'Choose a GPX file or load an example route to begin.';
const waypointPanel = document.createElement('section');
waypointPanel.className = 'table';
waypointPanel.id = 'waypoints';
waypointPanel.hidden = true;
waypointPanel.innerHTML = '<details><summary>Waypoints</summary><p class="waypoint-warning" hidden></p><table><thead><tr><th>Name</th><th>Route distance</th><th>Elevation</th></tr></thead><tbody></tbody></table></details>';
result.append(waypointPanel);
result.querySelector('.result-head h2')!.textContent = 'Terrain-derived sections';
const waypointAnalysisHeading = document.createElement('h2');
waypointAnalysisHeading.className = 'analysis-divider';
waypointAnalysisHeading.textContent = 'Waypoint-defined analysis';
const waypointAnalysisNote = document.createElement('p');
waypointAnalysisNote.className = 'waypoint-note';
waypointAnalysisNote.textContent = 'Only GPX waypoints with a name are included here. Start and End are added automatically so the segment analysis covers the full route. A waypoint’s own elevation is used when available; otherwise its unsmoothed route elevation is used.';
result.insertBefore(waypointAnalysisHeading, waypointPanel);
result.insertBefore(waypointAnalysisNote, waypointPanel);
const waypointSegmentPanel = document.createElement('section');
waypointSegmentPanel.className = 'table';
waypointSegmentPanel.id = 'waypoint-segments';
waypointSegmentPanel.hidden = true;
result.append(waypointSegmentPanel);
const predictionPanel = document.createElement('section');
predictionPanel.className = 'prediction';
predictionPanel.hidden = true;
result.insertBefore(predictionPanel, result.querySelector('#plot-range'));
const activityControl = document.createElement('label');
activityControl.className = 'activity-input';
activityControl.innerHTML = 'Recorded activity GPX<input id="activity-file" type="file" accept=".gpx,application/gpx+xml"><small>Requires timestamped track points. It can also be analysed as its own route.</small>';
const pauseControl = document.createElement('label');
pauseControl.className = 'activity-input';
pauseControl.innerHTML = 'Recording gap cutoff<input id="activity-pause" type="number" min="5" max="1800" step="5" value="120"> seconds<small>Timestamp gaps longer than this are excluded from moving time.</small>';
const restDetectionControl = document.createElement('label');
restDetectionControl.className = 'activity-input checkbox-control';
restDetectionControl.innerHTML = '<input id="activity-rest-detection" type="checkbox"> Detect stationary rests';
const movingSpeedControl = document.createElement('label');
movingSpeedControl.className = 'activity-input';
movingSpeedControl.innerHTML = 'Minimum moving speed<input id="activity-moving-speed" type="number" min="0.1" max="5" step="0.1" value="0.5"> km/h<small>Uses a 30-second window when stationary-rest detection is enabled.</small>';
$('.controls').append(activityControl, pauseControl, restDetectionControl, movingSpeedControl);
const activityFile = activityControl.querySelector('input')!, activityPause = pauseControl.querySelector('input') as HTMLInputElement, activityRestDetection = restDetectionControl.querySelector('input') as HTMLInputElement, activityMovingSpeed = movingSpeedControl.querySelector('input') as HTMLInputElement;
activityMovingSpeed.disabled = true;
const activityPanel = document.createElement('section');
activityPanel.className = 'prediction';
activityPanel.id = 'activity-analysis';
activityPanel.hidden = true;
result.insertBefore(activityPanel, result.querySelector('#plot-range'));
const paceAnalysisButton = document.createElement('button');
paceAnalysisButton.type = 'button';
paceAnalysisButton.id = 'run-pace-analysis';
paceAnalysisButton.textContent = 'Run pace analysis';
const analysisCurveControl = document.createElement('label');
analysisCurveControl.className = 'analysis-curve-control';
analysisCurveControl.innerHTML = 'Curve <select id="analysis-curve-select" aria-label="Pace curve for route analysis"></select>';
const subsectionToggleButton = document.createElement('button');
subsectionToggleButton.type = 'button';
subsectionToggleButton.id = 'toggle-subsections';
subsectionToggleButton.className = 'secondary-action';
const resultActions = document.createElement('div');
resultActions.className = 'result-actions';
const actionGroup = (label: string, className: string, ...controls: Element[]) => {
    const group = document.createElement('div');
    group.className = `result-action-group ${className}`;
    const heading = document.createElement('span');
    heading.className = 'result-action-label';
    heading.textContent = label;
    group.append(heading, ...controls);
    return group;
};
const csvButton = result.querySelector<HTMLButtonElement>('#csv')!;
csvButton.classList.add('secondary-action');
const paceActionGroup = actionGroup('Pace analysis', 'pace-analysis-actions', analysisCurveControl, paceAnalysisButton);
const exportActionGroup = actionGroup('Export', 'export-actions', csvButton);
resultActions.append(paceActionGroup, exportActionGroup);
result.querySelector('.result-head')!.append(resultActions);
const terrainTableToolbar = document.createElement('div');
terrainTableToolbar.className = 'terrain-table-toolbar';
terrainTableToolbar.innerHTML = '<div><h3>Sections table</h3><p>Net change uses each section’s unsmoothed endpoints. Profile elevation gain and loss sum point-to-point changes in the displayed profile after the selected smoothing. Summary totals use leaf-level subsections, with ungrouped flat and rolling sections counted directly.</p></div>';
subsectionToggleButton.setAttribute('aria-controls', 'rows');
terrainTableToolbar.append(subsectionToggleButton);
const terrainTable = result.querySelector('#rows')!.closest('.table')!;
result.insertBefore(terrainTableToolbar, terrainTable);
paceAnalysisButton.onclick = () => runPaceAnalysis();
subsectionToggleButton.onclick = () => { const hasCollapsed = ms.some((section, index) => hasTerrainChildren(section) && collapsedPrimary.has(index)); ms.forEach((section, index) => hasTerrainChildren(section) && (hasCollapsed ? collapsedPrimary.delete(index) : collapsedPrimary.add(index))); renderTerrainTable(); syncSubsectionToggle(); };
const routePage = A.querySelector<HTMLElement>('#route-page')!;
const curvePoints = () => paceController.resolvedPoints;
const activePaceCurve = () => paceController.activeCurve;
const analysisCurveSelect = analysisCurveControl.querySelector<HTMLSelectElement>('select')!;
paceController.bindAnalysisSelect(analysisCurveSelect, () => {
    if (paceEstimate && p.length && p.every(point => point.ele !== null)) {
        if (curvePoints().length >= 2)
            runPaceAnalysis();
        else
            analyse();
    }
});
const viewStartInput = $('#view-start') as HTMLInputElement, viewEndInput = $('#view-end') as HTMLInputElement;
viewStartInput.step = viewEndInput.step = '.1';
const colourControl = document.createElement('label');
colourControl.innerHTML = `Plot colours <select id="plot-colours"><option value="sections">Terrain sections</option><option value="gradient">Local gradient</option></select>`;
const waypointControl = document.createElement('label');
waypointControl.innerHTML = `<input id="show-waypoints" type="checkbox" checked> Show named points`;
$('#plot-range').prepend(colourControl, waypointControl);
$('#plot-range span').textContent = 'Drag across the plot to zoom, or click a table row to focus its primary section.';
const subsectionLegend = document.createElement('span');
subsectionLegend.textContent = '◌ Sub-section boundary';
const waypointLegend = document.createElement('span');
waypointLegend.className = 'waypoint-legend';
waypointLegend.textContent = '● Named route point';
$('.legend').append(subsectionLegend, waypointLegend);
const plotColours = $('#plot-colours') as HTMLSelectElement, showWaypoints = $('#show-waypoints') as HTMLInputElement;
plotColours.onchange = () => draw(profile);
showWaypoints.onchange = () => draw(profile);
const panControl = document.createElement('label');
panControl.innerHTML = `Scroll zoomed view <input id="plot-pan" type="range" min="0" step="10">`;
$('#plot-range').append(panControl);
const plotPan = $('#plot-pan') as HTMLInputElement;
function syncPan() { if (!p.length)
    return; const total = p.at(-1)!.d, span = viewEnd - viewStart; panControl.hidden = span >= total - 1; plotPan.max = String(Math.max(0, total - span)); plotPan.value = String(viewStart); }
function setView(start: number, end: number) { const total = p.at(-1)!.d; if (!Number.isFinite(start) || !Number.isFinite(end))
    return; viewStart = Math.max(0, Math.min(start, total)); viewEnd = Math.max(viewStart + 1, Math.min(end, total)); viewStartInput.value = (viewStart / 1000).toFixed(2); viewEndInput.value = (viewEnd / 1000).toFixed(2); syncPan(); draw(profile); }
plotPan.oninput = () => { const span = viewEnd - viewStart; setView(Number(plotPan.value), Number(plotPan.value) + span); };
viewStartInput.onchange = () => setView(Number(viewStartInput.value) * 1000, viewEnd);
viewEndInput.onchange = () => setView(viewStart, Number(viewEndInput.value) * 1000);
$('#view-full').addEventListener('click', () => setView(0, p.at(-1)!.d));
for (const [id, unit] of [['grade', '%'], ['window', ' m'], ['min', ' m'], ['bridge', ' m']] as const) {
    const el = $(`#${id}`) as HTMLInputElement;
    el.oninput = () => { $(`#${id}Out`).textContent = el.value + unit; if (p.length && p.every(x => x.ele !== null))
        analyse(); };
}
const counterControl = document.createElement('label');
counterControl.className = 'checkbox-control';
counterControl.innerHTML = `<input id="counter-bridge" type="checkbox" checked> Bridge short counter-slopes`;
const counterLengthControl = document.createElement('label');
counterLengthControl.innerHTML = `Counter-slope bridge <output id="counterBridgeOut">250 m</output><input id="counter-bridge-length" type="range" min="0" max="1000" step="25" value="250">`;
const gradientWindowControl = document.createElement('label');
gradientWindowControl.innerHTML = `Local gradient window <output id="gradientWindowOut">50 m</output><input id="gradient-window" type="range" min="25" max="200" step="25" value="50">`;
const smoothingControl = document.createElement('label');
smoothingControl.innerHTML = `Profile smoothing <output id="smoothingOut">50 m</output><input id="smoothing" type="range" min="0" max="300" step="10" value="50">`;
$('.controls').append(counterControl, counterLengthControl, gradientWindowControl, smoothingControl);
const counterBridge = $('#counter-bridge') as HTMLInputElement, counterBridgeLength = $('#counter-bridge-length') as HTMLInputElement, localGradientWindow = $('#gradient-window') as HTMLInputElement, profileSmoothing = $('#smoothing') as HTMLInputElement;
counterBridge.onchange = () => { if (p.length && p.every(x => x.ele !== null))
    analyse(); };
counterBridgeLength.oninput = () => { $('#counterBridgeOut').textContent = `${counterBridgeLength.value} m`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
profileSmoothing.oninput = () => { $('#smoothingOut').textContent = `${profileSmoothing.value} m`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
localGradientWindow.oninput = () => { $('#gradientWindowOut').textContent = `${localGradientWindow.value} m`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
const settingsExplanation = document.querySelector('details ul')!;
settingsExplanation.children[1].innerHTML = '<b>Rolling window</b> sets the maximum span considered at one time when detecting internally alternating uphill and downhill terrain. Overlapping rolling spans may combine into a longer rolling section.';
settingsExplanation.children[4].innerHTML = '<b>Raw elevation gain and loss</b> sum every change in the unsmoothed point-to-point elevation profile, so small undulations—and any elevation noise—are retained. Terrain-category totals use the displayed leaf-level subsections instead.';
settingsExplanation.children[0].insertAdjacentHTML('afterend', '<li><b>Local gradient window</b> sets the distance used to measure local slope for terrain classification, profile gradients and pace prediction. Shorter values preserve sharper transitions but are more sensitive to elevation noise.</li>');
settingsExplanation.insertAdjacentHTML('beforeend', '<li><b>Profile smoothing</b> averages elevations over the selected distance before plotting and classifying terrain. Lower values preserve shorter features but may reveal more elevation noise. It does not affect raw elevation gain or loss.</li><li><b>Bridge short counter-slopes</b> keeps a sustained climb or descent together across a short interruption in the opposite direction, subject to its separate distance and reversal limits.</li>');
const counterReversalControl = document.createElement('label');
counterReversalControl.innerHTML = `Counter-slope reversal <output id="counterReversalOut">5%</output><input id="counter-reversal" type="range" min="0" max="20" step=".5" value="5">`;
$('.controls').append(counterReversalControl);
const counterReversal = $('#counter-reversal') as HTMLInputElement;
counterReversal.oninput = () => { $('#counterReversalOut').textContent = `${counterReversal.value}%`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
settingsExplanation.insertAdjacentHTML('beforeend', '<li><b>Counter-slope reversal</b> allows a short opposing rise/fall when it is no more than this percentage of the combined elevation change in the neighbouring sections.</li>');
const criteria = document.createElement('details');
criteria.innerHTML = `<summary>How sections are decided</summary><h3>Primary sections</h3><ul><li>Local slope is measured over the selected Local gradient window, after elevation smoothing at the selected Profile smoothing distance.</li><li>It is a climb or descent at or beyond the grade threshold; otherwise it starts as flat.</li><li>Nearby uphill and downhill movements become rolling when a span within the rolling window contains both directions and has little net change. Overlapping spans may combine into a longer rolling section.</li><li>Fragments shorter than Minimum section are absorbed into a neighbour.</li><li>Same-direction primary sections may be joined across a short flat/rolling bridge or an enabled short counter-slope. A flat/rolling bridge must be no more than 25% of either adjoining section.</li></ul><h3>Sub-sections</h3><ul><li>Local gradients below the grade threshold become sub-rolling. At or above the threshold, gentle is below threshold + 3%, moderate is below threshold + 7%, and steep is at or above threshold + 7%.</li><li>A band change must persist for at least Minimum section before it becomes a new sub-section.</li><li>Each child’s displayed elevation change and label use its own unsmoothed end-to-end elevation change. Unsmoothed means the elevations supplied by the GPX or filled from Mapterhorn. Opposite-direction children are marked local counter-slope or bridged counter-slope.</li></ul>`;
document.querySelector('details')!.insertAdjacentElement('afterend', criteria);
criteria.querySelector('ul')!.insertAdjacentHTML('beforeend', '<li>A counter-slope bridge must meet its distance limit and have a reversal no greater than the Counter-slope reversal percentage of the adjoining sections’ combined elevation change. Flat/rolling bridges still use the 25% distance rule.</li>');
criteria.querySelectorAll('ul')[1].insertAdjacentHTML('beforeend', '<li><b>Why a local counter-slope is not necessarily a primary section:</b> the parent direction comes from the smoothed local slope, then short primary fragments are merged. A child is labelled from its own unsmoothed end-to-end elevation change afterwards. So a small uphill can appear within a descent without ever becoming a standalone primary climb. The counter-slope bridge limits apply only when the primary analysis produced two same-direction sections separated by an opposite-direction section.</li>');
const settingsControls = $('.controls');
settingsControls.classList.add('settings-groups');
const settingsGroup = (title: string, ...items: Element[]) => { const group = document.createElement('fieldset'); group.className = 'settings-group'; group.innerHTML = `<legend>${title}</legend>`; items.forEach(item => group.append(item)); return group; }, routeFile = $f.closest('label')!, gradeControl = $('#grade').closest('label')!, windowControl = $('#window').closest('label')!, minimumControl = $('#min').closest('label')!, bridgeControl = $('#bridge').closest('label')!;
const exampleRoutes: Record<string, { name: string; path: string }> = {
    'bob-graham-lukes-version': { name: 'Bob Graham — Luke’s Version', path: 'examples/bob-graham-lukes-version.gpx' },
};
const exampleRouteControl = document.createElement('div');
exampleRouteControl.className = 'example-route-control';
exampleRouteControl.innerHTML = '<label>Example route<select id="example-route"><option value="">Choose an example…</option><option value="bob-graham-lukes-version">Bob Graham — Luke’s Version</option></select></label><button id="load-example-route" type="button" disabled>Load example</button><small>Bundled with the app, including its elevation profile and named waypoints.</small>';
const exampleRouteSelect = exampleRouteControl.querySelector('select')!, exampleRouteButton = exampleRouteControl.querySelector('button')!;
exampleRouteSelect.onchange = () => exampleRouteButton.disabled = !exampleRouteSelect.value;
exampleRouteButton.onclick = async () => {
    const example = exampleRoutes[exampleRouteSelect.value];
    if (!example)
        return;
    exampleRouteButton.disabled = true;
    status.textContent = `Loading ${example.name}…`;
    try {
        const response = await fetch(new URL(example.path, document.baseURI));
        if (!response.ok)
            throw Error(`The example route could not be loaded (${response.status}).`);
        $f.value = '';
        loadRouteText(await response.text(), example.name);
    }
    catch (problem) {
        error.textContent = problem instanceof Error ? problem.message : 'The example route could not be loaded.';
    }
    finally {
        exampleRouteButton.disabled = false;
    }
};
settingsControls.replaceChildren(settingsGroup('Route', routeFile, exampleRouteControl), settingsGroup('Recorded activity', activityControl, pauseControl, restDetectionControl, movingSpeedControl), settingsGroup('Terrain classification', gradeControl, gradientWindowControl, smoothingControl, windowControl, minimumControl), settingsGroup('Joining interruptions', bridgeControl, counterControl, counterLengthControl, counterReversalControl));
function setParsedRoute(parsed: ParsedRoute) {
    p = parsed.points;
    waypoints = parsed.waypoints;
    routeWarnings = parsed.warnings;
    profile = [];
    routeWaypoints = [];
    renderWaypoints();
}
function loadRouteText(text: string, name: string, fileBytes = new Blob([text]).size) {
    error.textContent = '';
    fill.hidden = true;
    result.hidden = true;
    activity = [];
    activityMatchQuality = null;
    paceEstimate = null;
    routePrediction = null;
    activityFile.value = '';
    activityPanel.hidden = true;
    routeName = name;
    const parsed = parseRouteGpx(text), largeTraceWarning = largeTraceGuidance('route', parsed.points.length, fileBytes);
    if (largeTraceWarning)
        parsed.warnings.push(largeTraceWarning);
    setParsedRoute(parsed);
    if (p.every(x => x.ele !== null))
        analyse();
    else {
        status.textContent = `${routeName}: ${p.length.toLocaleString()} points found, but no complete elevation profile.${routeWarnings.length ? ` ${routeWarnings.join(' ')}` : ''}`;
        fill.hidden = false;
    }
}
$f.onchange = async () => { const f = $f.files?.[0]; if (!f)
    return; try {
    exampleRouteSelect.value = '';
    exampleRouteButton.disabled = true;
    loadRouteText(await f.text(), f.name, f.size);
}
catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Could not read GPX.';
} };
function renderWaypoints() {
    routeWaypoints = [];
    if (!p.length) {
        waypointPanel.hidden = true;
        return;
    }
    const snapped = snapNamedWaypoints(p, waypoints);
    routeWaypoints = snapped.points;
    waypointPanel.hidden = false;
    const warning = waypointPanel.querySelector<HTMLElement>('.waypoint-warning')!;
    warning.hidden = !snapped.ignoredNames.length;
    warning.textContent = snapped.ignoredNames.length ? `${snapped.ignoredNames.length} named ${snapped.ignoredNames.length === 1 ? 'waypoint was' : 'waypoints were'} ignored because the nearest route point was more than 250 m away: ${snapped.ignoredNames.join(', ')}.` : '';
    waypointPanel.querySelector('tbody')!.innerHTML = routeWaypoints.map(({ waypoint, index }) => { const point = p[index], elevation = waypoint.ele ?? point.ele!; return `<tr><td>${escapeHtml(waypoint.name)}</td><td>${fmt(point.d)}</td><td>${Math.round(elevation)} m</td></tr>`; }).join('');
    renderWaypointSegments();
    if (profile.length === p.length)
        draw(profile);
}
const val = (id: string) => Number(($(id) as HTMLInputElement).value), fmt = (x: number) => x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${Math.round(x)} m`;
function locate(d: number) { let a = 0, b = p.length - 1; while (a < b) {
    const m = (a + b) >> 1;
    p[m].d < d ? a = m + 1 : b = m;
} return a; }
function analyse() {
    const analysis = analyseTerrain(p, {
        gradeThreshold: val('#grade'),
        localGradientWindow: Number(localGradientWindow.value),
        rollingWindow: val('#window'),
        minimumSection: val('#min'),
        flatRollingBridge: val('#bridge'),
        profileSmoothing: Number(profileSmoothing.value),
        bridgeCounterSlopes: counterBridge.checked,
        counterSlopeBridge: Number(counterBridgeLength.value),
        counterSlopeReversal: Number(counterReversal.value),
    });
    ss = analysis.sections;
    ms = analysis.primarySections;
    tot = analysis.totals;
    profile = analysis.profile;
    paceEstimate = null;
    routePrediction = null;
    collapsedPrimary.clear();
    ms.forEach((section, index) => hasTerrainChildren(section) && collapsedPrimary.add(index));
    predictionPanel.hidden = true;
    activityPanel.hidden = true;
    render(profile);
    syncSubsectionToggle();
    routeWaypoints.sort((a, b) => a.index - b.index);
    renderWaypointSegments();
}
function buildRoutePrediction() { const curve = curvePoints(); if (curve.length < 2 || !p.length || profile.length !== p.length) {
    routePrediction = null;
    return null;
} return routePrediction = predictRoutePace(p, profile, curve, Number(localGradientWindow.value)); }
function activityMovingSettings() {
    return {
        gapCutoffSeconds: Number(activityPause.value),
        detectStationaryRests: activityRestDetection.checked,
        minimumMovingSpeedKmh: Number(activityMovingSpeed.value),
    };
}
function matchActivityToRoute(points: RecordedActivityPoint[]) {
    if (!p.length)
        throw Error('Upload and analyse a route before an activity.');
    const aligned = alignActivityToRoute(p, points);
    activityMatchQuality = aligned.quality;
    if (aligned.quality.orientation === 'reverse')
        throw Error('This activity appears to follow the route in reverse. Reverse-direction comparison is detected, but is not yet supported.');
    if (!isConfidentRouteMatch(aligned.quality))
        throw Error(`The activity could not be matched confidently to this route (median error ${Math.round(aligned.quality.medianError)} m, 90th percentile ${Math.round(aligned.quality.p90Error)} m, ${Math.round(aligned.quality.within150m)}% within 150 m, ${Math.round(aligned.quality.ambiguousPercent)}% route-position ambiguous).`);
    return calculateActivityMovingTime(aligned.points, activityMovingSettings());
}
function interpolateRouteTime(distance: number) {
    return routePrediction ? interpolateRouteCumulativeTime(p, routePrediction.cumulative, distance) : null;
}
function interpolateActivityTime(distance: number) {
    return interpolateActivityMovingTime(activity, distance);
}
function signedDuration(seconds: number) { const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : ''; return `${sign}${durationText(Math.abs(seconds))}`; }
function activityComparison(from: number, to: number) {
    return compareActivityTimes(from, to, interpolateRouteTime, interpolateActivityTime);
}
function drawActivityComparison() {
    const canvas = activityPanel.querySelector<HTMLCanvasElement>('#activity-chart');
    if (!canvas || !routePrediction || activity.length < 2)
        return;
    const start = activity[0].routeD;
    const end = activity.at(-1)!.routeD;
    const predictedStart = interpolateRouteTime(start);
    const predictedEnd = interpolateRouteTime(end);
    if (predictedStart === null || predictedEnd === null)
        return;
    drawActivityComparisonChart({
        canvas,
        routePoints: p,
        cumulativePrediction: routePrediction.cumulative,
        activity,
        predictedStart,
        predictedEnd,
        formatDuration: durationText,
        formatDistance: fmt,
    });
}
function activityGradientSamples() {
    return createActivityGradientSamples(activity, distance => localGradeAtDistance(p, profile, distance, Number(localGradientWindow.value)));
}
function drawActivityGradient() {
    const canvas = activityPanel.querySelector<HTMLCanvasElement>('#activity-gradient-chart');
    const curve = curvePoints();
    if (!canvas || curve.length < 2)
        return;
    drawActivityGradientChart({
        canvas,
        curve,
        actual: activityGradientSamples(),
        formatPace,
    });
}
function renderActivityAnalysis() { if (!activity.length) {
    activityPanel.hidden = true;
    return;
} activityPanel.hidden = false; if (!paceEstimate || !buildRoutePrediction()) {
    activityPanel.innerHTML = '<h2>Activity comparison</h2><p>Activity loaded. Run pace analysis to compare it with your curve.</p>';
    return;
} const start = activity[0].routeD, end = activity.at(-1)!.routeD, total = activityComparison(start, end); if (!total) {
    activityPanel.innerHTML = '<h2>Activity comparison</h2><p>The activity could not be aligned to enough of this route.</p>';
    return;
} const byKind = new Map<K, {
    expected: number;
    actual: number;
}>(); ms.forEach(section => { const comparison = activityComparison(p[section.a].d, p[section.b].d); if (!comparison)
    return; const value = byKind.get(section.k) ?? { expected: 0, actual: 0 }; value.expected += comparison.expected; value.actual += comparison.actual; byKind.set(section.k, value); }); const viewModel: ActivityComparisonViewModel = {
        curveName: activePaceCurve().name,
        expectedSeconds: total.expected,
        actualSeconds: total.actual,
        differenceSeconds: total.delta,
        elapsedSeconds: (activity.at(-1)!.time - activity[0].time) / 1000,
        distance: end - start,
        coveragePercent: (end - start) / (p.at(-1)!.d) * 100,
        qualityText: activityMatchQuality ? `${Math.round(activityMatchQuality.within150m)}% of samples within 150 m; median ${Math.round(activityMatchQuality.medianError)} m, 90th percentile ${Math.round(activityMatchQuality.p90Error)} m, and ${Math.round(activityMatchQuality.ambiguousPercent)}% route-position ambiguous.` : 'Match quality unavailable.',
        guidanceHtml: [...byKind.entries()].filter(([, value]) => value.expected > 60).map(([kind, value]) => { const difference = (value.actual / value.expected - 1) * 100; return `<li><b>${kind[0].toUpperCase() + kind.slice(1)}:</b> ${Math.abs(difference).toFixed(0)}% ${difference > 0 ? 'slower' : 'faster'} than the selected curve.</li>`; }).join('') || '<li>Not enough route coverage for section-level calibration.</li>',
    }, curveName = escapeHtml(viewModel.curveName); activityPanel.innerHTML = `<div class="prediction-head"><div><p class="eyebrow">Activity versus ${curveName}</p><h2>${signedDuration(viewModel.differenceSeconds)}</h2></div><p>${durationText(viewModel.actualSeconds)} moving versus ${durationText(viewModel.expectedSeconds)} predicted across ${viewModel.coveragePercent.toFixed(0)}% of the route. Positive means slower than predicted.</p></div><div class="activity-stats"><article><b>${durationText(viewModel.elapsedSeconds)}</b><span>Elapsed time</span></article><article><b>${durationText(viewModel.actualSeconds)}</b><span>Moving time</span></article><article><b>${durationText(viewModel.expectedSeconds)}</b><span>Predicted time · ${curveName}</span></article><article><b>${formatPace(viewModel.actualSeconds / (viewModel.distance / 1000))}/km</b><span>Actual average pace</span></article></div><p class="match-quality"><b>Route match:</b> ${viewModel.qualityText}</p><button type="button" id="activity-csv">Download activity comparison CSV</button><canvas id="activity-chart" aria-label="Actual and predicted cumulative moving time">Actual and predicted values are included in the terrain and waypoint tables.</canvas><h3>Actual pace against the curve</h3><canvas id="activity-gradient-chart" aria-label="Actual pace samples against the pace curve">The activity summary and section comparisons provide a text alternative to this chart.</canvas><details class="calibration" open><summary>Calibration indications</summary><p>These observations describe this activity; keep effort level and terrain context in mind before changing a curve.</p><ul>${viewModel.guidanceHtml}</ul></details>`; activityPanel.querySelector<HTMLButtonElement>('#activity-csv')!.onclick = downloadActivityCsv; renderTerrainTable(); renderWaypointSegments(); drawActivityComparison(); drawActivityGradient(); }
activityFile.onchange = async () => { const file = activityFile.files?.[0]; if (!file)
    return; error.textContent = ''; try {
    const text = await file.text(), recorded = parseActivityGpx(text), largeActivityWarning = largeTraceGuidance('activity', recorded.length, file.size), useAsRoute = !p.length || !profile.length;
    if (useAsRoute) {
        result.hidden = true;
        fill.hidden = true;
        routePrediction = null;
        const parsed = parseRouteGpx(text);
        if (largeActivityWarning)
            parsed.warnings.push(largeActivityWarning);
        setParsedRoute(parsed);
        activity = matchActivityToRoute(recorded);
        if (p.every(point => point.ele !== null))
            analyse();
        else {
            status.textContent = `Activity loaded as a route with ${p.length.toLocaleString()} points, but it needs an elevation profile.`;
            fill.hidden = false;
        }
    }
    else
        activity = matchActivityToRoute(recorded);
    status.textContent = `Activity loaded: ${activity.length.toLocaleString()} timestamped points ${useAsRoute ? 'analysed as its own route' : `matched to ${fmt(activity.at(-1)!.routeD - activity[0].routeD)} of the route`}.${activityMatchQuality ? ` Median route error ${Math.round(activityMatchQuality.medianError)} m; ${Math.round(activityMatchQuality.within150m)}% within 150 m; ${Math.round(activityMatchQuality.ambiguousPercent)}% route-position ambiguous.` : ''}${largeActivityWarning ? ` ${largeActivityWarning}` : ''}`;
    if (!result.hidden)
        renderActivityAnalysis();
}
catch (problem) {
    activity = [];
    activityMatchQuality = null;
    activityPanel.hidden = true;
    if (ms.length) {
        renderTerrainTable();
        renderWaypointSegments();
    }
    error.textContent = problem instanceof Error ? problem.message : 'Could not analyse this activity GPX.';
} };
const refreshActivity = () => { if (activityFile.files?.[0])
    activityFile.dispatchEvent(new Event('change')); };
activityPause.oninput = refreshActivity;
activityMovingSpeed.oninput = refreshActivity;
activityRestDetection.onchange = () => { activityMovingSpeed.disabled = !activityRestDetection.checked; refreshActivity(); };
function activityViewAccessor(): ActivityViewAccessor | null {
    if (!activity.length || !routePrediction)
        return null;
    return {
        compare: activityComparison,
        cumulativeAt: distance => {
            const value = interpolateActivityTime(distance);
            return value === null ? null : value - activity[0].moving;
        },
    };
}

function metricCells(metric: PaceMetricsViewModel | null) {
    if (!metric)
        return '<td>—</td><td>—</td><td>—</td><td>—</td>';
    return `<td>${durationText(metric.seconds)}</td><td>${metric.paceSecondsPerKm === null ? '—' : `${formatPace(metric.paceSecondsPerKm)}/km`}</td><td>${metric.vamMetersPerHour === null ? '—' : vamText(metric.vamMetersPerHour, 3600)}</td><td>${durationText(metric.cumulativeSeconds)}</td>`;
}

function terrainTableHeader(showPrediction: boolean, showActivity: boolean) {
    const base = '<th rowspan="2">#</th><th rowspan="2">Type</th><th rowspan="2">From</th><th rowspan="2">To</th><th rowspan="2">Distance</th><th rowspan="2">Net elevation change</th><th rowspan="2">Profile elevation gain</th><th rowspan="2">Profile elevation loss</th><th rowspan="2">Average grade</th>';
    if (!showPrediction)
        return '<tr><th>#</th><th>Type</th><th>From</th><th>To</th><th>Distance</th><th>Net elevation change</th><th>Profile elevation gain</th><th>Profile elevation loss</th><th>Average grade</th></tr>';
    const actual = showActivity ? '<th colspan="5">Actual (Recorded Activity)</th>' : '';
    const actualColumns = showActivity ? '<th>Time</th><th>Pace</th><th>VAM</th><th>Cumulative</th><th>Difference</th>' : '';
    return `<tr>${base}<th colspan="4">Predicted Pace Analysis — ${escapeHtml(activePaceCurve().name)}</th>${actual}</tr><tr><th>Time</th><th>Pace</th><th>VAM</th><th>Cumulative</th>${actualColumns}</tr>`;
}

function terrainRowHtml(row: TerrainRowViewModel, showPrediction: boolean, showActivity: boolean) {
    const hidden = row.child && collapsedPrimary.has(row.primaryIndex) ? ' hidden' : '';
    const toggle = !row.child && row.hasChildren
        ? `<button type="button" class="section-toggle" data-collapse="${row.primaryIndex}" aria-expanded="${!collapsedPrimary.has(row.primaryIndex)}" title="${collapsedPrimary.has(row.primaryIndex) ? 'Show' : 'Hide'} sub-sections">${collapsedPrimary.has(row.primaryIndex) ? '▸' : '▾'}</button>`
        : '';
    const predicted = showPrediction ? metricCells(row.predicted) : '';
    const actual = showActivity
        ? row.actual
            ? `<td>${durationText(row.actual.seconds)}</td><td>${row.actual.paceSecondsPerKm === null ? '—' : `${formatPace(row.actual.paceSecondsPerKm)}/km`}</td><td>${row.actual.vamMetersPerHour === null ? '—' : vamText(row.actual.vamMetersPerHour, 3600)}</td><td>${durationText(row.actual.cumulativeSeconds)}</td><td>${signedDuration(row.actual.differenceSeconds)}</td>`
            : '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>'
        : '';
    const focusLabel = escapeHtml(`Focus elevation profile on section ${row.number}: ${row.label}`);
    return `<tr class="${row.child ? 'sub-row' : ''}" data-primary="${row.primaryIndex}" tabindex="0" aria-label="${focusLabel}"${hidden}><td><span class="section-number">${row.number}</span>${toggle}</td><td class="${row.kind}">${row.child ? '↳ ' : ''}${escapeHtml(row.label)}</td><td>${fmt(row.startDistance)}</td><td>${fmt(row.endDistance)}</td><td>${fmt(row.distance)}</td><td>${row.elevationChange >= 0 ? '+' : ''}${Math.round(row.elevationChange)} m</td><td>+${Math.round(row.profileElevationGain)} m</td><td>−${Math.round(row.profileElevationLoss)} m</td><td>${row.averageGrade === null ? '—' : `${row.averageGrade.toFixed(1)}%`}</td>${predicted}${actual}</tr>`;
}

function terrainSummaryMetrics(summary: TerrainAggregateViewModel, showPrediction: boolean, cumulative: boolean, showVam: boolean) {
    if (!showPrediction)
        return '';
    if (summary.predictedSeconds === null)
        return '<th>—</th><th>—</th><th>—</th><th>—</th>';
    const pace = summary.distance > 0 ? `${formatPace(summary.predictedSeconds / (summary.distance / 1000))}/km` : '—';
    const vam = !showVam || cumulative ? '—' : summary.predictedSeconds > 0 ? vamText(summary.elevationChange, summary.predictedSeconds) : '—';
    return `<th>${durationText(summary.predictedSeconds)}</th><th>${pace}</th><th>${vam}</th><th>${cumulative ? durationText(summary.predictedSeconds) : ''}</th>`;
}

function terrainSummaryActual(summary: TerrainAggregateViewModel, showActivity: boolean, cumulative: boolean, showVam: boolean) {
    if (!showActivity)
        return '';
    if (summary.actualSeconds === null)
        return '<th>—</th><th>—</th><th>—</th><th>—</th><th>—</th>';
    const pace = summary.distance > 0 ? `${formatPace(summary.actualSeconds / (summary.distance / 1000))}/km` : '—';
    const vam = !showVam || cumulative ? '—' : summary.actualSeconds > 0 ? vamText(summary.elevationChange, summary.actualSeconds) : '—';
    return `<th>${durationText(summary.actualSeconds)}</th><th>${pace}</th><th>${vam}</th><th>${cumulative ? durationText(summary.actualSeconds) : ''}</th><th>${summary.actualDifferenceSeconds === null ? '—' : signedDuration(summary.actualDifferenceSeconds)}</th>`;
}

function terrainSummaryRow(summary: TerrainAggregateViewModel, label: string, heading: string, showPrediction: boolean, showActivity: boolean, overall = false, showVam = true) {
    const elevationChange = Math.round(summary.elevationChange);
    const averageGrade = summary.averageGrade !== null && Math.abs(summary.averageGrade) < .05 ? 0 : summary.averageGrade;
    return `<tr class="${overall ? 'terrain-overall-summary' : ''}"><th>${heading}</th><th>${label}</th><th></th><th></th><th>${fmt(summary.distance)}</th><th>${elevationChange > 0 ? '+' : ''}${elevationChange} m</th><th>+${Math.round(summary.profileElevationGain)} m</th><th>−${Math.round(summary.profileElevationLoss)} m</th><th>${averageGrade === null ? '—' : `${averageGrade.toFixed(1)}%`}</th>${terrainSummaryMetrics(summary, showPrediction, overall, showVam)}${terrainSummaryActual(summary, showActivity, overall, showVam)}</tr>`;
}

function renderTerrainTable() {
    const showPrediction = paceEstimate !== null && routePrediction !== null;
    const activityAccessor = showPrediction ? activityViewAccessor() : null;
    const rows = createTerrainRows(p, ms, showPrediction ? routePrediction : null, activityAccessor, profile);
    const table = $('#rows').closest('table')!;
    table.querySelector('thead')!.innerHTML = terrainTableHeader(showPrediction, activityAccessor !== null);
    $('#rows').innerHTML = rows.map(row => terrainRowHtml(row, showPrediction, activityAccessor !== null)).join('');
    const summary = createTerrainSummary(rows);
    table.querySelector('tfoot')!.innerHTML = [
        terrainSummaryRow(summary.byKind.climb, 'Climb', 'Summary', showPrediction, activityAccessor !== null),
        terrainSummaryRow(summary.byKind.descent, 'Descent', '', showPrediction, activityAccessor !== null),
        terrainSummaryRow(summary.byKind.flat, 'Flat', '', showPrediction, activityAccessor !== null, false, false),
        terrainSummaryRow(summary.byKind.rolling, 'Rolling', '', showPrediction, activityAccessor !== null, false, false),
        terrainSummaryRow(summary.overall, 'All terrain', 'Overall', showPrediction, activityAccessor !== null, true),
    ].join('');
}
function downloadActivityCsv() {
    if (!activity.length || !routePrediction)
        return;
    downloadCsv('activity-comparison.csv', buildActivityComparisonCsv({
        route: p,
        profile,
        sections: ms,
        waypoints: routeWaypoints,
        activity,
        prediction: routePrediction,
        matchQuality: activityMatchQuality,
        movingSettings: activityMovingSettings(),
        paceCurveName: activePaceCurve().name,
        paceCurveId: paceController.selectedCurveId,
    }));
}
function renderWaypointSegments() {
    if (routeWaypoints.length < 2) {
        waypointSegmentPanel.hidden = true;
        return;
    }
    const curve = curvePoints(), canEstimate = paceEstimate !== null && routePrediction !== null && curve.length >= 2 && profile.length === p.length, paceAt = canEstimate ? createPaceInterpolator(curve) : null, activityAccessor = canEstimate ? activityViewAccessor() : null;
    const viewModel: WaypointSegmentsViewModel = createWaypointSegmentRows(
        p,
        routeWaypoints.map(({ waypoint, index }) => ({ name: waypoint.name, index, elevation: waypoint.ele })),
        paceAt,
        canEstimate ? routePrediction : null,
        activityAccessor,
    );
    const predictedCells = (metric: PaceMetricsViewModel | null) => metric
        ? `<td>${metric.paceSecondsPerKm === null ? '—' : `${formatPace(metric.paceSecondsPerKm)}/km`}</td><td>${metric.vamMetersPerHour === null ? '—' : vamText(metric.vamMetersPerHour, 3600)}</td><td>${durationText(metric.seconds)}</td><td>${durationText(metric.cumulativeSeconds)}</td>`
        : '<td>—</td><td>—</td><td>—</td><td>—</td>';
    const showActivity = activityAccessor !== null;
    const rows = viewModel.rows.map(row => {
        const actual = showActivity
            ? row.actual
                ? `<td>${row.actual.paceSecondsPerKm === null ? '—' : `${formatPace(row.actual.paceSecondsPerKm)}/km`}</td><td>${row.actual.vamMetersPerHour === null ? '—' : vamText(row.actual.vamMetersPerHour, 3600)}</td><td>${durationText(row.actual.seconds)}</td><td>${durationText(row.actual.cumulativeSeconds)}</td><td>${signedDuration(row.actual.differenceSeconds)}</td>`
                : '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>'
            : '';
        return `<tr><td>${escapeHtml(row.startName)} → ${escapeHtml(row.endName)}</td><td>${fmt(row.distance)}</td><td>${row.elevationChange >= 0 ? '+' : ''}${Math.round(row.elevationChange)} m</td><td>${row.averageGrade.toFixed(1)}%</td>${predictedCells(row.segmentAverage)}${predictedCells(row.localGradient)}${actual}</tr>`;
    }).join('');
    const activityTotal = showActivity ? activityComparison(activity[0].routeD, activity.at(-1)!.routeD) : null, activityDistance = showActivity ? activity.at(-1)!.routeD - activity[0].routeD : 0, activityChange = showActivity ? profile[locate(activity.at(-1)!.routeD)] - profile[locate(activity[0].routeD)] : 0;
    const summaryRows = viewModel.summaries.map((summary, index) => {
        const averagePace = summary.distance > 0 && summary.segmentAverageSeconds > 0 ? `${formatPace(summary.segmentAverageSeconds / (summary.distance / 1000))}/km` : '—';
        const localPace = summary.distance > 0 && summary.localGradientSeconds > 0 ? `${formatPace(summary.localGradientSeconds / (summary.distance / 1000))}/km` : '—';
        const averageVam = summary.segmentAverageSeconds > 0 ? vamText(summary.elevationChange, summary.segmentAverageSeconds) : '—';
        const localVam = summary.localGradientSeconds > 0 ? vamText(summary.elevationChange, summary.localGradientSeconds) : '—';
        const predicted = canEstimate ? `<th>${averagePace}</th><th>${averageVam}</th><th>${summary.distance > 0 ? durationText(summary.segmentAverageSeconds) : ''}</th><th></th><th>${localPace}</th><th>${localVam}</th><th>${summary.distance > 0 ? durationText(summary.localGradientSeconds) : ''}</th><th></th>` : '<th colspan="8"></th>';
        const actual = showActivity ? `<th></th><th></th><th>${summary.actualSeconds === null ? '' : durationText(summary.actualSeconds)}</th><th></th><th></th>` : '';
        return `<tr><th>${index === 0 ? 'Summary' : ''}</th><th>${fmt(summary.distance)}</th><th>${summary.elevationChange >= 0 ? '+' : ''}${Math.round(summary.elevationChange)} m</th><th>${summary.averageGrade === null ? '—' : `${summary.averageGrade.toFixed(1)}%`}</th>${predicted}${actual}</tr>`;
    }).join('');
    const overall = viewModel.overall;
    const overallSegmentAveragePace = overall.distance > 0 && overall.segmentAverageSeconds > 0 ? `${formatPace(overall.segmentAverageSeconds / (overall.distance / 1000))}/km` : '—';
    const overallLocalPace = overall.distance > 0 && overall.localGradientSeconds > 0 ? `${formatPace(overall.localGradientSeconds / (overall.distance / 1000))}/km` : '—';
    const overallPredicted = canEstimate
        ? `<th>${overallSegmentAveragePace}</th><th>—</th><th></th><th>${durationText(viewModel.segmentAverageTotalSeconds)}</th><th>${overallLocalPace}</th><th>—</th><th></th><th>${durationText(viewModel.localGradientTotalSeconds)}</th>`
        : '<th colspan="8"></th>';
    const overallActual = showActivity
        ? activityTotal
            ? `<th>${activityDistance > 0 ? `${formatPace(activityTotal.actual / (activityDistance / 1000))}/km` : '—'}</th><th>${vamText(activityChange, activityTotal.actual)}</th><th>${durationText(activityTotal.actual)}</th><th>${durationText(activityTotal.actual)}</th><th>${signedDuration(activityTotal.delta)}</th>`
            : '<th></th><th></th><th></th><th></th><th></th>'
        : '';
    const overallElevation = Math.round(overall.elevationChange);
    const overallGrade = overall.averageGrade !== null && Math.abs(overall.averageGrade) < .05 ? 0 : overall.averageGrade;
    const overallSummaryRow = `<tr class="waypoint-overall-summary"><th>Overall</th><th>${fmt(overall.distance)}</th><th>${overallElevation > 0 ? '+' : ''}${overallElevation} m</th><th>${overallGrade === null ? '—' : `${overallGrade.toFixed(1)}%`}</th>${overallPredicted}${overallActual}</tr>`;
    const actualHeader = showActivity ? '<th colspan="5">Actual (Recorded Activity)</th>' : '', actualColumns = showActivity ? '<th rowspan="2">Pace</th><th rowspan="2">VAM</th><th rowspan="2">Time</th><th rowspan="2">Cumulative</th><th rowspan="2">Difference</th>' : '';
    waypointSegmentPanel.hidden = false;
    waypointSegmentPanel.innerHTML = `<h3>Waypoint Segments</h3><p>Elevation change and Segment Average use the displayed endpoint elevations: a named waypoint’s own elevation when present, otherwise the unsmoothed route elevation. Local Gradient uses the smoothed ${localGradientWindow.value} m local-gradient method from the Terrain-derived Sections analysis.</p><table><thead><tr><th rowspan="3">Segment</th><th rowspan="3">Distance</th><th rowspan="3">Elevation change</th><th rowspan="3">Average grade</th><th colspan="8">Predicted Pace Analysis — ${escapeHtml(activePaceCurve().name)}</th>${actualHeader}</tr><tr><th colspan="4">Segment Average</th><th colspan="4">Local Gradient</th>${actualColumns}</tr><tr><th>Pace</th><th>VAM</th><th>Time</th><th>Cumulative</th><th>Pace</th><th>VAM</th><th>Time</th><th>Cumulative</th></tr></thead><tbody>${rows}</tbody><tfoot>${summaryRows}${overallSummaryRow}</tfoot></table>`;
}
function syncSubsectionToggle() { const hasChildren = ms.some(hasTerrainChildren), hasCollapsed = ms.some((section, index) => hasTerrainChildren(section) && collapsedPrimary.has(index)); subsectionToggleButton.hidden = !hasChildren; subsectionToggleButton.textContent = hasCollapsed ? 'Expand all subsections' : 'Collapse all subsections'; }
($('#rows') as HTMLElement).addEventListener('click', event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-collapse]'); if (!button)
    return; event.stopImmediatePropagation(); const index = Number(button.dataset.collapse); collapsedPrimary.has(index) ? collapsedPrimary.delete(index) : collapsedPrimary.add(index); renderTerrainTable(); syncSubsectionToggle(); });
function runPaceAnalysis() { const curve = curvePoints(); if (curve.length < 2) {
    predictionPanel.hidden = false;
    predictionPanel.innerHTML = `<h2>Predicted time</h2><p>The selected curve, <b>${escapeHtml(activePaceCurve().name)}</b>, needs at least two valid pace or VAM points. Edit it on the <a href="./#pace">pace curve</a> page.</p>`;
    return;
} const prediction = buildRoutePrediction()!, sections = ms.map(section => prediction.cumulative[section.b] - prediction.cumulative[section.a]), total = prediction.cumulative.at(-1)!; paceEstimate = { total, sections }; predictionPanel.hidden = true; render(profile); renderWaypointSegments(); syncSubsectionToggle(); if (activity.length)
    renderActivityAnalysis(); }
function vamValue(elevationChange: number, seconds: number) { return seconds > 0 && Number.isFinite(elevationChange) ? elevationChange * 3600 / seconds : null; }
function vamText(elevationChange: number, seconds: number) { const value = vamValue(elevationChange, seconds); return value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.round(Math.abs(value))} m/h`; }
function durationText(seconds: number) { return formatDuration(seconds); }
function render(e: number[]) {
    profile = e;
    hovered = null;
    hoverDistance = null;
    result.hidden = false;
    status.textContent = `${routeName ? `${routeName}: ` : ''}${p.length.toLocaleString()} points analysed across ${fmt(p.at(-1)!.d)}.${routeWarnings.length ? ` ${routeWarnings.join(' ')}` : ''}`;
    const viewModel = createRouteViewModel(p, ms, tot, paceEstimate?.total ?? null, e);
    const terrainStats = viewModel.terrain.map(item => {
        const label = `${item.kind[0].toUpperCase() + item.kind.slice(1)}${item.averageGrade === null ? '' : ` · average ${item.averageGrade >= 0 ? '+' : ''}${item.averageGrade.toFixed(1)}%`}`;
        return `<article class="stat ${item.kind}"><b>${fmt(item.distance)}</b><span>${label}</span></article>`;
    }).join('');
    const totals = `<article class="stat climb elevation-stat"><b>+${Math.round(viewModel.profileElevationGain)} m</b><span>Profile elevation gain</span><div class="stat-comparison"><small><strong>+${Math.round(viewModel.sectionElevationGain)} m</strong> By section</small><small><strong>+${Math.round(viewModel.rawElevationGain)} m</strong> Raw</small></div></article><article class="stat descent elevation-stat"><b>−${Math.round(viewModel.profileElevationLoss)} m</b><span>Profile elevation loss</span><div class="stat-comparison"><small><strong>−${Math.round(viewModel.sectionElevationLoss)} m</strong> By section</small><small><strong>−${Math.round(viewModel.rawElevationLoss)} m</strong> Raw</small></div></article>`;
    const prediction = viewModel.predictedSeconds === null ? '' : `<article class="stat rolling prediction-stat"><b>${durationText(viewModel.predictedSeconds)}</b><span>Predicted time · ${escapeHtml(activePaceCurve().name)}</span></article>`;
    $('#stats').innerHTML = terrainStats + totals + prediction;
    renderTerrainTable();
    draw(e);
}
function draw(e: number[]) {
    if (!e.length)
        return;
    const total = p.at(-1)!.d;
    if (!Number.isFinite(viewEnd) || viewEnd > total) {
        viewStart = 0;
        viewEnd = total;
        viewStartInput.value = '0.00';
        viewEndInput.value = (total / 1000).toFixed(2);
    }
    syncPan();
    drawTerrainProfile({
        canvas: chart,
        points: p,
        elevations: e,
        sections: ss,
        primarySections: ms,
        waypoints: routeWaypoints.map(({ waypoint, index }) => ({ name: waypoint.name, index })),
        viewStart,
        viewEnd,
        showWaypoints: showWaypoints.checked,
        colourMode: plotColours.value === 'gradient' ? 'gradient' : 'sections',
        gradeThreshold: val('#grade'),
        localGrade: index => localGradeAtDistance(p, e, p[index].d, Number(localGradientWindow.value)),
        hoveredPrimary: hovered,
        hoverDistance,
        selectionStart,
        selectionEnd,
        sectionColours: C,
    });
}
function setHovered(index: number | null, distance: number | null = null) { const changed = hovered !== index; hovered = index; hoverDistance = distance; if (changed)
    document.querySelectorAll('[data-primary]').forEach(row => row.classList.toggle('is-highlighted', Number((row as HTMLElement).dataset.primary) === index)); draw(profile); }
function distanceAt(event: PointerEvent) { return terrainDistanceAt(chart, event.clientX, viewStart, viewEnd); }
chart.addEventListener('pointerdown', event => { if (!profile.length || event.button !== 0)
    return; selectionStart = distanceAt(event); selectionEnd = selectionStart; chart.setPointerCapture(event.pointerId); draw(profile); });
chart.addEventListener('pointermove', event => { if (!profile.length)
    return; const distance = distanceAt(event); if (selectionStart !== null) {
    selectionEnd = distance;
    draw(profile);
    return;
} setHovered(ms.findIndex(m => distance >= p[m.a].d && distance <= p[m.b].d), distance); });
chart.addEventListener('pointerup', event => { if (selectionStart === null || selectionEnd === null)
    return; const start = Math.min(selectionStart, selectionEnd), end = Math.max(selectionStart, selectionEnd), wideEnough = end - start >= Math.max(25, (viewEnd - viewStart) * .002); selectionStart = selectionEnd = null; if (chart.hasPointerCapture(event.pointerId))
    chart.releasePointerCapture(event.pointerId); if (wideEnough)
    setView(start, end);
else
    draw(profile); });
chart.addEventListener('pointerleave', () => { if (selectionStart === null)
    setHovered(null); });
function focusTerrainSection(row: HTMLTableRowElement) { const section = ms[Number(row.dataset.primary)]; if (section)
    setView(p[section.a].d, p[section.b].d); }
($('#rows') as HTMLElement).addEventListener('click', event => { const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('[data-primary]'); if (row)
    focusTerrainSection(row); });
($('#rows') as HTMLElement).addEventListener('keydown', event => { if (event.key !== 'Enter' && event.key !== ' ' || event.target !== event.currentTarget && (event.target as HTMLElement).closest('button'))
    return; const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('[data-primary]'); if (!row)
    return; event.preventDefault(); focusTerrainSection(row); });
function downloadAnalysisCsv() {
    const settings: Array<[string, string | number | boolean]> = [
        ['grade_threshold_percent', val('#grade')],
        ['rolling_window_m', val('#window')],
        ['minimum_section_m', val('#min')],
        ['flat_rolling_bridge_m', val('#bridge')],
        ['profile_smoothing_m', Number(profileSmoothing.value)],
        ['local_gradient_window_m', Number(localGradientWindow.value)],
        ['counter_slope_bridge_enabled', counterBridge.checked],
        ['counter_slope_bridge_m', Number(counterBridgeLength.value)],
        ['counter_slope_reversal_percent', Number(counterReversal.value)],
        ['recording_gap_cutoff_s', Number(activityPause.value)],
        ['stationary_rest_detection', activityRestDetection.checked],
        ['minimum_moving_speed_kmh', Number(activityMovingSpeed.value)],
        ['route_parse_warnings', routeWarnings.join(' ')],
    ];
    downloadCsv('route-analysis.csv', buildRouteAnalysisCsv({
        route: p,
        profileElevations: profile,
        sections: ms,
        totals: tot,
        prediction: routePrediction,
        sectionPredictionSeconds: paceEstimate?.sections,
        predictedTotalSeconds: paceEstimate?.total,
        waypoints: routeWaypoints,
        rawPacePoints: paceController.points,
        resolvedPacePoints: curvePoints(),
        paceCurveName: activePaceCurve().name,
        paceCurveId: paceController.selectedCurveId,
        settings,
    }));
}
$('#csv').textContent = 'Download analysis CSV';
$('#csv').addEventListener('click', downloadAnalysisCsv);
($('#fillBtn') as HTMLButtonElement).onclick = async () => { const b = $('#fillBtn') as HTMLButtonElement; b.disabled = true; try {
    const lookup = elevationProvider.prepare(p);
    status.textContent = `Getting full-detail ${elevationProvider.name} terrain from ${lookup.requestCount} tiles…`;
    await lookup.fill(({ completed, total }) => {
        status.textContent = `Getting full-detail ${elevationProvider.name} terrain: ${completed} of ${total} tiles…`;
    });
    fill.hidden = true;
    analyse();
}
catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Elevation lookup failed.';
}
finally {
    b.disabled = false;
} };
return {
    page: routePage,
    redraw() {
        if (profile.length)
            draw(profile);
        if (!activityPanel.hidden) {
            drawActivityComparison();
            drawActivityGradient();
        }
    },
};
}
