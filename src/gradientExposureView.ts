import {
    drawGradientExposureChart,
    hoveredGradientExposureBand,
    type GradientExposureMetric,
} from './charts/gradientExposureChart.js';
import { escapeHtml, formatDuration, formatPace } from './core.js';
import type { GradientExposureAnalysis } from './gradientExposure.js';

export interface GradientExposureView {
    readonly element: HTMLElement;
    update(analysis: GradientExposureAnalysis, paceCurveName: string | null): void;
    redraw(): void;
}

export function createGradientExposureView(
    insertAfter: HTMLElement,
    formatDistance: (distance: number) => string,
): GradientExposureView {
    const element = document.createElement('section');
    element.className = 'gradient-exposure';
    element.innerHTML = `<div class="gradient-exposure-head"><div><h3>Gradient exposure</h3><p>Distance uses the same smoothed profile and local-gradient window as route pace analysis.</p></div><label>Chart shows<select id="gradient-exposure-metric"><option value="distance">Route distance</option><option value="time">Predicted time</option></select></label></div><p id="gradient-exposure-summary" class="gradient-exposure-summary"></p><div class="gradient-exposure-chart-scroll"><canvas id="gradient-exposure-chart" aria-label="Route distance by local gradient range">The gradient exposure values are available in the table below.</canvas></div><details id="gradient-exposure-breakdown"><summary>Gradient range breakdown</summary><div class="table gradient-exposure-table"><table><thead><tr><th>Gradient range</th><th>Distance</th><th>Route share</th><th>Predicted time</th><th>Time share</th></tr></thead><tbody></tbody></table></div></details><details id="curve-point-influence" class="curve-point-influence" hidden><summary>Pace-curve influence</summary><p></p><div class="table"><table><thead><tr><th>Curve point</th><th>Current pace</th><th>Prediction influence</th><th>Time added if 1% slower</th></tr></thead><tbody></tbody></table></div></details>`;
    insertAfter.insertAdjacentElement('afterend', element);

    const metricSelect = element.querySelector<HTMLSelectElement>('select')!;
    const chart = element.querySelector<HTMLCanvasElement>('canvas')!;
    const summary = element.querySelector<HTMLElement>('.gradient-exposure-summary')!;
    const influencePanel = element.querySelector<HTMLDetailsElement>('.curve-point-influence')!;
    let analysis: GradientExposureAnalysis | null = null;
    let hoveredBand: number | null = null;

    const signedGrade = (grade: number) => `${grade > 0 ? '+' : ''}${Number.isInteger(grade) ? grade : grade.toFixed(1)}%`;

    function redraw() {
        if (!analysis)
            return;
        const metric = metricSelect.value as GradientExposureMetric;
        chart.setAttribute('aria-label', metric === 'distance'
            ? 'Route distance by local gradient range'
            : 'Predicted time by local gradient range');
        drawGradientExposureChart({
            canvas: chart,
            analysis,
            metric,
            hoveredBand,
            formatDuration,
        });
    }

    function update(nextAnalysis: GradientExposureAnalysis, paceCurveName: string | null) {
        analysis = nextAnalysis;
        hoveredBand = null;
        const hasPrediction = nextAnalysis.totalPredictedSeconds !== null;
        const timeOption = metricSelect.querySelector<HTMLOptionElement>('option[value="time"]')!;
        timeOption.disabled = !hasPrediction;
        timeOption.textContent = hasPrediction
            ? 'Predicted time'
            : 'Predicted time — run pace analysis first';
        if (!hasPrediction && metricSelect.value === 'time')
            metricSelect.value = 'distance';

        const visibleBands = nextAnalysis.bands.filter(band => band.distance > 0);
        element.querySelector('tbody')!.innerHTML = visibleBands.map(band => `<tr><td>${escapeHtml(band.label)}</td><td>${formatDistance(band.distance)}</td><td>${band.distanceSharePercent.toFixed(1)}%</td><td>${band.predictedSeconds === null ? '—' : formatDuration(band.predictedSeconds)}</td><td>${band.predictedTimeSharePercent === null ? '—' : `${band.predictedTimeSharePercent.toFixed(1)}%`}</td></tr>`).join('');
        if (!visibleBands.length) {
            summary.textContent = 'No measurable route distance is available for gradient exposure.';
        }
        else {
            const distanceLeader = visibleBands.reduce((leader, band) => band.distance > leader.distance ? band : leader);
            const timeLeader = hasPrediction
                ? visibleBands.reduce((leader, band) => (band.predictedSeconds ?? 0) > (leader.predictedSeconds ?? 0) ? band : leader)
                : null;
            summary.textContent = `Most route distance is ${distanceLeader.label}: ${formatDistance(distanceLeader.distance)} (${distanceLeader.distanceSharePercent.toFixed(1)}%).${timeLeader ? ` The largest predicted-time share is ${timeLeader.label}: ${timeLeader.predictedTimeSharePercent!.toFixed(1)}%.` : ' Run pace analysis to add predicted-time and curve-point influence.'}`;
        }

        const influences = [...nextAnalysis.curvePointInfluence]
            .sort((a, b) => b.influencePercent - a.influencePercent);
        influencePanel.hidden = !hasPrediction || !influences.length;
        if (!influencePanel.hidden) {
            const leadingPoint = influences[0];
            influencePanel.querySelector('summary')!.textContent = `Pace-curve influence — ${paceCurveName ?? 'selected curve'}`;
            influencePanel.querySelector(':scope > p')!.textContent = `Influence estimates how much each editable curve point contributes to this route prediction through interpolation. ${signedGrade(leadingPoint.grade)} is most influential at ${leadingPoint.influencePercent.toFixed(1)}%.`;
            influencePanel.querySelector('tbody')!.innerHTML = influences.map(influence => `<tr><td>${signedGrade(influence.grade)}</td><td>${formatPace(influence.secondsPerKm)}/km</td><td>${influence.influencePercent.toFixed(1)}%</td><td>+${influence.addedSecondsPerOnePercentSlower.toFixed(1)} s</td></tr>`).join('');
        }
        redraw();
    }

    metricSelect.onchange = () => {
        hoveredBand = null;
        redraw();
    };
    chart.addEventListener('pointermove', event => {
        if (!analysis)
            return;
        const band = hoveredGradientExposureBand(chart, analysis.bands.length, event.clientX);
        if (band === hoveredBand)
            return;
        hoveredBand = band;
        redraw();
    });
    chart.addEventListener('pointerleave', () => {
        if (hoveredBand === null)
            return;
        hoveredBand = null;
        redraw();
    });

    return { element, update, redraw };
}
