import {
    drawCurveComparisonChart,
    hoveredComparisonGrade,
    type CurveComparisonSeries,
} from './charts/curveComparisonChart.js';
import { escapeHtml, formatDuration, formatPace, type PaceCurvePoint, type StoredPaceCurve } from './core.js';
import { resolvePaceCurve } from './pace.js';
import {
    generatePaceCurveForRoute,
    type GeneratedPaceCurve,
    type PaceGenerationRoute,
} from './paceGenerator.js';

export interface GeneratedCurveSaveResult {
    ok: boolean;
    name?: string;
    error?: string;
}

export interface PaceGeneratorController {
    setRoute(route: PaceGenerationRoute | null): void;
    syncCurves(): void;
    resetCurves(): void;
    clearPreviewForSource(curveId: string): void;
    redraw(): void;
}

export function createPaceGeneratorController(options: {
    panel: HTMLElement;
    getCurves: () => StoredPaceCurve[];
    getSelectedCurveId: () => string;
    curveColor: (curveId: string) => string;
    initialRoundToNiceValues: boolean;
    saveRoundingPreference: (enabled: boolean) => boolean;
    saveGeneratedCurve: (name: string, points: PaceCurvePoint[]) => GeneratedCurveSaveResult;
}): PaceGeneratorController {
    const {
        panel, getCurves, getSelectedCurveId, curveColor, initialRoundToNiceValues,
        saveRoundingPreference, saveGeneratedCurve,
    } = options;
    const routeSummary = panel.querySelector<HTMLElement>('#pace-generator-route')!;
    const controls = panel.querySelector<HTMLFieldSetElement>('#pace-generator-controls')!;
    const sourceSelect = panel.querySelector<HTMLSelectElement>('#pace-generator-source')!;
    const modeSelect = panel.querySelector<HTMLSelectElement>('#pace-generator-mode')!;
    const targetHours = panel.querySelector<HTMLInputElement>('#pace-generator-target-hours')!;
    const targetMinutes = panel.querySelector<HTMLInputElement>('#pace-generator-target-minutes')!;
    const stoppedGroup = panel.querySelector<HTMLFieldSetElement>('#pace-generator-stopped')!;
    const stopHours = panel.querySelector<HTMLInputElement>('#pace-generator-stop-hours')!;
    const stopMinutes = panel.querySelector<HTMLInputElement>('#pace-generator-stop-minutes')!;
    const preserveFlat = panel.querySelector<HTMLInputElement>('#pace-generator-preserve-flat')!;
    const niceValues = panel.querySelector<HTMLInputElement>('#nice-curve-values')!;
    const previewButton = panel.querySelector<HTMLButtonElement>('#preview-generated-curve')!;
    const status = panel.querySelector<HTMLElement>('#pace-generator-status')!;
    const previewPanel = panel.querySelector<HTMLElement>('#pace-generator-preview')!;
    const previewStats = panel.querySelector<HTMLElement>('#pace-generator-preview-stats')!;
    const explanation = panel.querySelector<HTMLElement>('#pace-generator-explanation')!;
    const warning = panel.querySelector<HTMLElement>('#pace-generator-warning')!;
    const comparisonList = panel.querySelector<HTMLElement>('#pace-generator-comparison-list')!;
    const showVam = panel.querySelector<HTMLInputElement>('#pace-generator-show-vam')!;
    const chartLegend = panel.querySelector<HTMLElement>('#pace-generator-chart-legend')!;
    const chart = panel.querySelector<HTMLCanvasElement>('#pace-generator-chart')!;
    const generatedName = panel.querySelector<HTMLInputElement>('#pace-generator-name')!;
    const saveButton = panel.querySelector<HTMLButtonElement>('#save-generated-curve')!;

    let route: PaceGenerationRoute | null = null;
    let preview: (GeneratedPaceCurve & {
        sourceId: string;
        targetElapsedSeconds: number;
        stoppedSeconds: number;
        preserveZeroGradePace: boolean;
        roundToNiceValues: boolean;
    }) | null = null;
    let hoveredGrade: number | null = null;
    const comparisonIds = new Set<string>();
    niceValues.checked = initialRoundToNiceValues;

    const previewName = () => generatedName.value.trim() || 'Generated curve preview';
    const chartSeries = (): CurveComparisonSeries[] => preview ? [
        ...getCurves()
            .filter(curve => curve.id === preview!.sourceId || comparisonIds.has(curve.id))
            .map(curve => ({
                id: curve.id,
                name: curve.name,
                color: curveColor(curve.id),
                points: resolvePaceCurve(curve.points),
            })),
        {
            id: 'generated-curve-preview',
            name: previewName(),
            color: '#ec4899',
            points: resolvePaceCurve(preview.points),
        },
    ] : [];

    function readDuration(hoursInput: HTMLInputElement, minutesInput: HTMLInputElement) {
        const hours = Number(hoursInput.value);
        const minutes = Number(minutesInput.value);
        return Number.isInteger(hours) && hours >= 0 && hours <= 999
            && Number.isInteger(minutes) && minutes >= 0 && minutes <= 59
            ? hours * 3600 + minutes * 60
            : null;
    }

    function compactDuration(seconds: number) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round(seconds % 3600 / 60);
        return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ') || '0m';
    }

    function clearPreview(redrawChart = true) {
        const hadPreview = preview !== null;
        preview = null;
        hoveredGrade = null;
        previewPanel.hidden = true;
        warning.hidden = true;
        warning.textContent = '';
        if (hadPreview && redrawChart)
            redraw();
    }

    function syncMode() {
        stoppedGroup.hidden = modeSelect.value !== 'elapsed';
    }

    function syncRoute() {
        controls.disabled = route === null;
        routeSummary.textContent = route
            ? `${route.name} · ${(route.points.at(-1)!.d / 1000).toFixed(2)} km · ${route.localGradientWindow} m local-gradient window`
            : 'Upload and analyse a route on the Terrain analyser page to begin.';
    }

    function renderComparisonControls() {
        if (!preview)
            return;
        comparisonList.innerHTML = getCurves().map(curve => {
            const isSource = curve.id === preview!.sourceId;
            const checked = isSource || comparisonIds.has(curve.id);
            return `<label><input type="checkbox" data-generator-compare="${escapeHtml(curve.id)}" ${checked ? 'checked' : ''} ${isSource ? 'disabled' : ''}><span class="curve-swatch" style="--curve-color:${curveColor(curve.id)}"></span>${escapeHtml(curve.name)}${isSource ? ' · starting curve' : ''}</label>`;
        }).join('');
        chartLegend.innerHTML = chartSeries()
            .map(curve => `<span><i style="--curve-color:${curve.color}"></i>${escapeHtml(curve.name)}${curve.id === 'generated-curve-preview' ? ' · preview' : ''}</span>`)
            .join('') + (showVam.checked ? '<span>Dashed: VAM</span>' : '');
    }

    function drawComparison() {
        if (!preview)
            return;
        drawCurveComparisonChart({
            canvas: chart,
            curves: chartSeries(),
            metric: 'pace',
            activeCurveId: 'generated-curve-preview',
            showVam: showVam.checked,
            showVamGuides: false,
            hoveredGrade,
            formatPace,
        });
    }

    function redraw() {
        if (!preview)
            return;
        renderComparisonControls();
        drawComparison();
    }

    function renderPreview() {
        if (!preview)
            return;
        const adjustment = Math.abs(preview.scaleFactor - 1) * 100;
        const direction = preview.scaleFactor >= 1 ? 'slower' : 'faster';
        const adjustmentLabel = preview.preserveZeroGradePace
            ? 'Adjustment at gradients of 5% or more; the change tapers to zero at 0%.'
            : 'Adjustment applied across the curve.';
        previewStats.innerHTML = `<article><b>${formatDuration(preview.sourcePredictionSeconds)}</b><span>Starting prediction</span></article><article><b>${formatDuration(preview.targetMovingSeconds)}</b><span>Target moving time</span></article><article><b>${formatDuration(preview.generatedPredictionSeconds)}</b><span>Generated prediction</span></article><article><b>${adjustment.toFixed(1)}% ${direction}</b><span>${preview.preserveZeroGradePace ? 'Non-flat pace adjustment' : 'Pace adjustment'}</span></article>`;
        const targetExplanation = modeSelect.value === 'elapsed'
            ? `${formatDuration(preview.targetElapsedSeconds)} elapsed minus ${formatDuration(preview.stoppedSeconds)} stopped gives a ${formatDuration(preview.targetMovingSeconds)} moving-time target. The starting curve supplies the gradient shape, including grades this route does not exercise.`
            : `${formatDuration(preview.targetMovingSeconds)} is treated as moving time. The starting curve supplies the gradient shape, including grades this route does not exercise.`;
        const roundingExplanation = preview.roundToNiceValues
            ? `Generated pace values are rounded to 5 seconds and VAM values to 5 m/h${preview.preserveZeroGradePace ? ', except for the preserved 0% point' : ''}.`
            : '';
        explanation.textContent = `${targetExplanation} ${adjustmentLabel} ${roundingExplanation}`.trim();
        const largeAdjustment = preview.scaleFactor < .67 || preview.scaleFactor > 1.5;
        const targetDifference = Math.abs(preview.generatedPredictionSeconds - preview.targetMovingSeconds);
        const warnings = [
            largeAdjustment ? 'This target requires a large change from the starting curve; check that it remains realistic for you.' : '',
            targetDifference >= 60 ? `The stored pace and VAM precision produces a prediction ${formatDuration(targetDifference)} away from the exact target.` : '',
        ].filter(Boolean);
        warning.hidden = !warnings.length;
        warning.textContent = warnings.join(' ');
        previewPanel.hidden = false;
        redraw();
    }

    function syncCurves() {
        const curves = getCurves();
        if (preview && !curves.some(curve => curve.id === preview!.sourceId))
            clearPreview(false);
        const previous = sourceSelect.value;
        sourceSelect.innerHTML = curves.map(curve => `<option value="${escapeHtml(curve.id)}">${escapeHtml(curve.name)}</option>`).join('');
        sourceSelect.value = curves.some(curve => curve.id === previous) ? previous : getSelectedCurveId();
        comparisonIds.forEach(id => {
            if (!curves.some(curve => curve.id === id))
                comparisonIds.delete(id);
        });
        redraw();
    }

    modeSelect.onchange = () => {
        syncMode();
        clearPreview();
        status.textContent = '';
    };
    sourceSelect.onchange = () => {
        clearPreview();
        status.textContent = '';
    };
    [targetHours, targetMinutes, stopHours, stopMinutes].forEach(input => input.oninput = () => {
        clearPreview();
        status.textContent = '';
    });
    preserveFlat.onchange = () => {
        clearPreview();
        status.textContent = '';
    };
    niceValues.onchange = () => {
        if (!saveRoundingPreference(niceValues.checked)) {
            niceValues.checked = !niceValues.checked;
            status.textContent = 'The rounding preference could not be saved in this browser.';
            return;
        }
        clearPreview();
        status.textContent = niceValues.checked
            ? 'Generated curves will use 5-second pace and 5 m/h VAM increments.'
            : 'Generated curves will retain their calculated precision.';
    };
    previewButton.onclick = () => {
        clearPreview(false);
        status.textContent = '';
        try {
            if (!route)
                throw Error('Upload and analyse a route on the Terrain analyser page first.');
            const targetElapsedSeconds = readDuration(targetHours, targetMinutes);
            const stoppedSeconds = modeSelect.value === 'elapsed' ? readDuration(stopHours, stopMinutes) : 0;
            if (targetElapsedSeconds === null || targetElapsedSeconds <= 0)
                throw Error('Enter a valid target time greater than zero and no more than 999 hours.');
            if (stoppedSeconds === null)
                throw Error('Enter a valid expected stopped time of no more than 999 hours.');
            const targetMovingSeconds = targetElapsedSeconds - stoppedSeconds;
            if (targetMovingSeconds <= 0)
                throw Error('Expected stopped time must be shorter than the elapsed-time target.');
            const source = getCurves().find(curve => curve.id === sourceSelect.value);
            if (!source)
                throw Error('Choose a starting curve.');
            const generated = generatePaceCurveForRoute(route, source.points, targetMovingSeconds, {
                preserveZeroGradePace: preserveFlat.checked,
                roundToNiceValues: niceValues.checked,
            });
            preview = {
                ...generated,
                sourceId: source.id,
                targetElapsedSeconds,
                stoppedSeconds,
                preserveZeroGradePace: preserveFlat.checked,
                roundToNiceValues: niceValues.checked,
            };
            comparisonIds.add(source.id);
            generatedName.value = `${source.name} — ${compactDuration(targetElapsedSeconds)} ${modeSelect.value} target`.slice(0, 80);
            renderPreview();
            status.textContent = 'Preview ready. Compare it below before saving.';
        }
        catch (problem) {
            status.textContent = problem instanceof Error ? problem.message : 'Could not generate this curve.';
            redraw();
        }
    };
    generatedName.oninput = redraw;
    saveButton.onclick = () => {
        if (!preview)
            return;
        const requestedName = generatedName.value.trim();
        if (!requestedName) {
            status.textContent = 'Enter a name for the generated curve.';
            generatedName.focus();
            return;
        }
        const saved = saveGeneratedCurve(requestedName, preview.points);
        if (!saved.ok) {
            status.textContent = saved.error || 'The generated curve could not be saved.';
            return;
        }
        preview = null;
        previewPanel.hidden = true;
        syncCurves();
        status.textContent = `${saved.name || requestedName} is now selected and available for route analysis.`;
    };
    comparisonList.addEventListener('change', event => {
        const input = event.target as HTMLInputElement;
        const id = input.dataset.generatorCompare;
        if (!id || input.disabled)
            return;
        input.checked ? comparisonIds.add(id) : comparisonIds.delete(id);
        redraw();
    });
    showVam.onchange = redraw;
    chart.addEventListener('pointermove', event => {
        const grade = hoveredComparisonGrade(chart, chartSeries(), event.clientX);
        if (grade === hoveredGrade)
            return;
        hoveredGrade = grade;
        drawComparison();
    });
    chart.addEventListener('pointerleave', () => {
        if (hoveredGrade === null)
            return;
        hoveredGrade = null;
        drawComparison();
    });

    syncMode();
    syncRoute();
    syncCurves();

    return {
        setRoute(nextRoute) {
            route = nextRoute ? {
                ...nextRoute,
                points: nextRoute.points.map(point => ({ ...point })),
                profile: [...nextRoute.profile],
            } : null;
            clearPreview(false);
            status.textContent = '';
            syncRoute();
        },
        syncCurves,
        resetCurves() {
            comparisonIds.clear();
            clearPreview(false);
            syncCurves();
        },
        clearPreviewForSource(curveId) {
            if (preview?.sourceId === curveId)
                clearPreview(false);
        },
        redraw,
    };
}
