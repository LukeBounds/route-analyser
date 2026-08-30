import { builtInPaceCurves } from './builtInPaceCurves';
import { maximumValue } from './charts/canvas';
import {
    drawCurveComparisonChart,
    hoveredComparisonGrade,
    type CurveComparisonSeries,
} from './charts/curveComparisonChart';
import {
    escapeHtml,
    formatPace,
    type PaceCurvePoint,
    type StoredPaceCurve,
} from './core';
import {
    isSemanticallyValidPacePoint,
    pacePointInput,
    pacePointMethod,
    pacePointSeconds,
    parseValidatedPaceCurveBackup,
    resolvePaceCurve,
} from './pace';
import { PaceLibraryModel, parsePaceLibraryStorage } from './paceLibrary';
import { pacePageTemplate } from './templates';

const paceLibraryStorage = 'route-analyser.pace-curves';
const selectedPaceCurveStorage = 'route-analyser.selected-pace-curve';
const paceChartPreferencesStorage = 'route-analyser.pace-chart-preferences';
const comparisonColors = ['#2563eb', '#c84735', '#31805a', '#8b5cf6', '#d97706', '#0891b2', '#db2777', '#4f46e5', '#65a30d', '#b45309'];

const createPaceCurveId = () => typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `curve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clonePacePoints = (points: PaceCurvePoint[]) => points.map(point => ({ ...point }));
const createBuiltInPaceLibrary = (): StoredPaceCurve[] => builtInPaceCurves.map(curve => ({
    id: createPaceCurveId(),
    name: curve.name,
    points: clonePacePoints(curve.points),
}));

function loadPaceLibrary() {
    try {
        const stored = JSON.parse(localStorage.getItem(paceLibraryStorage) || 'null');
        const library = parsePaceLibraryStorage(stored);
        return library ?? { curves: createBuiltInPaceLibrary(), migrated: false };
    }
    catch {
        return { curves: createBuiltInPaceLibrary(), migrated: false };
    }
}

function loadSelectedCurveId(fallback: string | undefined) {
    try {
        return localStorage.getItem(selectedPaceCurveStorage) || fallback;
    }
    catch {
        return fallback;
    }
}

function loadChartPreferences() {
    try {
        return JSON.parse(localStorage.getItem(paceChartPreferencesStorage) || 'null');
    }
    catch {
        return null;
    }
}

interface ComparedPaceCurve {
    curve: StoredPaceCurve;
    color: string;
    points: Array<PaceCurvePoint & { seconds: number }>;
}

export interface PacePageController {
    readonly panel: HTMLElement;
    readonly activeCurve: StoredPaceCurve;
    readonly points: PaceCurvePoint[];
    readonly resolvedPoints: Array<PaceCurvePoint & { seconds: number }>;
    readonly selectedCurveId: string;
    bindAnalysisSelect(select: HTMLSelectElement, onSelectionChanged: () => void): void;
    redraw(): void;
}

export function createPacePageController(root: HTMLElement): PacePageController {
    const loadedLibrary = loadPaceLibrary();
    const paceState = new PaceLibraryModel(
        loadedLibrary.curves,
        loadSelectedCurveId(loadedLibrary.selectedCurveId),
        loadChartPreferences(),
        createPaceCurveId,
    );
    const paceCurves = paceState.curves;
    const preferences = paceState.chartPreferences;
    let pacePoints = paceState.points;
    let analysisCurveSelect: HTMLSelectElement | null = null;
    let onAnalysisSelectionChanged = () => {};
    let hoveredPaceGrade: number | null = null;
    let hoveredSpeedGrade: number | null = null;

    root.querySelector('main')!.insertAdjacentHTML('beforeend', pacePageTemplate(builtInPaceCurves));
    const panel = root.querySelector<HTMLElement>('#pace-panel')!;
    const paceRows = panel.querySelector<HTMLTableSectionElement>('tbody')!;
    const paceCanvas = panel.querySelector<HTMLCanvasElement>('canvas')!;
    const paceHeading = panel.querySelector<HTMLElement>('#pace-chart-heading')!;
    const speedCanvas = panel.querySelector<HTMLCanvasElement>('#speed-chart')!;
    const speedHeading = panel.querySelector<HTMLElement>('#speed-chart-heading')!;
    const addPace = panel.querySelector<HTMLButtonElement>('#add-pace-point')!;
    const loadBuiltInPace = panel.querySelector<HTMLButtonElement>('#load-built-in-pace')!;
    const builtInPaceSelect = panel.querySelector<HTMLSelectElement>('#built-in-pace-select')!;
    const paceCurveSelect = panel.querySelector<HTMLSelectElement>('#pace-curve-select')!;
    const paceCurveName = panel.querySelector<HTMLInputElement>('#pace-curve-name')!;
    const newPaceCurve = panel.querySelector<HTMLButtonElement>('#new-pace-curve')!;
    const duplicatePaceCurve = panel.querySelector<HTMLButtonElement>('#duplicate-pace-curve')!;
    const deletePaceCurve = panel.querySelector<HTMLButtonElement>('#delete-pace-curve')!;
    const exportPaceCurves = panel.querySelector<HTMLButtonElement>('#export-pace-curves')!;
    const importPaceCurves = panel.querySelector<HTMLInputElement>('#import-pace-curves')!;
    const paceLibraryStatus = panel.querySelector<HTMLElement>('#pace-library-status')!;
    const comparisonList = panel.querySelector<HTMLElement>('#curve-comparison-list')!;
    const chartLegend = panel.querySelector<HTMLElement>('#curve-chart-legend')!;
    const showPaceCurves = panel.querySelector<HTMLInputElement>('#show-pace-curves')!;
    const showSpeedCurves = panel.querySelector<HTMLInputElement>('#show-speed-curves')!;
    const showVamCurves = panel.querySelector<HTMLInputElement>('#show-vam-curves')!;
    const vamGuides = panel.querySelector<HTMLLabelElement>('.vam-guides')!;
    const showVamGuides = vamGuides.querySelector<HTMLInputElement>('input')!;

    showPaceCurves.checked = preferences.showPace;
    showSpeedCurves.checked = preferences.showSpeed;
    showVamCurves.checked = preferences.showVam;

    const paceValue = (point: PaceCurvePoint) => isSemanticallyValidPacePoint(point) ? pacePointSeconds(point) : null;
    const curvePoints = () => resolvePaceCurve(pacePoints);
    const paceCurveColor = (id: string) => comparisonColors[Math.max(0, paceCurves.findIndex(curve => curve.id === id)) % comparisonColors.length];
    const comparedPaceCurves = (): ComparedPaceCurve[] => paceCurves
        .filter(curve => preferences.curveIds.includes(curve.id))
        .map(curve => ({ curve, color: paceCurveColor(curve.id), points: resolvePaceCurve(curve.points) }));
    const comparisonChartSeries = (): CurveComparisonSeries[] => comparedPaceCurves().map(item => ({
        id: item.curve.id,
        name: item.curve.name,
        color: item.color,
        points: item.points,
    }));

    const savePace = () => {
        pacePoints = paceState.replaceActivePoints(pacePoints);
        try {
            localStorage.setItem(paceLibraryStorage, JSON.stringify(paceState.storageState()));
            localStorage.setItem(selectedPaceCurveStorage, paceState.selectedCurveId);
            return true;
        }
        catch {
            paceLibraryStatus.textContent = 'These changes could not be saved in browser storage. Export a backup before leaving this page.';
            return false;
        }
    };
    const saveChartPreferences = () => {
        try {
            localStorage.setItem(paceChartPreferencesStorage, JSON.stringify(preferences));
        }
        catch {
            paceLibraryStatus.textContent = 'Chart comparison preferences could not be saved in this browser.';
        }
    };

    function renderPace() {
        paceRows.innerHTML = pacePoints.map((point, index) => {
            const mode = pacePointMethod(point);
            const equivalent = paceValue(point);
            const vam = equivalent !== null && point.grade !== 0 ? Math.round(36000 * Math.abs(point.grade) / equivalent) : null;
            const equivalentText = equivalent === null ? '' : mode === 'vam'
                ? `≈ ${formatPace(equivalent)}/km`
                : vam === null ? '' : `≈ ${vam} m/h`;
            return `<tr><td><input data-grade="${index}" type="number" min="-100" max="100" step=".5" value="${point.grade}">%</td><td><select data-mode="${index}"><option value="pace" ${mode === 'pace' ? 'selected' : ''}>Pace</option><option value="vam" ${mode === 'vam' ? 'selected' : ''}>VAM</option></select></td><td><input data-pace="${index}" type="text" inputmode="numeric" placeholder="${mode === 'vam' ? '600' : '6:30'}" value="${escapeHtml(pacePointInput(point))}"> ${mode === 'vam' ? 'm/h' : ''} <small data-equivalent="${index}">${equivalentText}</small></td><td><button data-remove="${index}" type="button" aria-label="Remove pace point">×</button></td></tr>`;
        }).join('');
    }
    function updatePaceEquivalents() {
        pacePoints.forEach((point, index) => {
            const output = paceRows.querySelector<HTMLElement>(`[data-equivalent="${index}"]`);
            if (!output)
                return;
            const seconds = paceValue(point);
            const mode = pacePointMethod(point);
            const vam = seconds !== null && point.grade !== 0 ? Math.round(36000 * Math.abs(point.grade) / seconds) : null;
            output.textContent = seconds === null ? '' : mode === 'vam'
                ? `≈ ${formatPace(seconds)}/km`
                : vam === null ? '' : `≈ ${vam} m/h`;
        });
    }
    function renderComparisonControls() {
        const selected = new Set(preferences.curveIds);
        comparisonList.innerHTML = paceCurves.map(curve => `<label><input type="checkbox" data-compare-curve="${escapeHtml(curve.id)}" ${selected.has(curve.id) ? 'checked' : ''}><span class="curve-swatch" style="--curve-color:${paceCurveColor(curve.id)}"></span>${escapeHtml(curve.name)}</label>`).join('');
        const visible = comparedPaceCurves();
        chartLegend.innerHTML = visible.map(item => `<span><i style="--curve-color:${item.color}"></i>${escapeHtml(item.curve.name)}</span>`).join('') + (preferences.showVam ? '<span class="line-style"><i></i>Solid: pace/speed</span><span class="line-style dashed"><i></i>Dashed: VAM</span>' : '');
        showPaceCurves.checked = preferences.showPace;
        showSpeedCurves.checked = preferences.showSpeed;
        showVamCurves.checked = preferences.showVam;
        showVamGuides.disabled = !preferences.showVam;
    }
    function drawPaceComparison() {
        paceHeading.hidden = paceCanvas.hidden = !preferences.showPace;
        if (!preferences.showPace)
            return;
        drawCurveComparisonChart({
            canvas: paceCanvas,
            curves: comparisonChartSeries(),
            metric: 'pace',
            activeCurveId: paceState.selectedCurveId,
            showVam: preferences.showVam,
            showVamGuides: showVamGuides.checked,
            hoveredGrade: hoveredPaceGrade,
            formatPace,
        });
    }
    function drawSpeedComparison() {
        speedHeading.hidden = speedCanvas.hidden = !preferences.showSpeed;
        if (!preferences.showSpeed)
            return;
        drawCurveComparisonChart({
            canvas: speedCanvas,
            curves: comparisonChartSeries(),
            metric: 'speed',
            activeCurveId: paceState.selectedCurveId,
            showVam: preferences.showVam,
            showVamGuides: showVamGuides.checked,
            hoveredGrade: hoveredSpeedGrade,
            formatPace,
        });
    }
    function redraw() {
        drawPaceComparison();
        drawSpeedComparison();
        renderComparisonControls();
    }
    function syncCurveControls() {
        const options = paceCurves.map(curve => `<option value="${escapeHtml(curve.id)}">${escapeHtml(curve.name)}</option>`).join('');
        paceCurveSelect.innerHTML = options;
        if (analysisCurveSelect)
            analysisCurveSelect.innerHTML = options;
        paceCurveSelect.value = paceState.selectedCurveId;
        if (analysisCurveSelect)
            analysisCurveSelect.value = paceState.selectedCurveId;
        paceCurveName.value = paceState.activeCurve.name;
        deletePaceCurve.disabled = paceCurves.length <= 1;
        renderComparisonControls();
    }
    function selectPaceCurve(id: string) {
        if (id === paceState.selectedCurveId || !paceCurves.some(curve => curve.id === id))
            return;
        savePace();
        paceState.select(id);
        pacePoints = paceState.points;
        savePace();
        syncCurveControls();
        renderPace();
        redraw();
        onAnalysisSelectionChanged();
    }
    function sortPacePoints() {
        pacePoints.sort((a, b) => a.grade - b.grade);
        savePace();
        renderPace();
        redraw();
    }

    paceRows.addEventListener('input', event => {
        const input = event.target as HTMLInputElement;
        const index = Number(input.dataset.grade ?? input.dataset.pace);
        if (input.dataset.grade !== undefined)
            pacePoints[index].grade = Number(input.value);
        else if (input.dataset.pace !== undefined) {
            const mode = (paceRows.querySelector(`[data-mode="${index}"]`) as HTMLSelectElement).value;
            pacePoints[index].pace = mode === 'vam' ? `vam:${input.value}` : input.value;
        }
        savePace();
        updatePaceEquivalents();
        redraw();
    });
    paceRows.addEventListener('change', event => {
        const input = event.target as HTMLInputElement;
        const index = Number(input.dataset.mode);
        if (input.dataset.mode !== undefined) {
            const value = pacePointInput(pacePoints[index]);
            pacePoints[index].pace = input.value === 'vam' ? `vam:${value}` : value;
            savePace();
        }
        renderPace();
        redraw();
    });
    paceRows.addEventListener('change', sortPacePoints);
    paceRows.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!button || button.dataset.remove === undefined)
            return;
        pacePoints.splice(Number(button.dataset.remove), 1);
        savePace();
        renderPace();
        redraw();
    });
    addPace.onclick = () => {
        pacePoints.push({ grade: maximumValue(pacePoints, point => point.grade, 0) + 5, pace: '' });
        savePace();
        renderPace();
        redraw();
        queueMicrotask(sortPacePoints);
    };
    paceCanvas.addEventListener('pointermove', event => {
        const grade = hoveredComparisonGrade(paceCanvas, comparisonChartSeries(), event.clientX);
        if (grade === hoveredPaceGrade)
            return;
        hoveredPaceGrade = grade;
        redraw();
    });
    paceCanvas.addEventListener('pointerleave', () => {
        if (hoveredPaceGrade === null)
            return;
        hoveredPaceGrade = null;
        redraw();
    });
    speedCanvas.addEventListener('pointermove', event => {
        const grade = hoveredComparisonGrade(speedCanvas, comparisonChartSeries(), event.clientX);
        if (grade === hoveredSpeedGrade)
            return;
        hoveredSpeedGrade = grade;
        redraw();
    });
    speedCanvas.addEventListener('pointerleave', () => {
        if (hoveredSpeedGrade === null)
            return;
        hoveredSpeedGrade = null;
        redraw();
    });
    showVamGuides.addEventListener('change', redraw);
    comparisonList.addEventListener('change', event => {
        const input = event.target as HTMLInputElement;
        const id = input.dataset.compareCurve;
        if (!id)
            return;
        if (!paceState.setCurveCompared(id, input.checked)) {
            input.checked = true;
            paceLibraryStatus.textContent = 'Keep at least one curve selected for comparison.';
            return;
        }
        saveChartPreferences();
        redraw();
    });
    const updateChartSeries = () => {
        if (!paceState.setChartSeries(showPaceCurves.checked, showSpeedCurves.checked, showVamCurves.checked)) {
            showPaceCurves.checked = true;
            paceLibraryStatus.textContent = 'Keep at least one of the Pace or Speed charts enabled.';
        }
        saveChartPreferences();
        redraw();
    };
    showPaceCurves.onchange = updateChartSeries;
    showSpeedCurves.onchange = updateChartSeries;
    showVamCurves.onchange = updateChartSeries;
    paceCurveSelect.onchange = () => selectPaceCurve(paceCurveSelect.value);
    paceCurveName.oninput = () => {
        const name = paceCurveName.value.trim();
        if (!name) {
            paceLibraryStatus.textContent = 'A pace curve needs a name.';
            return;
        }
        paceState.renameActive(name, false);
        [paceCurveSelect, analysisCurveSelect].forEach(select => {
            const option = [...(select?.options ?? [])].find(item => item.value === paceState.selectedCurveId);
            if (option)
                option.textContent = name;
        });
        renderComparisonControls();
        if (savePace())
            paceLibraryStatus.textContent = 'Curve name saved.';
    };
    paceCurveName.onchange = () => {
        const requested = paceCurveName.value.trim();
        if (!requested) {
            paceCurveName.value = paceState.activeCurve.name;
            paceLibraryStatus.textContent = 'A pace curve needs a name.';
            return;
        }
        const name = paceState.renameActive(requested, true)!;
        savePace();
        syncCurveControls();
        paceLibraryStatus.textContent = `Saved as ${name}.`;
    };
    newPaceCurve.onclick = () => {
        const template = builtInPaceCurves.find(curve => curve.key === builtInPaceSelect.value) ?? builtInPaceCurves[0];
        paceState.createCurve('New pace curve', template.points);
        saveChartPreferences();
        pacePoints = paceState.points;
        savePace();
        syncCurveControls();
        renderPace();
        redraw();
        paceCurveName.focus();
        paceCurveName.select();
        paceLibraryStatus.textContent = `New curve created from the ${template.name} built-in values.`;
    };
    duplicatePaceCurve.onclick = () => {
        paceState.duplicateActive();
        saveChartPreferences();
        pacePoints = paceState.points;
        savePace();
        syncCurveControls();
        renderPace();
        redraw();
        paceCurveName.focus();
        paceCurveName.select();
        paceLibraryStatus.textContent = 'Curve duplicated.';
    };
    deletePaceCurve.onclick = () => {
        if (paceCurves.length <= 1)
            return;
        const deleting = paceState.activeCurve;
        if (!window.confirm(`Delete “${deleting.name}”?`))
            return;
        paceState.deleteActive();
        saveChartPreferences();
        pacePoints = paceState.points;
        savePace();
        syncCurveControls();
        renderPace();
        redraw();
        paceLibraryStatus.textContent = `Deleted ${deleting.name}.`;
    };
    exportPaceCurves.onclick = () => {
        savePace();
        const url = URL.createObjectURL(new Blob([JSON.stringify(paceState.backup(), null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
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
            const imported = paceState.importBackup(value);
            saveChartPreferences();
            pacePoints = paceState.points;
            savePace();
            syncCurveControls();
            renderPace();
            redraw();
            paceLibraryStatus.textContent = `Imported ${imported} ${imported === 1 ? 'curve' : 'curves'} without replacing your existing curves.`;
        }
        catch (problem) {
            paceLibraryStatus.textContent = problem instanceof Error ? problem.message : 'Could not import this pace-curve backup.';
        }
        finally {
            importPaceCurves.value = '';
        }
    };
    loadBuiltInPace.onclick = () => {
        const template = builtInPaceCurves.find(curve => curve.key === builtInPaceSelect.value) ?? builtInPaceCurves[0];
        pacePoints = clonePacePoints(template.points);
        savePace();
        renderPace();
        redraw();
        paceLibraryStatus.textContent = `Loaded the ${template.name} built-in values into ${paceState.activeCurve.name}.`;
    };

    pacePoints.sort((a, b) => a.grade - b.grade);
    savePace();
    renderPace();
    updatePaceEquivalents();
    syncCurveControls();
    redraw();

    return {
        panel,
        get activeCurve() { return paceState.activeCurve; },
        get points() { return pacePoints; },
        get resolvedPoints() { return curvePoints(); },
        get selectedCurveId() { return paceState.selectedCurveId; },
        bindAnalysisSelect(select, onSelectionChanged) {
            analysisCurveSelect = select;
            onAnalysisSelectionChanged = onSelectionChanged;
            analysisCurveSelect.onchange = () => selectPaceCurve(analysisCurveSelect!.value);
            syncCurveControls();
        },
        redraw,
    };
}
