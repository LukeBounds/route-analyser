import type { GradientExposureAnalysis } from '../gradientExposure.js';
import { maximumValue, prepareCanvas, widestText } from './canvas.js';

export type GradientExposureMetric = 'distance' | 'time';

function shortGrade(grade: number) {
    return `${grade > 0 ? '+' : grade < 0 ? '−' : ''}${Math.abs(grade)}%`;
}

function shortBandLabel(minimum: number | null, maximum: number | null) {
    if (minimum === null)
        return `< ${shortGrade(maximum!)}`;
    if (maximum === null)
        return `${shortGrade(minimum)}+`;
    return `${shortGrade(minimum)} to ${shortGrade(maximum)}`;
}

export function hoveredGradientExposureBand(
    canvas: HTMLCanvasElement,
    bandCount: number,
    clientX: number,
) {
    if (!bandCount)
        return null;
    const rect = canvas.getBoundingClientRect();
    const left = 58;
    const right = 18;
    const relative = clientX - rect.left - left;
    const plotWidth = rect.width - left - right;
    if (relative < 0 || relative > plotWidth)
        return null;
    return Math.min(bandCount - 1, Math.floor(relative / plotWidth * bandCount));
}

export function drawGradientExposureChart(options: {
    canvas: HTMLCanvasElement;
    analysis: GradientExposureAnalysis;
    metric: GradientExposureMetric;
    hoveredBand: number | null;
    formatDuration: (seconds: number) => string;
}) {
    const { canvas, analysis, metric, hoveredBand, formatDuration } = options;
    const { context, width, height, theme } = prepareCanvas(canvas);
    const left = 58;
    const right = 18;
    const top = 20;
    const bottom = 62;
    const plotWidth = Math.max(1, width - left - right);
    const plotHeight = Math.max(1, height - top - bottom);
    const values = analysis.bands.map(band => metric === 'distance'
        ? band.distance / 1000
        : (band.predictedSeconds ?? 0) / 60);
    const maximum = Math.max(1, maximumValue(values, value => value));
    const Y = (value: number) => top + (1 - value / maximum) * plotHeight;
    context.clearRect(0, 0, width, height);
    context.font = '11px system-ui';
    context.textAlign = 'right';
    for (let index = 0; index <= 4; index++) {
        const value = maximum * index / 4;
        const y = Y(value);
        context.strokeStyle = theme.grid;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        context.fillStyle = theme.text;
        context.fillText(metric === 'distance' ? `${value.toFixed(1)} km` : `${Math.round(value)} min`, left - 6, y + 4);
    }
    const slotWidth = plotWidth / analysis.bands.length;
    const barWidth = Math.max(3, slotWidth * .72);
    analysis.bands.forEach((band, index) => {
        const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
        const y = Y(values[index]);
        context.fillStyle = band.maximumGrade !== null && band.maximumGrade <= -1
            ? '#31805a'
            : band.minimumGrade !== null && band.minimumGrade >= 1
                ? '#c84735'
                : '#607183';
        context.globalAlpha = hoveredBand === null || hoveredBand === index ? .9 : .42;
        context.fillRect(x, y, barWidth, top + plotHeight - y);
        context.globalAlpha = 1;
        context.save();
        context.translate(left + (index + .5) * slotWidth + 2, height - bottom + 8);
        context.rotate(-Math.PI / 4);
        context.fillStyle = theme.text;
        context.textAlign = 'right';
        context.fillText(shortBandLabel(band.minimumGrade, band.maximumGrade), 0, 0);
        context.restore();
    });
    if (hoveredBand === null || !analysis.bands[hoveredBand])
        return;
    const band = analysis.bands[hoveredBand];
    const labels = [
        band.label,
        `${(band.distance / 1000).toFixed(2)} km · ${band.distanceSharePercent.toFixed(1)}% of route`,
        ...(band.predictedSeconds === null ? [] : [
            `${formatDuration(band.predictedSeconds)} · ${band.predictedTimeSharePercent!.toFixed(1)}% of predicted time`,
        ]),
    ];
    context.font = '11px system-ui';
    const boxWidth = Math.min(plotWidth, widestText(context, labels) + 18);
    const boxHeight = labels.length * 17 + 10;
    const barCentre = left + (hoveredBand + .5) * slotWidth;
    const boxX = Math.min(width - right - boxWidth, Math.max(left, barCentre + 8));
    const boxY = top + 6;
    context.fillStyle = theme.tooltipBackground;
    context.fillRect(boxX, boxY, boxWidth, boxHeight);
    labels.forEach((label, index) => {
        context.fillStyle = theme.tooltipText;
        context.textAlign = 'left';
        context.fillText(label, boxX + 9, boxY + 15 + index * 17);
    });
}
