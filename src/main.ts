import './style.css';
import './pace.css';
import { builtInPaceCurves, type BuiltInPaceCurve } from './builtInPaceCurves';
import {
    accumulateSegments,
    escapeHtml,
    formatDuration,
    formatPace,
    haversineMeters,
    isConfidentRouteMatch,
    matchRouteSamples,
    selectLongestRouteChain,
    type PaceCurvePoint,
    type RouteMatchQuality,
    type StoredPaceCurve,
} from './core';
import {
    createPaceInterpolator,
    isSemanticallyValidPacePoint,
    pacePointInput,
    pacePointMethod,
    pacePointSeconds,
    parseValidatedPaceCurveBackup,
    predictRoutePace,
    resolvePaceCurve,
    type RoutePacePrediction,
} from './pace';
import { createPaceLibraryState, parsePaceLibraryStorage } from './paceLibrary';
import { pacePageTemplate, routePageTemplate } from './templates';
import { analyseTerrain, localGradeAtDistance } from './terrain';
import type {
    PrimaryTerrainSection as M,
    TerrainKind as K,
    TerrainSection as S,
} from './terrain';
import { waypointSegmentGeometry } from './waypoints';
import {
    createTerrainRows,
    createRouteViewModel,
    createWaypointSegmentRows,
    type ActivityComparisonViewModel,
    type ActivityViewAccessor,
    type PaceMetricsViewModel,
    type TerrainRowViewModel,
    type WaypointSegmentsViewModel,
} from './viewModels';
let paceEstimate: {
    total: number;
    sections: number[];
} | null = null;
const collapsedPrimary = new Set<number>();
type P = {
    lat: number;
    lon: number;
    ele: number | null;
    d: number;
    segment: number;
    breakBefore: boolean;
};
type W = {
    name: string;
    lat: number;
    lon: number;
    ele: number | null;
};
type RouteWaypoint = {
    waypoint: W;
    index: number;
};
type ActivityPoint = {
    lat: number;
    lon: number;
    ele: number | null;
    time: number;
    d: number;
    moving: number;
    routeD: number;
    segment: number;
    breakBefore: boolean;
};
let activity: ActivityPoint[] = [], routePrediction: RoutePacePrediction | null = null, activityMatchQuality: RouteMatchQuality | null = null;
const A = document.querySelector<HTMLDivElement>('#app')!, C: Record<K, string> = { climb: '#c84735', descent: '#31805a', flat: '#607183', rolling: '#b67812' };
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
A.innerHTML = routePageTemplate();
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
restDetectionControl.className = 'activity-input';
restDetectionControl.style.cssText = 'display:flex;align-items:center;gap:7px';
restDetectionControl.innerHTML = '<input id="activity-rest-detection" type="checkbox" style="width:auto"> Detect stationary rests';
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
analysisCurveControl.innerHTML = 'Pace curve <select id="analysis-curve-select" aria-label="Pace curve for route analysis"></select>';
const subsectionToggleButton = document.createElement('button');
subsectionToggleButton.type = 'button';
subsectionToggleButton.id = 'toggle-subsections';
const resultActions = document.createElement('div');
resultActions.className = 'result-actions';
resultActions.append(result.querySelector('#csv')!, analysisCurveControl, paceAnalysisButton, subsectionToggleButton);
result.querySelector('.result-head')!.append(resultActions);
paceAnalysisButton.onclick = () => runPaceAnalysis();
subsectionToggleButton.onclick = () => { const hasCollapsed = ms.some((section, index) => hasTerrainChildren(section) && collapsedPrimary.has(index)); ms.forEach((section, index) => hasTerrainChildren(section) && (hasCollapsed ? collapsedPrimary.delete(index) : collapsedPrimary.add(index))); renderTerrainTable(); syncSubsectionToggle(); };
const header = A.querySelector('header')!, routePage = A.querySelector<HTMLElement>('#route-page')!;
type PacePoint = PaceCurvePoint;
type SavedPaceCurve = StoredPaceCurve;
const paceLibraryStorage = 'route-analyser.pace-curves', selectedPaceCurveStorage = 'route-analyser.selected-pace-curve', createPaceCurveId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `curve-${Date.now()}-${Math.random().toString(36).slice(2)}`, cloneBuiltInPaceCurve = (curve: BuiltInPaceCurve = builtInPaceCurves[0]) => curve.points.map(point => ({ ...point })), createBuiltInPaceLibrary = (): SavedPaceCurve[] => builtInPaceCurves.map(curve => ({ id: createPaceCurveId(), name: curve.name, points: cloneBuiltInPaceCurve(curve) })), loadPaceLibrary = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(paceLibraryStorage) || 'null');
        const library = parsePaceLibraryStorage(stored);
        if (library)
            return library;
        return { curves: createBuiltInPaceLibrary(), migrated: false };
    }
    catch {
        return { curves: createBuiltInPaceLibrary(), migrated: false };
    }
};
const loadedPaceLibrary = loadPaceLibrary();
let paceCurves = loadedPaceLibrary.curves, activePaceCurveId = (() => { try {
    return localStorage.getItem(selectedPaceCurveStorage) || loadedPaceLibrary.selectedCurveId || paceCurves[0].id;
}
catch {
    return paceCurves[0].id;
} })();
if (!paceCurves.some(curve => curve.id === activePaceCurveId))
    activePaceCurveId = paceCurves[0].id;
const activePaceCurve = () => paceCurves.find(curve => curve.id === activePaceCurveId)!;
let pacePoints: PacePoint[] = activePaceCurve().points;
type PaceChartPreferences = {
    curveIds: string[];
    showPace: boolean;
    showSpeed: boolean;
    showVam: boolean;
};
const paceChartPreferencesStorage = 'route-analyser.pace-chart-preferences', loadPaceChartPreferences = (): PaceChartPreferences => {
    try {
        const value = JSON.parse(localStorage.getItem(paceChartPreferencesStorage) || 'null') as Partial<PaceChartPreferences> | null, validIds = new Set(paceCurves.map(curve => curve.id)), curveIds = Array.isArray(value?.curveIds) ? value.curveIds.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : [];
        return { curveIds: curveIds.length ? curveIds : paceCurves.map(curve => curve.id), showPace: value?.showPace !== false, showSpeed: value?.showSpeed !== false, showVam: value?.showVam === true };
    }
    catch {
        return { curveIds: paceCurves.map(curve => curve.id), showPace: true, showSpeed: true, showVam: false };
    }
};
let paceChartPreferences = loadPaceChartPreferences();
A.querySelector('main')!.insertAdjacentHTML('beforeend', pacePageTemplate(builtInPaceCurves));
const pacePanel = A.querySelector<HTMLElement>('#pace-panel')!;
const paceRows = pacePanel.querySelector('tbody')!, paceCanvas = pacePanel.querySelector('canvas')!, paceHeading = pacePanel.querySelector<HTMLElement>('#pace-chart-heading')!, addPace = pacePanel.querySelector<HTMLButtonElement>('#add-pace-point')!, loadBuiltInPace = pacePanel.querySelector<HTMLButtonElement>('#load-built-in-pace')!, builtInPaceSelect = pacePanel.querySelector<HTMLSelectElement>('#built-in-pace-select')!, paceCurveSelect = pacePanel.querySelector<HTMLSelectElement>('#pace-curve-select')!, paceCurveName = pacePanel.querySelector<HTMLInputElement>('#pace-curve-name')!, newPaceCurve = pacePanel.querySelector<HTMLButtonElement>('#new-pace-curve')!, duplicatePaceCurve = pacePanel.querySelector<HTMLButtonElement>('#duplicate-pace-curve')!, deletePaceCurve = pacePanel.querySelector<HTMLButtonElement>('#delete-pace-curve')!, exportPaceCurves = pacePanel.querySelector<HTMLButtonElement>('#export-pace-curves')!, importPaceCurves = pacePanel.querySelector<HTMLInputElement>('#import-pace-curves')!, paceLibraryStatus = pacePanel.querySelector<HTMLElement>('#pace-library-status')!, comparisonList = pacePanel.querySelector<HTMLElement>('#curve-comparison-list')!, chartLegend = pacePanel.querySelector<HTMLElement>('#curve-chart-legend')!, showPaceCurves = pacePanel.querySelector<HTMLInputElement>('#show-pace-curves')!, showSpeedCurves = pacePanel.querySelector<HTMLInputElement>('#show-speed-curves')!, showVamCurves = pacePanel.querySelector<HTMLInputElement>('#show-vam-curves')!, analysisCurveSelect = analysisCurveControl.querySelector<HTMLSelectElement>('select')!;
const speedCanvas = pacePanel.querySelector<HTMLCanvasElement>('#speed-chart')!, speedHeading = pacePanel.querySelector<HTMLElement>('#speed-chart-heading')!, vamGuides = pacePanel.querySelector<HTMLLabelElement>('.vam-guides')!;
const showVamGuides = vamGuides.querySelector('input')!;
showPaceCurves.checked = paceChartPreferences.showPace;
showSpeedCurves.checked = paceChartPreferences.showSpeed;
showVamCurves.checked = paceChartPreferences.showVam;
const paceMode = pacePointMethod, paceInput = pacePointInput, paceValue = (point: PacePoint) => isSemanticallyValidPacePoint(point) ? pacePointSeconds(point) : null, paceText = formatPace;
const savePace = () => { const curve = activePaceCurve(); curve.points = pacePoints; try {
    localStorage.setItem(paceLibraryStorage, JSON.stringify(createPaceLibraryState(paceCurves, activePaceCurveId)));
    localStorage.setItem(selectedPaceCurveStorage, activePaceCurveId);
    return true;
}
catch {
    paceLibraryStatus.textContent = 'These changes could not be saved in browser storage. Export a backup before leaving this page.';
    return false;
} };
function renderPace() {
    paceRows.innerHTML = pacePoints.map((point, index) => {
        const mode = paceMode(point), equivalent = paceValue(point), vam = equivalent !== null && point.grade !== 0 ? Math.round(36000 * Math.abs(point.grade) / equivalent) : null, equivalentText = equivalent === null ? '' : mode === 'vam' ? `≈ ${paceText(equivalent)}/km` : vam === null ? '' : `≈ ${vam} m/h`;
        return `<tr><td><input data-grade="${index}" type="number" min="-100" max="100" step=".5" value="${point.grade}">%</td><td><select data-mode="${index}"><option value="pace" ${mode === 'pace' ? 'selected' : ''}>Pace</option><option value="vam" ${mode === 'vam' ? 'selected' : ''}>VAM</option></select></td><td><input data-pace="${index}" type="text" inputmode="numeric" placeholder="${mode === 'vam' ? '600' : '6:30'}" value="${escapeHtml(paceInput(point))}"> ${mode === 'vam' ? 'm/h' : ''} <small data-equivalent="${index}">${equivalentText}</small></td><td><button data-remove="${index}" type="button" aria-label="Remove pace point">×</button></td></tr>`;
    }).join('');
}
paceRows.addEventListener('input', event => { const input = event.target as HTMLInputElement, index = Number(input.dataset.grade ?? input.dataset.pace); if (input.dataset.grade !== undefined)
    pacePoints[index].grade = Number(input.value);
else if (input.dataset.pace !== undefined) {
    const mode = (paceRows.querySelector(`[data-mode="${index}"]`) as HTMLSelectElement).value;
    pacePoints[index].pace = mode === 'vam' ? `vam:${input.value}` : input.value;
} savePace(); updatePaceEquivalents(); redrawHorizontalVamGuides(); });
paceRows.addEventListener('change', event => { const input = event.target as HTMLInputElement, index = Number(input.dataset.mode); if (input.dataset.mode !== undefined) {
    const value = paceInput(pacePoints[index]);
    pacePoints[index].pace = input.value === 'vam' ? `vam:${value}` : value;
    savePace();
} renderPace(); redrawHorizontalVamGuides(); });
paceRows.addEventListener('click', event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button)
    return; if (button.dataset.remove === undefined)
    return; pacePoints.splice(Number(button.dataset.remove), 1); savePace(); renderPace(); redrawHorizontalVamGuides(); });
addPace.onclick = () => { pacePoints.push({ grade: (pacePoints.length ? Math.max(...pacePoints.map(point => point.grade)) : 0) + 5, pace: '' }); savePace(); renderPace(); redrawHorizontalVamGuides(); };
renderPace();
let hoveredPaceGrade: number | null = null, hoveredSpeedGrade: number | null = null;
const curvePoints = () => resolvePaceCurve(pacePoints);
function curveBounds(points: (PacePoint & {
    seconds: number;
})[]) { const minGrade = Math.min(0, Math.floor(Math.min(...points.map(point => point.grade)) / 5) * 5), maxGrade = Math.max(0, Math.ceil(Math.max(...points.map(point => point.grade)) / 5) * 5); return { minGrade, maxGrade }; }
function findHoveredComparisonGrade(canvas: HTMLCanvasElement, event: PointerEvent) { const points = comparedPaceCurves().flatMap(item => item.points); if (points.length < 2)
    return null; const r = canvas.getBoundingClientRect(), { minGrade, maxGrade } = curveBounds(points), x = event.clientX - r.left, plotX = (grade: number) => 54 + (grade - minGrade) / Math.max(1, maxGrade - minGrade) * (r.width - 54 - 58), closest = points.reduce((best, point) => Math.abs(plotX(point.grade) - x) < Math.abs(plotX(best.grade) - x) ? point : best, points[0]); return Math.abs(plotX(closest.grade) - x) < 14 ? closest.grade : null; }
paceCanvas.addEventListener('pointermove', event => { const grade = findHoveredComparisonGrade(paceCanvas, event); if (grade === hoveredPaceGrade)
    return; hoveredPaceGrade = grade; redrawHorizontalVamGuides(); });
paceCanvas.addEventListener('pointerleave', () => { if (hoveredPaceGrade === null)
    return; hoveredPaceGrade = null; redrawHorizontalVamGuides(); });
speedCanvas.addEventListener('pointermove', event => { const grade = findHoveredComparisonGrade(speedCanvas, event); if (grade === hoveredSpeedGrade)
    return; hoveredSpeedGrade = grade; redrawHorizontalVamGuides(); });
speedCanvas.addEventListener('pointerleave', () => { if (hoveredSpeedGrade === null)
    return; hoveredSpeedGrade = null; redrawHorizontalVamGuides(); });
function updatePaceEquivalents() { pacePoints.forEach((point, index) => { const output = paceRows.querySelector<HTMLElement>(`[data-equivalent="${index}"]`); if (!output)
    return; const seconds = paceValue(point), mode = paceMode(point), vam = seconds !== null && point.grade !== 0 ? Math.round(36000 * Math.abs(point.grade) / seconds) : null; output.textContent = seconds === null ? '' : mode === 'vam' ? `≈ ${paceText(seconds)}/km` : vam === null ? '' : `≈ ${vam} m/h`; }); }
updatePaceEquivalents();
const sortPacePoints = () => { pacePoints.sort((a, b) => a.grade - b.grade); savePace(); renderPace(); redrawHorizontalVamGuides(); };
paceRows.addEventListener('change', sortPacePoints);
addPace.addEventListener('click', () => queueMicrotask(sortPacePoints));
pacePoints.sort((a, b) => a.grade - b.grade);
savePace();
renderPace();
type ComparedPaceCurve = {
    curve: SavedPaceCurve;
    color: string;
    points: Array<PacePoint & { seconds: number }>;
};
const comparisonColors = ['#2563eb', '#c84735', '#31805a', '#8b5cf6', '#d97706', '#0891b2', '#db2777', '#4f46e5', '#65a30d', '#b45309'], paceCurveColor = (id: string) => comparisonColors[Math.max(0, paceCurves.findIndex(curve => curve.id === id)) % comparisonColors.length], comparedPaceCurves = (): ComparedPaceCurve[] => paceCurves.filter(curve => paceChartPreferences.curveIds.includes(curve.id)).map(curve => ({ curve, color: paceCurveColor(curve.id), points: resolvePaceCurve(curve.points) })), savePaceChartPreferences = () => { try {
    localStorage.setItem(paceChartPreferencesStorage, JSON.stringify(paceChartPreferences));
}
catch {
    paceLibraryStatus.textContent = 'Chart comparison preferences could not be saved in this browser.';
} };
function renderPaceComparisonControls() {
    const selected = new Set(paceChartPreferences.curveIds);
    comparisonList.innerHTML = paceCurves.map(curve => `<label><input type="checkbox" data-compare-curve="${escapeHtml(curve.id)}" ${selected.has(curve.id) ? 'checked' : ''}><span class="curve-swatch" style="--curve-color:${paceCurveColor(curve.id)}"></span>${escapeHtml(curve.name)}</label>`).join('');
    const visible = comparedPaceCurves();
    chartLegend.innerHTML = visible.map(item => `<span><i style="--curve-color:${item.color}"></i>${escapeHtml(item.curve.name)}</span>`).join('') + (paceChartPreferences.showVam ? '<span class="line-style"><i></i>Solid: pace/speed</span><span class="line-style dashed"><i></i>Dashed: VAM</span>' : '');
    showPaceCurves.checked = paceChartPreferences.showPace;
    showSpeedCurves.checked = paceChartPreferences.showSpeed;
    showVamCurves.checked = paceChartPreferences.showVam;
    showVamGuides.disabled = !paceChartPreferences.showVam;
}
function prepareComparisonCanvas(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const context = canvas.getContext('2d')!;
    context.scale(ratio, ratio);
    return { context, width: rect.width, height: rect.height };
}
function drawComparisonGradeGrid(context: CanvasRenderingContext2D, width: number, height: number, minGrade: number, maxGrade: number, left: number, right: number, top: number, bottom: number) {
    const X = (grade: number) => left + (grade - minGrade) / Math.max(1, maxGrade - minGrade) * (width - left - right), tick = Math.max(5, Math.ceil((maxGrade - minGrade) / 8 / 5) * 5);
    context.font = '12px system-ui';
    context.textAlign = 'center';
    for (let grade = Math.ceil(minGrade / tick) * tick; grade <= maxGrade; grade += tick) {
        const x = X(grade);
        context.strokeStyle = grade === 0 ? '#64748b' : '#d7dde5';
        context.lineWidth = grade === 0 ? 1.5 : 1;
        context.setLineDash(grade === 0 ? [4, 3] : []);
        context.beginPath();
        context.moveTo(x, top);
        context.lineTo(x, height - bottom);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = '#667281';
        context.fillText(`${grade}%`, x, height - 8);
    }
    context.textAlign = 'start';
    return X;
}
function drawVamScale(context: CanvasRenderingContext2D, width: number, height: number, left: number, right: number, top: number, bottom: number, maxVam: number) {
    const V = (vam: number) => top + (maxVam * 1.1 - vam) / (maxVam * 1.1) * (height - top - bottom);
    context.font = '11px system-ui';
    context.textAlign = 'left';
    for (let index = 0; index <= 4; index++) {
        const vam = maxVam * index / 4, y = V(vam);
        context.fillStyle = '#667281';
        context.fillText(`${Math.round(vam)}`, width - right + 4, y + 4);
        if (showVamGuides.checked && index) {
            context.strokeStyle = 'rgba(49,128,90,.28)';
            context.setLineDash([4, 4]);
            context.beginPath();
            context.moveTo(left, y);
            context.lineTo(width - right, y);
            context.stroke();
            context.setLineDash([]);
        }
    }
    return V;
}
function drawPaceComparison() {
    paceHeading.hidden = paceCanvas.hidden = !paceChartPreferences.showPace;
    if (!paceChartPreferences.showPace)
        return;
    const curves = comparedPaceCurves(), points = curves.flatMap(item => item.points), { context, width, height } = prepareComparisonCanvas(paceCanvas), left = 54, right = 58, top = 18, bottom = 34;
    context.clearRect(0, 0, width, height);
    if (points.length < 2) {
        context.fillStyle = '#667281';
        context.font = '14px system-ui';
        context.fillText('Select a curve with at least two valid points.', left + 12, height / 2);
        return;
    }
    const { minGrade, maxGrade } = curveBounds(points), minPace = Math.min(...points.map(point => point.seconds)), maxPace = Math.max(...points.map(point => point.seconds)), paceRange = Math.max(30, maxPace - minPace), maxVam = Math.max(100, ...points.map(point => point.grade === 0 ? 0 : 36000 * Math.abs(point.grade) / point.seconds)), X = drawComparisonGradeGrid(context, width, height, minGrade, maxGrade, left, right, top, bottom), Y = (seconds: number) => top + (seconds - minPace + paceRange * .1) / (paceRange * 1.2) * (height - top - bottom), V = paceChartPreferences.showVam ? drawVamScale(context, width, height, left, right, top, bottom, maxVam) : null;
    context.font = '11px system-ui';
    for (let index = 0; index <= 5; index++) {
        const seconds = minPace + (maxPace - minPace) * index / 5, y = Y(seconds);
        context.strokeStyle = 'rgba(148,163,184,.3)';
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        context.fillStyle = '#667281';
        context.textAlign = 'right';
        context.fillText(paceText(seconds), left - 5, y + 4);
    }
    curves.forEach(item => {
        if (V) {
            context.strokeStyle = item.color;
            context.globalAlpha = .72;
            context.lineWidth = 1.8;
            context.setLineDash([6, 4]);
            context.beginPath();
            item.points.forEach((point, index) => { const y = V(point.grade === 0 ? 0 : 36000 * Math.abs(point.grade) / point.seconds); index ? context.lineTo(X(point.grade), y) : context.moveTo(X(point.grade), y); });
            context.stroke();
            context.setLineDash([]);
            context.globalAlpha = 1;
        }
        context.strokeStyle = item.color;
        context.lineWidth = item.curve.id === activePaceCurveId ? 3 : 2.2;
        context.beginPath();
        item.points.forEach((point, index) => index ? context.lineTo(X(point.grade), Y(point.seconds)) : context.moveTo(X(point.grade), Y(point.seconds)));
        context.stroke();
        context.fillStyle = item.color;
        item.points.forEach(point => { context.beginPath(); context.arc(X(point.grade), Y(point.seconds), item.curve.id === activePaceCurveId ? 4 : 3, 0, Math.PI * 2); context.fill(); });
    });
    context.textAlign = 'start';
    if (hoveredPaceGrade !== null) {
        const entries = curves.map(item => ({ item, point: item.points.reduce((best, point) => Math.abs(point.grade - hoveredPaceGrade!) < Math.abs(best.grade - hoveredPaceGrade!) ? point : best, item.points[0]) })).filter(entry => entry.point), x = X(hoveredPaceGrade);
        if (entries.length) {
            context.strokeStyle = 'rgba(71,85,105,.55)';
            context.setLineDash([3, 3]);
            context.beginPath();
            context.moveTo(x, top);
            context.lineTo(x, height - bottom);
            context.stroke();
            context.setLineDash([]);
            context.font = '11px system-ui';
            const labels = entries.map(({ item, point }) => { const vam = point.grade === 0 ? 0 : Math.round(36000 * Math.abs(point.grade) / point.seconds); return `${item.curve.name.slice(0, 24)} · ${point.grade}% · ${paceText(point.seconds)}/km · ${(3600 / point.seconds).toFixed(1)} km/h · ${vam} m/h`; }), boxWidth = Math.min(width - left - right, Math.max(...labels.map(label => context.measureText(label).width)) + 14), boxHeight = labels.length * 17 + 10, boxX = Math.min(width - right - boxWidth, Math.max(left, x + 8)), boxY = top + 6;
            context.fillStyle = 'rgba(17,24,39,.92)';
            context.fillRect(boxX, boxY, boxWidth, boxHeight);
            labels.forEach((label, index) => { context.fillStyle = entries[index].item.color; context.fillRect(boxX + 6, boxY + 8 + index * 17, 5, 5); context.fillStyle = '#fff'; context.fillText(label, boxX + 16, boxY + 14 + index * 17); });
        }
    }
}
function drawSpeedComparison() {
    speedHeading.hidden = speedCanvas.hidden = !paceChartPreferences.showSpeed;
    if (!paceChartPreferences.showSpeed)
        return;
    const curves = comparedPaceCurves(), points = curves.flatMap(item => item.points), { context, width, height } = prepareComparisonCanvas(speedCanvas), left = 54, right = 58, top = 18, bottom = 34;
    context.clearRect(0, 0, width, height);
    if (points.length < 2) {
        context.fillStyle = '#667281';
        context.font = '14px system-ui';
        context.fillText('Select a curve with at least two valid points.', left + 12, height / 2);
        return;
    }
    const { minGrade, maxGrade } = curveBounds(points), speeds = points.map(point => 3600 / point.seconds), minSpeed = Math.min(...speeds), maxSpeed = Math.max(...speeds), speedRange = Math.max(.5, maxSpeed - minSpeed), maxVam = Math.max(100, ...points.map(point => point.grade === 0 ? 0 : 36000 * Math.abs(point.grade) / point.seconds)), X = drawComparisonGradeGrid(context, width, height, minGrade, maxGrade, left, right, top, bottom), Y = (speed: number) => top + (maxSpeed + speedRange * .1 - speed) / (speedRange * 1.2) * (height - top - bottom), V = paceChartPreferences.showVam ? drawVamScale(context, width, height, left, right, top, bottom, maxVam) : null;
    context.font = '11px system-ui';
    for (let index = 0; index <= 5; index++) {
        const speed = minSpeed + (maxSpeed - minSpeed) * index / 5, y = Y(speed);
        context.strokeStyle = 'rgba(148,163,184,.3)';
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        context.fillStyle = '#667281';
        context.textAlign = 'right';
        context.fillText(speed.toFixed(1), left - 5, y + 4);
    }
    curves.forEach(item => {
        if (V) {
            context.strokeStyle = item.color;
            context.globalAlpha = .72;
            context.lineWidth = 1.8;
            context.setLineDash([6, 4]);
            context.beginPath();
            item.points.forEach((point, index) => { const y = V(point.grade === 0 ? 0 : 36000 * Math.abs(point.grade) / point.seconds); index ? context.lineTo(X(point.grade), y) : context.moveTo(X(point.grade), y); });
            context.stroke();
            context.setLineDash([]);
            context.globalAlpha = 1;
        }
        context.strokeStyle = item.color;
        context.lineWidth = item.curve.id === activePaceCurveId ? 3 : 2.2;
        context.beginPath();
        item.points.forEach((point, index) => index ? context.lineTo(X(point.grade), Y(3600 / point.seconds)) : context.moveTo(X(point.grade), Y(3600 / point.seconds)));
        context.stroke();
        context.fillStyle = item.color;
        item.points.forEach(point => { context.beginPath(); context.arc(X(point.grade), Y(3600 / point.seconds), item.curve.id === activePaceCurveId ? 4 : 3, 0, Math.PI * 2); context.fill(); });
    });
    context.textAlign = 'start';
    if (hoveredSpeedGrade !== null) {
        const entries = curves.map(item => ({ item, point: item.points.reduce((best, point) => Math.abs(point.grade - hoveredSpeedGrade!) < Math.abs(best.grade - hoveredSpeedGrade!) ? point : best, item.points[0]) })).filter(entry => entry.point), x = X(hoveredSpeedGrade);
        if (entries.length) {
            context.strokeStyle = 'rgba(71,85,105,.55)';
            context.setLineDash([3, 3]);
            context.beginPath();
            context.moveTo(x, top);
            context.lineTo(x, height - bottom);
            context.stroke();
            context.setLineDash([]);
            context.font = '11px system-ui';
            const labels = entries.map(({ item, point }) => { const speed = 3600 / point.seconds, vam = point.grade === 0 ? 0 : Math.round(36000 * Math.abs(point.grade) / point.seconds); return `${item.curve.name.slice(0, 24)} · ${point.grade}% · ${speed.toFixed(1)} km/h · ${paceText(point.seconds)}/km · ${vam} m/h`; }), boxWidth = Math.min(width - left - right, Math.max(...labels.map(label => context.measureText(label).width)) + 14), boxHeight = labels.length * 17 + 10, boxX = Math.min(width - right - boxWidth, Math.max(left, x + 8)), boxY = top + 6;
            context.fillStyle = 'rgba(17,24,39,.92)';
            context.fillRect(boxX, boxY, boxWidth, boxHeight);
            labels.forEach((label, index) => { context.fillStyle = entries[index].item.color; context.fillRect(boxX + 6, boxY + 8 + index * 17, 5, 5); context.fillStyle = '#fff'; context.fillText(label, boxX + 16, boxY + 14 + index * 17); });
        }
    }
}
const redrawHorizontalVamGuides = () => { drawPaceComparison(); drawSpeedComparison(); renderPaceComparisonControls(); };
showVamGuides.addEventListener('change', redrawHorizontalVamGuides);
comparisonList.addEventListener('change', event => {
    const input = event.target as HTMLInputElement, id = input.dataset.compareCurve;
    if (!id)
        return;
    const selected = new Set(paceChartPreferences.curveIds);
    if (input.checked)
        selected.add(id);
    else if (selected.size > 1)
        selected.delete(id);
    else {
        input.checked = true;
        paceLibraryStatus.textContent = 'Keep at least one curve selected for comparison.';
        return;
    }
    paceChartPreferences.curveIds = [...selected];
    savePaceChartPreferences();
    redrawHorizontalVamGuides();
});
const updateChartSeries = () => {
    if (!showPaceCurves.checked && !showSpeedCurves.checked) {
        showPaceCurves.checked = true;
        paceLibraryStatus.textContent = 'Keep at least one of the Pace or Speed charts enabled.';
    }
    paceChartPreferences = { ...paceChartPreferences, showPace: showPaceCurves.checked, showSpeed: showSpeedCurves.checked, showVam: showVamCurves.checked };
    savePaceChartPreferences();
    redrawHorizontalVamGuides();
};
showPaceCurves.onchange = updateChartSeries;
showSpeedCurves.onchange = updateChartSeries;
showVamCurves.onchange = updateChartSeries;
redrawHorizontalVamGuides();
function syncWorkspace() {
    const showPacePage = location.hash === '#pace';
    routePage.hidden = showPacePage;
    pacePanel.hidden = !showPacePage;
    header.querySelector('h1')!.textContent = showPacePage ? 'Pace curve' : 'Terrain analyser';
    header.querySelector('p:last-child')!.textContent = showPacePage
        ? 'Build and save your personal pace and VAM curve.'
        : 'Break GPX routes into useful climb, descent, flat, and rolling sections.';
    header.querySelectorAll<HTMLAnchorElement>('[data-page-link]').forEach(link => {
        const active = link.dataset.pageLink === (showPacePage ? 'pace' : 'route');
        if (active)
            link.setAttribute('aria-current', 'page');
        else
            link.removeAttribute('aria-current');
    });
    requestAnimationFrame(() => showPacePage ? redrawHorizontalVamGuides() : profile.length && draw(profile));
}
window.addEventListener('hashchange', syncWorkspace);
syncWorkspace();
const uniquePaceCurveName = (requested: string, ignoreId?: string) => {
    const base = requested.trim() || 'Pace curve', names = new Set(paceCurves.filter(curve => curve.id !== ignoreId).map(curve => curve.name.toLocaleLowerCase()));
    if (!names.has(base.toLocaleLowerCase()))
        return base;
    let suffix = 2;
    while (names.has(`${base} ${suffix}`.toLocaleLowerCase()))
        suffix++;
    return `${base} ${suffix}`;
};
const syncPaceCurveControls = () => {
    const options = paceCurves.map(curve => `<option value="${escapeHtml(curve.id)}">${escapeHtml(curve.name)}</option>`).join('');
    paceCurveSelect.innerHTML = options;
    analysisCurveSelect.innerHTML = options;
    paceCurveSelect.value = activePaceCurveId;
    analysisCurveSelect.value = activePaceCurveId;
    paceCurveName.value = activePaceCurve().name;
    deletePaceCurve.disabled = paceCurves.length <= 1;
    renderPaceComparisonControls();
};
const selectPaceCurve = (id: string) => {
    if (id === activePaceCurveId || !paceCurves.some(curve => curve.id === id))
        return;
    savePace();
    activePaceCurveId = id;
    pacePoints = activePaceCurve().points;
    savePace();
    syncPaceCurveControls();
    renderPace();
    redrawHorizontalVamGuides();
    if (paceEstimate && p.length && p.every(point => point.ele !== null)) {
        if (curvePoints().length >= 2)
            runPaceAnalysis();
        else
            analyse();
    }
};
paceCurveSelect.onchange = () => selectPaceCurve(paceCurveSelect.value);
analysisCurveSelect.onchange = () => selectPaceCurve(analysisCurveSelect.value);
paceCurveName.oninput = () => {
    const name = paceCurveName.value.trim();
    if (!name) {
        paceLibraryStatus.textContent = 'A pace curve needs a name.';
        return;
    }
    activePaceCurve().name = name;
    [paceCurveSelect, analysisCurveSelect].forEach(select => {
        const option = [...select.options].find(item => item.value === activePaceCurveId);
        if (option)
            option.textContent = name;
    });
    renderPaceComparisonControls();
    if (savePace())
        paceLibraryStatus.textContent = 'Curve name saved.';
};
paceCurveName.onchange = () => {
    const requested = paceCurveName.value.trim();
    if (!requested) {
        paceCurveName.value = activePaceCurve().name;
        paceLibraryStatus.textContent = 'A pace curve needs a name.';
        return;
    }
    const name = uniquePaceCurveName(requested, activePaceCurveId);
    activePaceCurve().name = name;
    savePace();
    syncPaceCurveControls();
    paceLibraryStatus.textContent = `Saved as ${name}.`;
};
newPaceCurve.onclick = () => {
    const template = builtInPaceCurves.find(curve => curve.key === builtInPaceSelect.value) ?? builtInPaceCurves[0], curve: SavedPaceCurve = { id: createPaceCurveId(), name: uniquePaceCurveName('New pace curve'), points: cloneBuiltInPaceCurve(template) };
    paceCurves.push(curve);
    paceChartPreferences.curveIds.push(curve.id);
    savePaceChartPreferences();
    activePaceCurveId = curve.id;
    pacePoints = curve.points;
    savePace();
    syncPaceCurveControls();
    renderPace();
    redrawHorizontalVamGuides();
    paceCurveName.focus();
    paceCurveName.select();
    paceLibraryStatus.textContent = `New curve created from the ${template.name} built-in values.`;
};
duplicatePaceCurve.onclick = () => {
    const source = activePaceCurve(), curve: SavedPaceCurve = { id: createPaceCurveId(), name: uniquePaceCurveName(`${source.name} copy`), points: source.points.map(point => ({ ...point })) };
    paceCurves.push(curve);
    paceChartPreferences.curveIds.push(curve.id);
    savePaceChartPreferences();
    activePaceCurveId = curve.id;
    pacePoints = curve.points;
    savePace();
    syncPaceCurveControls();
    renderPace();
    redrawHorizontalVamGuides();
    paceCurveName.focus();
    paceCurveName.select();
    paceLibraryStatus.textContent = 'Curve duplicated.';
};
deletePaceCurve.onclick = () => {
    if (paceCurves.length <= 1)
        return;
    const deleting = activePaceCurve();
    if (!window.confirm(`Delete “${deleting.name}”?`))
        return;
    const index = paceCurves.indexOf(deleting);
    paceCurves.splice(index, 1);
    const next = paceCurves[Math.min(index, paceCurves.length - 1)];
    paceChartPreferences.curveIds = paceChartPreferences.curveIds.filter(id => id !== deleting.id);
    if (!paceChartPreferences.curveIds.length)
        paceChartPreferences.curveIds = [next.id];
    savePaceChartPreferences();
    activePaceCurveId = next.id;
    pacePoints = next.points;
    savePace();
    syncPaceCurveControls();
    renderPace();
    redrawHorizontalVamGuides();
    paceLibraryStatus.textContent = `Deleted ${deleting.name}.`;
};
exportPaceCurves.onclick = () => {
    savePace();
    const backup = { format: 'route-analyser-pace-curves', version: 1, exportedAt: new Date().toISOString(), selectedCurveId: activePaceCurveId, curves: paceCurves }, url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url;
    link.download = 'route-analyser-pace-curves.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    paceLibraryStatus.textContent = `Exported ${paceCurves.length} ${paceCurves.length === 1 ? 'curve' : 'curves'}.`;
};
importPaceCurves.onchange = async () => {
    const file = importPaceCurves.files?.[0];
    if (!file)
        return;
    try {
        if (file.size > 2_000_000)
            throw Error('This backup is too large to import.');
        const value = parseValidatedPaceCurveBackup(JSON.parse(await file.text()));
        if (!value)
            throw Error('This is not a valid Route Analyser pace-curve backup.');
        const imported = value.curves;
        const importedIds = new Map<string, string>();
        imported.forEach(source => {
            const id = paceCurves.some(curve => curve.id === source.id) ? createPaceCurveId() : source.id, curve: SavedPaceCurve = { id, name: uniquePaceCurveName(source.name), points: source.points.map(point => ({ ...point })) };
            importedIds.set(source.id, id);
            paceCurves.push(curve);
            paceChartPreferences.curveIds.push(curve.id);
        });
        paceChartPreferences.curveIds = [...new Set(paceChartPreferences.curveIds)];
        savePaceChartPreferences();
        activePaceCurveId = value.selectedCurveId && importedIds.has(value.selectedCurveId) ? importedIds.get(value.selectedCurveId)! : importedIds.values().next().value!;
        pacePoints = activePaceCurve().points;
        savePace();
        syncPaceCurveControls();
        renderPace();
        redrawHorizontalVamGuides();
        paceLibraryStatus.textContent = `Imported ${imported.length} ${imported.length === 1 ? 'curve' : 'curves'} without replacing your existing curves.`;
    }
    catch (problem) {
        paceLibraryStatus.textContent = problem instanceof Error ? problem.message : 'Could not import this pace-curve backup.';
    }
    finally {
        importPaceCurves.value = '';
    }
};
loadBuiltInPace.onclick = () => { const template = builtInPaceCurves.find(curve => curve.key === builtInPaceSelect.value) ?? builtInPaceCurves[0]; pacePoints = cloneBuiltInPaceCurve(template); savePace(); renderPace(); redrawHorizontalVamGuides(); paceLibraryStatus.textContent = `Loaded the ${template.name} built-in values into ${activePaceCurve().name}.`; };
syncPaceCurveControls();
savePace();
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
waypointLegend.textContent = '● Named route point';
waypointLegend.style.color = '#2563eb';
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
counterControl.style.cssText = 'display:flex;align-items:center;gap:7px';
counterControl.innerHTML = `<input id="counter-bridge" type="checkbox" checked style="width:auto"> Bridge short counter-slopes`;
const counterLengthControl = document.createElement('label');
counterLengthControl.innerHTML = `Counter-slope bridge <output id="counterBridgeOut">250 m</output><input id="counter-bridge-length" type="range" min="0" max="1000" step="25" value="250">`;
const smoothingControl = document.createElement('label');
smoothingControl.innerHTML = `Profile smoothing <output id="smoothingOut">50 m</output><input id="smoothing" type="range" min="0" max="300" step="10" value="50">`;
$('.controls').append(counterControl, counterLengthControl, smoothingControl);
const counterBridge = $('#counter-bridge') as HTMLInputElement, counterBridgeLength = $('#counter-bridge-length') as HTMLInputElement, profileSmoothing = $('#smoothing') as HTMLInputElement;
counterBridge.onchange = () => { if (p.length && p.every(x => x.ele !== null))
    analyse(); };
counterBridgeLength.oninput = () => { $('#counterBridgeOut').textContent = `${counterBridgeLength.value} m`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
profileSmoothing.oninput = () => { $('#smoothingOut').textContent = `${profileSmoothing.value} m`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
const settingsExplanation = document.querySelector('details ul')!;
settingsExplanation.children[1].innerHTML = '<b>Rolling window</b> sets the maximum span considered at one time when detecting internally alternating uphill and downhill terrain. Overlapping rolling spans may combine into a longer rolling section.';
settingsExplanation.children[4].innerHTML = '<b>Total ascent and descent</b> sum every change in the unsmoothed point-to-point elevation profile, so small undulations—and any elevation noise—are retained.';
settingsExplanation.insertAdjacentHTML('beforeend', '<li><b>Profile smoothing</b> averages elevations over the selected distance before plotting and classifying terrain. Lower values preserve shorter features but may reveal more elevation noise. It does not affect total ascent or descent.</li><li><b>Bridge short counter-slopes</b> keeps a sustained climb or descent together across a short interruption in the opposite direction, subject to its separate distance and reversal limits.</li>');
const counterReversalControl = document.createElement('label');
counterReversalControl.innerHTML = `Counter-slope reversal <output id="counterReversalOut">5%</output><input id="counter-reversal" type="range" min="0" max="20" step=".5" value="5">`;
$('.controls').append(counterReversalControl);
const counterReversal = $('#counter-reversal') as HTMLInputElement;
counterReversal.oninput = () => { $('#counterReversalOut').textContent = `${counterReversal.value}%`; if (p.length && p.every(x => x.ele !== null))
    analyse(); };
settingsExplanation.insertAdjacentHTML('beforeend', '<li><b>Counter-slope reversal</b> allows a short opposing rise/fall when it is no more than this percentage of the combined elevation change in the neighbouring sections.</li>');
const criteria = document.createElement('details');
criteria.innerHTML = `<summary>How sections are decided</summary><h3>Primary sections</h3><ul><li>Local slope is measured over roughly 100 m, after elevation smoothing at the selected Profile smoothing distance.</li><li>It is a climb or descent at or beyond the grade threshold; otherwise it starts as flat.</li><li>Nearby uphill and downhill movements become rolling when a span within the rolling window contains both directions and has little net change. Overlapping spans may combine into a longer rolling section.</li><li>Fragments shorter than Minimum section are absorbed into a neighbour.</li><li>Same-direction primary sections may be joined across a short flat/rolling bridge or an enabled short counter-slope. A flat/rolling bridge must be no more than 25% of either adjoining section.</li></ul><h3>Sub-sections</h3><ul><li>Local gradients below the grade threshold become sub-rolling. At or above the threshold, gentle is below threshold + 3%, moderate is below threshold + 7%, and steep is at or above threshold + 7%.</li><li>A band change must persist for at least Minimum section before it becomes a new sub-section.</li><li>Each child’s displayed elevation change and label use its own unsmoothed end-to-end elevation change. Unsmoothed means the elevations supplied by the GPX or filled from Mapterhorn. Opposite-direction children are marked local counter-slope or bridged counter-slope.</li></ul>`;
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
settingsControls.replaceChildren(settingsGroup('Route', routeFile, exampleRouteControl), settingsGroup('Recorded activity', activityControl, pauseControl, restDetectionControl, movingSpeedControl), settingsGroup('Terrain classification', gradeControl, windowControl, minimumControl, smoothingControl), settingsGroup('Joining interruptions', bridgeControl, counterControl, counterLengthControl, counterReversalControl));
type ParsedRoute = { points: P[]; waypoints: W[]; warnings: string[] };
const childText = (element: Element, name: string) => [...element.children].find(child => child.localName === name)?.textContent;
const parsePoint = (element: Element) => {
    const elevationText = childText(element, 'ele'), elevation = elevationText === undefined ? null : Number(elevationText);
    return {
        lat: Number(element.getAttribute('lat')),
        lon: Number(element.getAttribute('lon')),
        ele: Number.isFinite(elevation) ? elevation : null,
    };
};
const validPoints = (elements: Element[]) => elements.map(parsePoint).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
function parse(x: string): ParsedRoute {
    const document = new DOMParser().parseFromString(x, 'application/xml');
    if (document.querySelector('parsererror'))
        throw Error('This GPX could not be read.');
    const parsedWaypoints = [...document.querySelectorAll('wpt')].flatMap(element => {
        const name = childText(element, 'name')?.trim();
        if (!name)
            return [];
        const point = parsePoint(element);
        return [{ ...point, name }];
    }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    const trackSources = [...document.querySelectorAll('trk')].map(track => {
        const trackSegments = [...track.children].filter(child => child.localName === 'trkseg');
        const segments = trackSegments.map(segment => validPoints([...segment.children].filter(child => child.localName === 'trkpt'))).filter(segment => segment.length >= 2);
        if (segments.length)
            return segments;
        const directPoints = validPoints([...track.children].filter(child => child.localName === 'trkpt'));
        return directPoints.length >= 2 ? [directPoints] : [];
    });
    const routeSources = [...document.querySelectorAll('rte')].map(route => [validPoints([...route.children].filter(child => child.localName === 'rtept'))]).filter(source => source[0].length >= 2);
    const selected = selectLongestRouteChain([...trackSources, ...routeSources]);
    if (selected.points.length < 3)
        throw Error('No usable GPX track or route was found.');
    const points = accumulateSegments([selected.points]) as P[];
    if ((points.at(-1)?.d ?? 0) < 10)
        throw Error('The selected trace does not contain at least 10 m of usable route distance.');
    const warnings = selected.discardedChains
        ? [`Ignored ${selected.discardedChains} disconnected GPX ${selected.discardedChains === 1 ? 'part' : 'parts'} instead of adding artificial distance between them.`]
        : [];
    return { points, waypoints: parsedWaypoints, warnings };
}
function setParsedRoute(parsed: ParsedRoute) {
    p = parsed.points;
    waypoints = parsed.waypoints;
    routeWarnings = parsed.warnings;
    profile = [];
    routeWaypoints = [];
    renderWaypoints();
}
function loadRouteText(text: string, name: string) {
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
    setParsedRoute(parse(text));
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
    loadRouteText(await f.text(), f.name);
}
catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Could not read GPX.';
} };
const hav = (a: Pick<P, 'lat' | 'lon'>, b: Pick<P, 'lat' | 'lon'>) => haversineMeters(a, b);
function renderWaypoints() {
    const named = waypoints;
    routeWaypoints = [];
    if (!p.length) {
        waypointPanel.hidden = true;
        return;
    }
    const snapped = new Map<number, W[]>(), ignored: string[] = [];
    named.forEach(waypoint => {
        let index = 0, best = Infinity;
        p.forEach((point, pointIndex) => {
            const distance = hav(waypoint, point);
            if (distance < best) {
                best = distance;
                index = pointIndex;
            }
        });
        if (best > 250) {
            ignored.push(waypoint.name);
            return;
        }
        const values = snapped.get(index) ?? [];
        values.push(waypoint);
        snapped.set(index, values);
    });
    const endpoint = (name: string, index: number): { waypoint: W; index: number } => ({ waypoint: { name, lat: p[index].lat, lon: p[index].lon, ele: p[index].ele }, index });
    const finalIndex = p.length - 1;
    routeWaypoints = [...snapped.entries()].map(([index, values]) => ({
        index,
        waypoint: {
            name: values.map(value => value.name).join(' / '),
            lat: p[index].lat,
            lon: p[index].lon,
            ele: values.length === 1 ? values[0].ele : p[index].ele,
        },
    }));
    const start = routeWaypoints.find(point => point.index === 0);
    if (start)
        start.waypoint.name = `Start — ${start.waypoint.name}`;
    else
        routeWaypoints.push(endpoint('Start', 0));
    const end = routeWaypoints.find(point => point.index === finalIndex);
    if (end)
        end.waypoint.name = `End — ${end.waypoint.name}`;
    else
        routeWaypoints.push(endpoint('End', finalIndex));
    routeWaypoints.sort((a, b) => a.index - b.index);
    waypointPanel.hidden = false;
    const warning = waypointPanel.querySelector<HTMLElement>('.waypoint-warning')!;
    warning.hidden = !ignored.length;
    warning.textContent = ignored.length ? `${ignored.length} named ${ignored.length === 1 ? 'waypoint was' : 'waypoints were'} ignored because the nearest route point was more than 250 m away: ${ignored.join(', ')}.` : '';
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
} return routePrediction = predictRoutePace(p, profile, curve); }
function parseActivity(text: string): ActivityPoint[] {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror'))
        throw Error('This activity GPX could not be read.');
    const tracks = [...xml.querySelectorAll('trk')].map(track => {
        const trackSegments = [...track.children].filter(child => child.localName === 'trkseg');
        const segmentElements = trackSegments.length ? trackSegments : [track];
        return segmentElements.map(segment => [...segment.children].filter(child => child.localName === 'trkpt').map(point => {
        const parsed = parsePoint(point), time = Date.parse(childText(point, 'time') || '');
        return { ...parsed, time };
    }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.time)))
            .filter(segment => segment.length);
    });
    const candidates = tracks.map(segments => ({ segments, points: accumulateSegments(segments) })).filter(candidate => candidate.points.length >= 3)
        .sort((a, b) => (b.points.at(-1)?.d ?? 0) - (a.points.at(-1)?.d ?? 0) || b.points.length - a.points.length);
    const selected = candidates[0];
    if (!selected)
        throw Error('The activity needs at least three timestamped track points.');
    return selected.points.map(point => ({ ...point, moving: 0, routeD: 0 }));
}
function applyActivityMovingTime(points: ActivityPoint[]) {
    const gapCutoff = Number(activityPause.value) * 1000, minimumSpeed = activityRestDetection.checked ? Number(activityMovingSpeed.value) / 3.6 : 0, windowRadius = 15000;
    let moving = 0, left = 0, right = 0;
    return points.map((point, index) => {
        while (left < index && (points[left].segment !== point.segment || point.time - points[left].time > windowRadius))
            left++;
        right = Math.max(right, index);
        while (right + 1 < points.length && points[right + 1].segment === point.segment && points[right + 1].time - point.time <= windowRadius)
            right++;
        if (index && !point.breakBefore && points[index - 1].segment === point.segment) {
            const elapsed = point.time - points[index - 1].time, windowSeconds = (points[right].time - points[left].time) / 1000, windowSpeed = windowSeconds > 0 ? hav(points[left], points[right]) / windowSeconds : 0;
            if (elapsed >= 0 && elapsed <= gapCutoff && windowSpeed >= minimumSpeed)
                moving += elapsed / 1000;
        }
        return { ...point, moving };
    });
}
function matchActivityToRoute(points: ActivityPoint[]) {
    if (!p.length)
        throw Error('Upload and analyse a route before an activity.');
    const match = matchRouteSamples(p, points);
    activityMatchQuality = match.quality;
    if (match.quality.orientation === 'reverse')
        throw Error('This activity appears to follow the route in reverse. Reverse-direction comparison is detected, but is not yet supported.');
    if (!isConfidentRouteMatch(match.quality))
        throw Error(`The activity could not be matched confidently to this route (median error ${Math.round(match.quality.medianError)} m, 90th percentile ${Math.round(match.quality.p90Error)} m, ${Math.round(match.quality.within150m)}% within 150 m).`);
    const matched = points.map((point, index) => ({ ...point, routeD: p[match.indices[index]].d }));
    return applyActivityMovingTime(matched);
}
function interpolateRouteTime(distance: number) { if (!routePrediction || distance < 0 || distance > p.at(-1)!.d)
    return null; const index = locate(distance); if (index === 0)
    return routePrediction.cumulative[0]; const a = p[index - 1], b = p[index], fraction = (distance - a.d) / Math.max(1, b.d - a.d); return routePrediction.cumulative[index - 1] + (routePrediction.cumulative[index] - routePrediction.cumulative[index - 1]) * fraction; }
function interpolateActivityTime(distance: number) { if (activity.length < 2 || distance < activity[0].routeD || distance > activity.at(-1)!.routeD)
    return null; let low = 0, high = activity.length - 1; while (low < high) {
    const middle = (low + high) >> 1;
    activity[middle].routeD < distance ? low = middle + 1 : high = middle;
} if (low === 0)
    return activity[0].moving; const a = activity[low - 1], b = activity[low], span = b.routeD - a.routeD; if (span < 1)
    return b.moving; return a.moving + (b.moving - a.moving) * (distance - a.routeD) / span; }
function signedDuration(seconds: number) { const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : ''; return `${sign}${durationText(Math.abs(seconds))}`; }
function activityComparison(from: number, to: number) { const expectedStart = interpolateRouteTime(from), expectedEnd = interpolateRouteTime(to), actualStart = interpolateActivityTime(from), actualEnd = interpolateActivityTime(to); if (expectedStart === null || expectedEnd === null || actualStart === null || actualEnd === null)
    return null; const expected = expectedEnd - expectedStart, actual = actualEnd - actualStart; return { expected, actual, delta: actual - expected }; }
function drawActivityComparison() { const canvas = activityPanel.querySelector<HTMLCanvasElement>('#activity-chart'); if (!canvas || !routePrediction || activity.length < 2)
    return; const rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1; canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; const context = canvas.getContext('2d')!; context.scale(ratio, ratio); const W = rect.width, H = rect.height, L = 52, R = 16, T = 18, B = 32, start = activity[0].routeD, end = activity.at(-1)!.routeD, actualDuration = activity.at(-1)!.moving - activity[0].moving, predictedStart = interpolateRouteTime(start)!, predictedEnd = interpolateRouteTime(end)!, predictedDuration = predictedEnd - predictedStart, maxTime = Math.max(actualDuration, predictedDuration, 1), X = (distance: number) => L + (distance - start) / Math.max(1, end - start) * (W - L - R), Y = (seconds: number) => T + (maxTime * 1.08 - seconds) / (maxTime * 1.08) * (H - T - B); context.clearRect(0, 0, W, H); context.strokeStyle = '#cbd3db'; context.beginPath(); context.moveTo(L, T); context.lineTo(L, H - B); context.lineTo(W - R, H - B); context.stroke(); context.font = '11px system-ui'; context.fillStyle = '#667281'; for (let i = 0; i <= 4; i++) {
    const seconds = maxTime * i / 4, y = Y(seconds);
    context.strokeStyle = 'rgba(148,163,184,.35)';
    context.beginPath();
    context.moveTo(L, y);
    context.lineTo(W - R, y);
    context.stroke();
    context.fillText(durationText(seconds), 3, y + 4);
} context.strokeStyle = '#2563eb'; context.lineWidth = 2.5; context.beginPath(); for (let i = 0; i < p.length; i++) {
    const distance = p[i].d;
    if (distance < start || distance > end)
        continue;
    const elapsed = routePrediction.cumulative[i] - predictedStart;
    context.lineTo(X(distance), Y(elapsed));
} context.stroke(); context.strokeStyle = '#d97706'; context.lineWidth = 2.5; context.beginPath(); activity.forEach((point, index) => index ? context.lineTo(X(point.routeD), Y(point.moving - activity[0].moving)) : context.moveTo(X(point.routeD), Y(0))); context.stroke(); context.fillStyle = '#2563eb'; context.fillText('Predicted moving time', L + 6, T + 12); context.fillStyle = '#d97706'; context.fillText('Actual moving time', L + 132, T + 12); context.fillStyle = '#667281'; context.fillText(fmt(start), L, H - 8); context.fillText(fmt(end), W - R - 45, H - 8); }
function activityGradientSamples() { const samples: {
    grade: number;
    pace: number;
}[] = []; let start = 0; for (let end = 1; end < activity.length; end++) {
    const distance = activity[end].routeD - activity[start].routeD;
    if (distance < 100)
        continue;
    const seconds = activity[end].moving - activity[start].moving, midpoint = (activity[end].routeD + activity[start].routeD) / 2, grade = localGradeAtDistance(p, profile, midpoint), pace = seconds / (distance / 1000);
    if (seconds > 0 && Number.isFinite(pace) && pace > 30 && pace < 7200)
        samples.push({ grade, pace });
    start = end;
} return samples; }
function drawActivityGradient() { const canvas = activityPanel.querySelector<HTMLCanvasElement>('#activity-gradient-chart'), curve = curvePoints(); if (!canvas || curve.length < 2)
    return; const actual = activityGradientSamples(), rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1; canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; const context = canvas.getContext('2d')!; context.scale(ratio, ratio); const W = rect.width, H = rect.height, L = 46, R = 16, T = 18, B = 32, grades = [...curve.map(point => point.grade), ...actual.map(point => point.grade)], paces = [...curve.map(point => point.seconds), ...actual.map(point => point.pace)], minGrade = Math.min(-5, ...grades), maxGrade = Math.max(5, ...grades), minPace = Math.min(...paces), maxPace = Math.max(...paces), paceRange = Math.max(30, maxPace - minPace), X = (grade: number) => L + (grade - minGrade) / Math.max(1, maxGrade - minGrade) * (W - L - R), Y = (pace: number) => T + (pace - minPace + paceRange * .1) / (paceRange * 1.2) * (H - T - B); context.clearRect(0, 0, W, H); context.strokeStyle = '#cbd3db'; context.beginPath(); context.moveTo(L, T); context.lineTo(L, H - B); context.lineTo(W - R, H - B); context.stroke(); context.font = '11px system-ui'; for (let i = 0; i <= 4; i++) {
    const pace = minPace + (maxPace - minPace) * i / 4, y = Y(pace);
    context.strokeStyle = 'rgba(148,163,184,.35)';
    context.beginPath();
    context.moveTo(L, y);
    context.lineTo(W - R, y);
    context.stroke();
    context.fillStyle = '#667281';
    context.fillText(paceText(pace), 3, y + 4);
} const tick = Math.max(5, Math.ceil((maxGrade - minGrade) / 8 / 5) * 5); context.textAlign = 'center'; for (let grade = Math.ceil(minGrade / tick) * tick; grade <= maxGrade; grade += tick) {
    const x = X(grade);
    context.strokeStyle = grade === 0 ? '#64748b' : '#d7dde5';
    context.setLineDash(grade === 0 ? [4, 3] : []);
    context.beginPath();
    context.moveTo(x, T);
    context.lineTo(x, H - B);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#667281';
    context.fillText(`${grade}%`, x, H - 8);
} context.strokeStyle = '#2563eb'; context.lineWidth = 2.5; context.beginPath(); curve.sort((a, b) => a.grade - b.grade).forEach((point, index) => index ? context.lineTo(X(point.grade), Y(point.seconds)) : context.moveTo(X(point.grade), Y(point.seconds))); context.stroke(); context.fillStyle = 'rgba(217,119,6,.82)'; actual.forEach(point => { context.beginPath(); context.arc(X(point.grade), Y(point.pace), 3, 0, Math.PI * 2); context.fill(); }); context.textAlign = 'start'; context.fillStyle = '#2563eb'; context.fillText('Pace curve', L + 6, T + 12); context.fillStyle = '#d97706'; context.fillText(`Actual 100 m samples (${actual.length})`, L + 76, T + 12); }
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
        qualityText: activityMatchQuality ? `${Math.round(activityMatchQuality.within150m)}% of samples within 150 m; median ${Math.round(activityMatchQuality.medianError)} m and 90th percentile ${Math.round(activityMatchQuality.p90Error)} m.` : 'Match quality unavailable.',
        guidanceHtml: [...byKind.entries()].filter(([, value]) => value.expected > 60).map(([kind, value]) => { const difference = (value.actual / value.expected - 1) * 100; return `<li><b>${kind[0].toUpperCase() + kind.slice(1)}:</b> ${Math.abs(difference).toFixed(0)}% ${difference > 0 ? 'slower' : 'faster'} than the selected curve.</li>`; }).join('') || '<li>Not enough route coverage for section-level calibration.</li>',
    }, curveName = escapeHtml(viewModel.curveName); activityPanel.innerHTML = `<div class="prediction-head"><div><p class="eyebrow">Activity versus ${curveName}</p><h2>${signedDuration(viewModel.differenceSeconds)}</h2></div><p>${durationText(viewModel.actualSeconds)} moving versus ${durationText(viewModel.expectedSeconds)} predicted across ${viewModel.coveragePercent.toFixed(0)}% of the route. Positive means slower than predicted.</p></div><div class="activity-stats"><article><b>${durationText(viewModel.elapsedSeconds)}</b><span>Elapsed time</span></article><article><b>${durationText(viewModel.actualSeconds)}</b><span>Moving time</span></article><article><b>${durationText(viewModel.expectedSeconds)}</b><span>Predicted time · ${curveName}</span></article><article><b>${paceText(viewModel.actualSeconds / (viewModel.distance / 1000))}/km</b><span>Actual average pace</span></article></div><p class="match-quality"><b>Route match:</b> ${viewModel.qualityText}</p><button type="button" id="activity-csv">Download activity comparison CSV</button><canvas id="activity-chart" aria-label="Actual and predicted cumulative moving time"></canvas><h3>Actual pace against the curve</h3><canvas id="activity-gradient-chart" aria-label="Actual pace samples against the pace curve"></canvas><details class="calibration" open><summary>Calibration indications</summary><p>These observations describe this activity; keep effort level and terrain context in mind before changing a curve.</p><ul>${viewModel.guidanceHtml}</ul></details>`; activityPanel.querySelector<HTMLButtonElement>('#activity-csv')!.onclick = downloadActivityCsv; renderTerrainTable(); renderWaypointSegments(); drawActivityComparison(); drawActivityGradient(); }
activityFile.onchange = async () => { const file = activityFile.files?.[0]; if (!file)
    return; error.textContent = ''; try {
    const text = await file.text(), recorded = parseActivity(text), useAsRoute = !p.length || !profile.length;
    if (useAsRoute) {
        result.hidden = true;
        fill.hidden = true;
        routePrediction = null;
        setParsedRoute(parse(text));
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
    status.textContent = `Activity loaded: ${activity.length.toLocaleString()} timestamped points ${useAsRoute ? 'analysed as its own route' : `matched to ${fmt(activity.at(-1)!.routeD - activity[0].routeD)} of the route`}.${activityMatchQuality ? ` Median route error ${Math.round(activityMatchQuality.medianError)} m; ${Math.round(activityMatchQuality.within150m)}% within 150 m.` : ''}`;
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
    return `<td>${durationText(metric.seconds)}</td><td>${metric.paceSecondsPerKm === null ? '—' : `${paceText(metric.paceSecondsPerKm)}/km`}</td><td>${metric.vamMetersPerHour === null ? '—' : vamText(metric.vamMetersPerHour, 3600)}</td><td>${durationText(metric.cumulativeSeconds)}</td>`;
}

function terrainTableHeader(showPrediction: boolean, showActivity: boolean) {
    const base = '<th rowspan="2">#</th><th rowspan="2">Type</th><th rowspan="2">From</th><th rowspan="2">To</th><th rowspan="2">Distance</th><th rowspan="2">Elevation change</th><th rowspan="2">Average grade</th>';
    if (!showPrediction)
        return '<tr><th>#</th><th>Type</th><th>From</th><th>To</th><th>Distance</th><th>Elevation change</th><th>Average grade</th></tr>';
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
            ? `<td>${durationText(row.actual.seconds)}</td><td>${row.actual.paceSecondsPerKm === null ? '—' : `${paceText(row.actual.paceSecondsPerKm)}/km`}</td><td>${row.actual.vamMetersPerHour === null ? '—' : vamText(row.actual.vamMetersPerHour, 3600)}</td><td>${durationText(row.actual.cumulativeSeconds)}</td><td>${signedDuration(row.actual.differenceSeconds)}</td>`
            : '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>'
        : '';
    return `<tr class="${row.child ? 'sub-row' : ''}" data-primary="${row.primaryIndex}"${hidden}><td>${toggle}${row.number}</td><td class="${row.kind}">${row.child ? '↳ ' : ''}${escapeHtml(row.label)}</td><td>${fmt(row.startDistance)}</td><td>${fmt(row.endDistance)}</td><td>${fmt(row.distance)}</td><td>${row.elevationChange >= 0 ? '+' : ''}${Math.round(row.elevationChange)} m</td><td>${row.averageGrade === null ? '—' : `${row.averageGrade.toFixed(1)}%`}</td>${predicted}${actual}</tr>`;
}

function renderTerrainTable() {
    const showPrediction = paceEstimate !== null && routePrediction !== null;
    const activityAccessor = showPrediction ? activityViewAccessor() : null;
    const rows = createTerrainRows(p, ms, showPrediction ? routePrediction : null, activityAccessor);
    const table = $('#rows').closest('table')!;
    table.querySelector('thead')!.innerHTML = terrainTableHeader(showPrediction, activityAccessor !== null);
    $('#rows').innerHTML = rows.map(row => terrainRowHtml(row, showPrediction, activityAccessor !== null)).join('');
}
function downloadActivityCsv() {
    if (!activity.length || !routePrediction)
        return;
    const header = ['record_type', 'section_number', 'start_name', 'end_name', 'start_distance_m', 'end_distance_m', 'distance_m', 'elevation_change_m', 'predicted_moving_time_s', 'predicted_pace_s_per_km', 'predicted_vam_m_per_h', 'predicted_cumulative_s', 'actual_moving_time_s', 'actual_pace_s_per_km', 'actual_vam_m_per_h', 'actual_cumulative_s', 'actual_minus_predicted_s', 'match_median_error_m', 'match_p90_error_m', 'match_within_150m_percent', 'recording_gap_cutoff_s', 'stationary_rest_detection', 'minimum_moving_speed_kmh', 'pace_curve_name', 'pace_curve_id'], rows: string[][] = [], add = (...values: (string | number | boolean | undefined | null)[]) => rows.push(values.map(value => value === undefined || value === null ? '' : String(value))), addComparison = (recordType: string, sectionNumber: string | number, startName: string, endName: string, from: number, to: number, change: number) => {
        const comparison = activityComparison(from, to), distance = to - from, predictedCumulative = interpolateRouteTime(to), actualAtEnd = interpolateActivityTime(to), actualCumulative = actualAtEnd === null ? undefined : actualAtEnd - activity[0].moving, summary = recordType === 'summary';
        add(recordType, sectionNumber, startName, endName, from, to, distance, change, comparison?.expected, comparison && distance > 0 ? comparison.expected / (distance / 1000) : undefined, comparison ? vamValue(change, comparison.expected) : undefined, predictedCumulative, comparison?.actual, comparison && distance > 0 ? comparison.actual / (distance / 1000) : undefined, comparison ? vamValue(change, comparison.actual) : undefined, actualCumulative, comparison?.delta, summary ? activityMatchQuality?.medianError : undefined, summary ? activityMatchQuality?.p90Error : undefined, summary ? activityMatchQuality?.within150m : undefined, summary ? Number(activityPause.value) : undefined, summary ? activityRestDetection.checked : undefined, summary ? Number(activityMovingSpeed.value) : undefined, activePaceCurve().name, activePaceCurveId);
    };
    const start = activity[0].routeD, end = activity.at(-1)!.routeD;
    addComparison('summary', '', '', '', start, end, profile[locate(end)] - profile[locate(start)]);
    ms.forEach((section, index) => { const from = p[section.a].d, to = p[section.b].d; addComparison('terrain_section', index + 1, '', '', from, to, p[section.b].ele! - p[section.a].ele!); section.c.forEach((child, childIndex) => addComparison('terrain_subsection', `${index + 1}.${childIndex + 1}`, '', '', p[child.a].d, p[child.b].d, p[child.b].ele! - p[child.a].ele!)); });
    routeWaypoints.slice(1).forEach((endPoint, position) => { const startPoint = routeWaypoints[position], geometry = routeWaypointGeometry(startPoint, endPoint); addComparison('waypoint_segment', '', startPoint.waypoint.name, endPoint.waypoint.name, p[startPoint.index].d, p[endPoint.index].d, geometry.elevationChange); });
    const csv = [header, ...rows].map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a');
    link.href = url;
    link.download = 'activity-comparison.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        ? `<td>${metric.paceSecondsPerKm === null ? '—' : `${paceText(metric.paceSecondsPerKm)}/km`}</td><td>${metric.vamMetersPerHour === null ? '—' : vamText(metric.vamMetersPerHour, 3600)}</td><td>${durationText(metric.seconds)}</td><td>${durationText(metric.cumulativeSeconds)}</td>`
        : '<td>—</td><td>—</td><td>—</td><td>—</td>';
    const showActivity = activityAccessor !== null;
    const rows = viewModel.rows.map(row => {
        const actual = showActivity
            ? row.actual
                ? `<td>${row.actual.paceSecondsPerKm === null ? '—' : `${paceText(row.actual.paceSecondsPerKm)}/km`}</td><td>${row.actual.vamMetersPerHour === null ? '—' : vamText(row.actual.vamMetersPerHour, 3600)}</td><td>${durationText(row.actual.seconds)}</td><td>${durationText(row.actual.cumulativeSeconds)}</td><td>${signedDuration(row.actual.differenceSeconds)}</td>`
                : '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>'
            : '';
        return `<tr><td>${escapeHtml(row.startName)} → ${escapeHtml(row.endName)}</td><td>${fmt(row.distance)}</td><td>${row.elevationChange >= 0 ? '+' : ''}${Math.round(row.elevationChange)} m</td><td>${row.averageGrade.toFixed(1)}%</td>${predictedCells(row.segmentAverage)}${predictedCells(row.localGradient)}${actual}</tr>`;
    }).join('');
    const activityTotal = showActivity ? activityComparison(activity[0].routeD, activity.at(-1)!.routeD) : null, activityDistance = showActivity ? activity.at(-1)!.routeD - activity[0].routeD : 0, activityChange = showActivity ? profile[locate(activity.at(-1)!.routeD)] - profile[locate(activity[0].routeD)] : 0;
    const summaryRows = viewModel.summaries.map((summary, index) => {
        const averagePace = summary.distance > 0 && summary.segmentAverageSeconds > 0 ? `${paceText(summary.segmentAverageSeconds / (summary.distance / 1000))}/km` : '—';
        const localPace = summary.distance > 0 && summary.localGradientSeconds > 0 ? `${paceText(summary.localGradientSeconds / (summary.distance / 1000))}/km` : '—';
        const averageVam = summary.segmentAverageSeconds > 0 ? vamText(summary.elevationChange, summary.segmentAverageSeconds) : '—';
        const localVam = summary.localGradientSeconds > 0 ? vamText(summary.elevationChange, summary.localGradientSeconds) : '—';
        const predicted = canEstimate ? `<th>${averagePace}</th><th>${averageVam}</th><th></th><th>${index === 0 ? durationText(viewModel.segmentAverageTotalSeconds) : ''}</th><th>${localPace}</th><th>${localVam}</th><th></th><th>${index === 0 ? durationText(viewModel.localGradientTotalSeconds) : ''}</th>` : '<th colspan="8"></th>';
        const actual = showActivity ? index === 0 && activityTotal
            ? `<th>${activityDistance > 0 ? `${paceText(activityTotal.actual / (activityDistance / 1000))}/km` : '—'}</th><th>${vamText(activityChange, activityTotal.actual)}</th><th>${durationText(activityTotal.actual)}</th><th>${durationText(activityTotal.actual)}</th><th>${signedDuration(activityTotal.delta)}</th>`
            : '<th></th><th></th><th></th><th></th><th></th>' : '';
        return `<tr><th>${index === 0 ? 'Summary' : ''}</th><th>${fmt(summary.distance)}</th><th>${summary.elevationChange >= 0 ? '+' : ''}${Math.round(summary.elevationChange)} m</th><th>${summary.averageGrade === null ? '—' : `${summary.averageGrade.toFixed(1)}%`}</th>${predicted}${actual}</tr>`;
    }).join('');
    const actualHeader = showActivity ? '<th colspan="5">Actual (Recorded Activity)</th>' : '', actualColumns = showActivity ? '<th rowspan="2">Pace</th><th rowspan="2">VAM</th><th rowspan="2">Time</th><th rowspan="2">Cumulative</th><th rowspan="2">Difference</th>' : '';
    waypointSegmentPanel.hidden = false;
    waypointSegmentPanel.innerHTML = `<h3>Waypoint Segments</h3><p>Elevation change and Segment Average use the displayed endpoint elevations: a named waypoint’s own elevation when present, otherwise the unsmoothed route elevation. Local Gradient uses the smoothed 100 m local-gradient method from the Terrain-derived Sections analysis.</p><table><thead><tr><th rowspan="3">Segment</th><th rowspan="3">Distance</th><th rowspan="3">Elevation change</th><th rowspan="3">Average grade</th><th colspan="8">Predicted Pace Analysis — ${escapeHtml(activePaceCurve().name)}</th>${actualHeader}</tr><tr><th colspan="4">Segment Average</th><th colspan="4">Local Gradient</th>${actualColumns}</tr><tr><th>Pace</th><th>VAM</th><th>Time</th><th>Cumulative</th><th>Pace</th><th>VAM</th><th>Time</th><th>Cumulative</th></tr></thead><tbody>${rows}</tbody><tfoot>${summaryRows}</tfoot></table>`;
}
function syncSubsectionToggle() { const hasChildren = ms.some(hasTerrainChildren), hasCollapsed = ms.some((section, index) => hasTerrainChildren(section) && collapsedPrimary.has(index)); subsectionToggleButton.hidden = !hasChildren; subsectionToggleButton.textContent = hasCollapsed ? 'Expand all' : 'Collapse all'; }
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
    const viewModel = createRouteViewModel(p, ss, tot, paceEstimate?.total ?? null);
    const terrainStats = viewModel.terrain.map(item => {
        const label = `${item.kind[0].toUpperCase() + item.kind.slice(1)}${item.averageGrade === null ? '' : ` · average ${item.averageGrade >= 0 ? '+' : ''}${item.averageGrade.toFixed(1)}%`}`;
        return `<article class="stat ${item.kind}"><b>${fmt(item.distance)}</b><span>${label}</span></article>`;
    }).join('');
    const totals = `<article class="stat climb"><b>+${Math.round(viewModel.totalAscent)} m</b><span>Total ascent</span></article><article class="stat descent"><b>−${Math.round(viewModel.totalDescent)} m</b><span>Total descent</span></article>`;
    const prediction = viewModel.predictedSeconds === null ? '' : `<article class="stat rolling"><b>${durationText(viewModel.predictedSeconds)}</b><span>Predicted time · ${escapeHtml(activePaceCurve().name)}</span></article>`;
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
    const first = locate(viewStart), last = locate(viewEnd), visible = e.slice(first, last + 1), low = Math.min(...visible), high = Math.max(...visible), padding = Math.max(5, (high - low) * .08), lo = low - padding, hi = Math.max(10, high - low + padding * 2), r = chart.getBoundingClientRect(), q = devicePixelRatio || 1;
    chart.width = r.width * q;
    chart.height = r.height * q;
    const c = chart.getContext('2d')!;
    c.scale(q, q);
    const W = r.width, H = r.height, L = 50, R = 14, T = 14, B = showWaypoints.checked && routeWaypoints.some(({ index }) => index >= first && index <= last) ? 108 : 30, D = Math.max(1, viewEnd - viewStart), X = (d: number) => L + (d - viewStart) / D * (W - L - R), Y = (z: number) => T + (lo + hi - z) / hi * (H - T - B), threshold = val('#grade');
    const localGrade = (i: number) => localGradeAtDistance(p, e, p[i].d), gradientColour = (i: number) => { const grade = localGrade(i); if (grade >= threshold + 7)
        return '#a52f24'; if (grade >= threshold + 3)
        return '#d66a35'; if (grade >= threshold)
        return '#d99939'; if (grade <= -threshold - 7)
        return '#16634f'; if (grade <= -threshold - 3)
        return '#31805a'; if (grade <= -threshold)
        return '#75ad96'; return '#607183'; };
    const line = (s: S, width = 3, colour?: string) => { const a = Math.max(s.a, first), b = Math.min(s.b, last); if (a >= b)
        return; c.lineWidth = width; if (colour || plotColours.value === 'sections') {
        c.strokeStyle = colour ?? C[s.k];
        c.beginPath();
        for (let i = a; i <= b; i++)
            i === a ? c.moveTo(X(p[i].d), Y(e[i])) : c.lineTo(X(p[i].d), Y(e[i]));
        c.stroke();
        return;
    } for (let i = a; i < b; i++) {
        c.strokeStyle = gradientColour(i);
        c.beginPath();
        c.moveTo(X(p[i].d), Y(e[i]));
        c.lineTo(X(p[i + 1].d), Y(e[i + 1]));
        c.stroke();
    } };
    c.strokeStyle = '#cbd3db';
    c.beginPath();
    c.moveTo(L, T);
    c.lineTo(L, H - B);
    c.lineTo(W - R, H - B);
    c.stroke();
    c.fillStyle = '#667281';
    c.font = '12px system-ui';
    c.fillText(`${Math.round(lo + hi)} m`, 3, T + 10);
    c.fillText(`${Math.round(lo)} m`, 3, H - B);
    c.fillText(`${(viewStart / 1000).toFixed(2)} km`, L, H - 8);
    c.fillText(`${(viewEnd / 1000).toFixed(2)} km`, W - R - 50, H - 8);
    c.save();
    c.beginPath();
    c.rect(L, T, W - L - R, H - T - B);
    c.clip();
    ss.forEach(s => line(s));
    if (showWaypoints.checked)
        routeWaypoints.filter(({ index }) => index >= first && index <= last).forEach(({ index }) => { const x = X(p[index].d), y = Y(e[index]); c.save(); c.setLineDash([3, 4]); c.strokeStyle = '#2563eb'; c.globalAlpha = .55; c.lineWidth = 1; c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - B); c.stroke(); c.restore(); c.fillStyle = '#2563eb'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); });
    if (viewStart !== 0 || viewEnd !== total) {
        c.fillStyle = '#f8fafc';
        c.strokeStyle = '#34465d';
        c.lineWidth = 1.5;
        [...new Set(ms.flatMap(m => m.c.flatMap(s => [s.a, s.b])))].filter(i => i >= first && i <= last).forEach(i => { c.beginPath(); c.arc(X(p[i].d), Y(e[i]), 3.5, 0, Math.PI * 2); c.fill(); c.stroke(); });
    }
    if (hovered !== null && viewStart === 0 && viewEnd === total) {
        const m = ms[hovered];
        line({ k: 'flat', a: m.a, b: m.b }, 8, '#111827');
        m.c.forEach(s => line(s, 4));
    }
    c.restore();
    if (showWaypoints.checked) {
        c.fillStyle = '#2563eb';
        c.font = '11px system-ui';
        c.textAlign = 'center';
        const laneEnds: number[] = [];
        routeWaypoints.filter(({ index }) => index >= first && index <= last).sort((a, b) => p[a.index].d - p[b.index].d).forEach(({ waypoint, index }) => { const x = X(p[index].d), width = c.measureText(waypoint.name).width + 10; let lane = 0; while (laneEnds[lane] !== undefined && x - width / 2 < laneEnds[lane])
            lane++; laneEnds[lane] = x + width / 2; if (lane < 6)
            c.fillText(waypoint.name, x, H - B + 16 + lane * 14); });
        c.textAlign = 'start';
    }
    if (selectionStart !== null && selectionEnd !== null) {
        const x = Math.min(X(selectionStart), X(selectionEnd)), width = Math.abs(X(selectionEnd) - X(selectionStart));
        c.fillStyle = 'rgba(37,99,235,.18)';
        c.fillRect(x, T, width, H - T - B);
        c.strokeStyle = '#2563eb';
        c.lineWidth = 1;
        c.strokeRect(x, T, width, H - T - B);
    }
    if (hoverDistance !== null) {
        const m = hovered === null ? null : ms[hovered], point = locate(hoverDistance), waypoint = showWaypoints.checked ? routeWaypoints.find(entry => entry.index === point)?.waypoint.name : undefined, subsection = m?.c.findIndex(s => point >= s.a && point <= s.b), grade = localGrade(point), section = m ? `${m.k[0].toUpperCase() + m.k.slice(1)} ${hovered! + 1}${subsection === undefined || subsection < 0 ? '' : `.${subsection + 1}`} · ` : '';
        c.fillStyle = '#111827';
        c.fillText(`${waypoint ? `${waypoint} · ` : ''}${section}${grade >= 0 ? '+' : ''}${grade.toFixed(1)}% local grade`, L + 8, T + 16);
    }
}
function setHovered(index: number | null, distance: number | null = null) { const changed = hovered !== index; hovered = index; hoverDistance = distance; if (changed)
    document.querySelectorAll('[data-primary]').forEach(row => row.classList.toggle('is-highlighted', Number((row as HTMLElement).dataset.primary) === index)); draw(profile); }
function distanceAt(event: PointerEvent) { const r = chart.getBoundingClientRect(); return Math.max(viewStart, Math.min(viewEnd, viewStart + (event.clientX - r.left - 50) / (r.width - 64) * (viewEnd - viewStart))); }
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
($('#rows') as HTMLElement).addEventListener('click', event => { const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('[data-primary]'); if (!row)
    return; const m = ms[Number(row.dataset.primary)]; setView(p[m.a].d, p[m.b].d); });
function downloadAnalysisCsv() {
    const header = ['record_type', 'section_number', 'parent_section', 'section_type', 'section_label', 'start_name', 'end_name', 'start_distance_m', 'end_distance_m', 'distance_m', 'elevation_change_m', 'average_grade_percent', 'predicted_time_s', 'predicted_pace_s_per_km', 'predicted_vam_m_per_h', 'cumulative_time_s', 'segment_average_time_s', 'segment_average_pace_s_per_km', 'segment_average_vam_m_per_h', 'segment_average_cumulative_s', 'local_gradient_time_s', 'local_gradient_pace_s_per_km', 'local_gradient_vam_m_per_h', 'local_gradient_cumulative_s', 'setting', 'value'], rows: string[][] = [], add = (cells: [
        number,
        string | number | boolean | null | undefined
    ][]) => { const output = Array(header.length).fill(''); cells.forEach(([index, value]) => { if (value !== undefined && value !== null)
        output[index] = String(value); }); rows.push(output); }, curve = curvePoints(), hasCurve = curve.length >= 2, paceAt = hasCurve ? createPaceInterpolator(curve) : null;
    [['route_distance_m', p.at(-1)?.d ?? 0], ['total_ascent_m', tot.up], ['total_descent_m', tot.down], ['predicted_route_time_s', paceEstimate?.total ?? ''], ['selected_pace_curve_name', activePaceCurve().name], ['selected_pace_curve_id', activePaceCurveId], ['grade_threshold_percent', val('#grade')], ['rolling_window_m', val('#window')], ['minimum_section_m', val('#min')], ['flat_rolling_bridge_m', val('#bridge')], ['profile_smoothing_m', Number(profileSmoothing.value)], ['counter_slope_bridge_enabled', counterBridge.checked], ['counter_slope_bridge_m', Number(counterBridgeLength.value)], ['counter_slope_reversal_percent', Number(counterReversal.value)], ['recording_gap_cutoff_s', Number(activityPause.value)], ['stationary_rest_detection', activityRestDetection.checked], ['minimum_moving_speed_kmh', Number(activityMovingSpeed.value)], ['route_parse_warnings', routeWarnings.join(' ')]].forEach(([key, value]) => add([[0, 'setting'], [24, String(key)], [25, String(value)]]));
    pacePoints.forEach(point => add([[0, 'pace_curve_point'], [24, activePaceCurve().name], [25, `grade=${point.grade}; value=${point.pace}`]]));
    let cumulative = 0;
    ms.forEach((section, index) => { const a = p[section.a], b = p[section.b], distance = b.d - a.d, change = b.ele! - a.ele!, seconds = routePrediction ? routePrediction.cumulative[section.b] - routePrediction.cumulative[section.a] : paceEstimate?.sections[index]; if (seconds !== undefined)
        cumulative += seconds; add([[0, 'terrain_section'], [1, index + 1], [3, section.k], [4, section.k], [7, a.d], [8, b.d], [9, distance], [10, change], [11, distance > 0 ? change / distance * 100 : undefined], [12, seconds], [13, seconds === undefined || distance <= 0 ? undefined : seconds / (distance / 1000)], [14, seconds === undefined ? undefined : vamValue(change, seconds)], [15, seconds === undefined ? undefined : cumulative]]); section.c.forEach((child, childIndex) => { const start = p[child.a], end = p[child.b], childDistance = end.d - start.d, childChange = end.ele! - start.ele!, childSeconds = routePrediction ? routePrediction.cumulative[child.b] - routePrediction.cumulative[child.a] : undefined; add([[0, 'terrain_subsection'], [1, `${index + 1}.${childIndex + 1}`], [2, index + 1], [3, child.k], [4, child.label], [7, start.d], [8, end.d], [9, childDistance], [10, childChange], [11, childDistance > 0 ? childChange / childDistance * 100 : undefined], [12, childSeconds], [13, childSeconds === undefined || childDistance <= 0 ? undefined : childSeconds / (childDistance / 1000)], [14, childSeconds === undefined ? undefined : vamValue(childChange, childSeconds)], [15, routePrediction?.cumulative[child.b]]]); }); });
    routeWaypoints.forEach(({ waypoint, index }) => { const point = p[index]; add([[0, 'waypoint'], [5, waypoint.name], [7, point.d], [9, 0], [10, waypoint.ele ?? point.ele!]]); });
    let averageCumulative = 0, detailedCumulative = 0;
    routeWaypoints.slice(1).forEach((end, position) => { const start = routeWaypoints[position], { waypoint, index } = end, geometry = routeWaypointGeometry(start, end), distance = geometry.distance, change = geometry.elevationChange, grade = geometry.averageGrade; let averageSeconds: number | undefined, detailedSeconds: number | undefined; if (distance > 0 && hasCurve && paceEstimate && routePrediction) {
        averageSeconds = distance / 1000 * paceAt!(grade);
        detailedSeconds = routePrediction.cumulative[index] - routePrediction.cumulative[start.index];
        averageCumulative += averageSeconds;
        detailedCumulative += detailedSeconds;
    } add([[0, 'waypoint_segment'], [5, start.waypoint.name], [6, waypoint.name], [7, p[start.index].d], [8, p[index].d], [9, distance], [10, change], [11, distance > 0 ? grade : undefined], [16, averageSeconds], [17, averageSeconds === undefined || distance <= 0 ? undefined : averageSeconds / (distance / 1000)], [18, averageSeconds === undefined ? undefined : vamValue(change, averageSeconds)], [19, averageSeconds === undefined ? undefined : averageCumulative], [20, detailedSeconds], [21, detailedSeconds === undefined || distance <= 0 ? undefined : detailedSeconds / (distance / 1000)], [22, detailedSeconds === undefined ? undefined : vamValue(change, detailedSeconds)], [23, detailedSeconds === undefined ? undefined : detailedCumulative]]); });
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`, csv = [header, ...rows].map(row => row.map(escape).join(',')).join('\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a');
    link.href = url;
    link.download = 'route-analysis.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#csv').textContent = 'Download analysis CSV';
$('#csv').addEventListener('click', downloadAnalysisCsv);
type Tile = {
    z: number;
    x: number;
    y: number;
    s: {
        p: P;
        x: number;
        y: number;
    }[];
};
function tile(x: P, z: number) { const n = 2 ** z, longitude = Math.max(-180, Math.min(179.999999, x.lon)), latitude = Math.max(-85.05112878, Math.min(85.05112878, x.lat)), a = (longitude + 180) / 360 * n, b = (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * n, X = Math.max(0, Math.min(n - 1, Math.floor(a))), Y = Math.max(0, Math.min(n - 1, Math.floor(b))); return { x: X, y: Y, px: Math.max(0, Math.min(511, Math.floor((a - X) * 512))), py: Math.max(0, Math.min(511, Math.floor((b - Y) * 512))) }; }
function plan() { const z = 15, t = new Map<string, Tile>(); p.forEach(p0 => { const a = tile(p0, z), k = `${z}/${a.x}/${a.y}`; if (!t.has(k))
    t.set(k, { z, x: a.x, y: a.y, s: [] }); t.get(k)!.s.push({ p: p0, x: a.px, y: a.py }); }); return [...t.values()]; }
async function fetchTerrain(t: Tile[]) { const q = [...t]; let done = 0; async function work() { while (q.length) {
    const x = q.shift()!, r = await fetch(`https://tiles.mapterhorn.com/${x.z}/${x.x}/${x.y}.webp`);
    if (!r.ok)
        throw Error('Mapterhorn terrain tiles could not be reached.');
    const b = await createImageBitmap(await r.blob()), c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(b, 0, 0);
    b.close();
    const pixels = g.getImageData(0, 0, 512, 512).data;
    x.s.forEach(s => {
        const offset = (s.y * 512 + s.x) * 4, elevation = pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
        if (!pixels[offset + 3] || !Number.isFinite(elevation) || elevation < -1000 || elevation > 10000)
            throw Error('A Mapterhorn terrain tile returned an invalid elevation value.');
        s.p.ele = elevation;
    });
    status.textContent = `Getting full-detail Mapterhorn terrain: ${++done} of ${t.length} tiles…`;
} } await Promise.all(Array.from({ length: Math.min(4, t.length) }, work)); }
($('#fillBtn') as HTMLButtonElement).onclick = async () => { const b = $('#fillBtn') as HTMLButtonElement; b.disabled = true; try {
    const t = plan();
    status.textContent = `Getting full-detail Mapterhorn terrain from ${t.length} tiles…`;
    await fetchTerrain(t);
    fill.hidden = true;
    analyse();
}
catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Elevation lookup failed.';
}
finally {
    b.disabled = false;
} };
