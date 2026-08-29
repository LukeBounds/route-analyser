import { numericBounds, prepareCanvas } from './canvas.js';
import type { CurveComparisonPoint } from './curveComparisonChart.js';

export type ActivityChartPoint = {
    routeD: number;
    moving: number;
};

export type RouteChartPoint = {
    d: number;
};

export type ActivityGradientSample = {
    grade: number;
    pace: number;
};

export function drawActivityComparisonChart(options: {
    canvas: HTMLCanvasElement;
    routePoints: RouteChartPoint[];
    cumulativePrediction: number[];
    activity: ActivityChartPoint[];
    predictedStart: number;
    predictedEnd: number;
    formatDuration: (seconds: number) => string;
    formatDistance: (distance: number) => string;
}) {
    const { canvas, routePoints, cumulativePrediction, activity, predictedStart, predictedEnd, formatDuration, formatDistance } = options;
    if (activity.length < 2)
        return;
    const { context, width, height, theme } = prepareCanvas(canvas);
    const left = 52;
    const right = 16;
    const top = 18;
    const bottom = 32;
    const start = activity[0].routeD;
    const end = activity.at(-1)!.routeD;
    const actualDuration = activity.at(-1)!.moving - activity[0].moving;
    const predictedDuration = predictedEnd - predictedStart;
    const maxTime = Math.max(actualDuration, predictedDuration, 1);
    const X = (distance: number) => left + (distance - start) / Math.max(1, end - start) * (width - left - right);
    const Y = (seconds: number) => top + (maxTime * 1.08 - seconds) / (maxTime * 1.08) * (height - top - bottom);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = theme.axis;
    context.beginPath();
    context.moveTo(left, top);
    context.lineTo(left, height - bottom);
    context.lineTo(width - right, height - bottom);
    context.stroke();
    context.font = '11px system-ui';
    context.fillStyle = theme.text;
    for (let index = 0; index <= 4; index++) {
        const seconds = maxTime * index / 4;
        const y = Y(seconds);
        context.strokeStyle = theme.grid;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        context.fillText(formatDuration(seconds), 3, y + 4);
    }
    context.strokeStyle = '#2563eb';
    context.lineWidth = 2.5;
    context.beginPath();
    let predictionStarted = false;
    for (let index = 0; index < routePoints.length; index++) {
        const distance = routePoints[index].d;
        if (distance < start || distance > end)
            continue;
        const x = X(distance);
        const y = Y(cumulativePrediction[index] - predictedStart);
        predictionStarted ? context.lineTo(x, y) : context.moveTo(x, y);
        predictionStarted = true;
    }
    context.stroke();
    context.strokeStyle = '#d97706';
    context.lineWidth = 2.5;
    context.beginPath();
    activity.forEach((point, index) => index
        ? context.lineTo(X(point.routeD), Y(point.moving - activity[0].moving))
        : context.moveTo(X(point.routeD), Y(0)));
    context.stroke();
    context.fillStyle = '#2563eb';
    context.fillText('Predicted moving time', left + 6, top + 12);
    context.fillStyle = '#d97706';
    context.fillText('Actual moving time', left + 132, top + 12);
    context.fillStyle = theme.text;
    context.fillText(formatDistance(start), left, height - 8);
    context.fillText(formatDistance(end), width - right - 45, height - 8);
}

export function drawActivityGradientChart(options: {
    canvas: HTMLCanvasElement;
    curve: CurveComparisonPoint[];
    actual: ActivityGradientSample[];
    formatPace: (seconds: number) => string;
}) {
    const { canvas, curve, actual, formatPace } = options;
    if (curve.length < 2)
        return;
    const { context, width, height, theme } = prepareCanvas(canvas);
    const left = 46;
    const right = 16;
    const top = 18;
    const bottom = 32;
    function* gradeValues() {
        yield* curve;
        yield* actual;
    }
    function* paceValues() {
        for (const point of curve)
            yield point.seconds;
        for (const point of actual)
            yield point.pace;
    }
    const gradeBounds = numericBounds(gradeValues(), point => point.grade)!;
    const paceBounds = numericBounds(paceValues(), pace => pace)!;
    const minGrade = Math.min(-5, gradeBounds.min);
    const maxGrade = Math.max(5, gradeBounds.max);
    const paceRange = Math.max(30, paceBounds.max - paceBounds.min);
    const X = (grade: number) => left + (grade - minGrade) / Math.max(1, maxGrade - minGrade) * (width - left - right);
    const Y = (pace: number) => top + (pace - paceBounds.min + paceRange * .1) / (paceRange * 1.2) * (height - top - bottom);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = theme.axis;
    context.beginPath();
    context.moveTo(left, top);
    context.lineTo(left, height - bottom);
    context.lineTo(width - right, height - bottom);
    context.stroke();
    context.font = '11px system-ui';
    for (let index = 0; index <= 4; index++) {
        const pace = paceBounds.min + (paceBounds.max - paceBounds.min) * index / 4;
        const y = Y(pace);
        context.strokeStyle = theme.grid;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        context.fillStyle = theme.text;
        context.fillText(formatPace(pace), 3, y + 4);
    }
    const tick = Math.max(5, Math.ceil((maxGrade - minGrade) / 8 / 5) * 5);
    context.textAlign = 'center';
    for (let grade = Math.ceil(minGrade / tick) * tick; grade <= maxGrade; grade += tick) {
        const x = X(grade);
        context.strokeStyle = grade === 0 ? theme.zero : theme.axis;
        context.setLineDash(grade === 0 ? [4, 3] : []);
        context.beginPath();
        context.moveTo(x, top);
        context.lineTo(x, height - bottom);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = theme.text;
        context.fillText(`${grade}%`, x, height - 8);
    }
    context.strokeStyle = '#2563eb';
    context.lineWidth = 2.5;
    context.beginPath();
    curve.forEach((point, index) => index
        ? context.lineTo(X(point.grade), Y(point.seconds))
        : context.moveTo(X(point.grade), Y(point.seconds)));
    context.stroke();
    context.fillStyle = 'rgba(217,119,6,.82)';
    actual.forEach(point => {
        context.beginPath();
        context.arc(X(point.grade), Y(point.pace), 3, 0, Math.PI * 2);
        context.fill();
    });
    context.textAlign = 'start';
    context.fillStyle = '#2563eb';
    context.fillText('Pace curve', left + 6, top + 12);
    context.fillStyle = '#d97706';
    context.fillText(`Actual 100 m samples (${actual.length})`, left + 76, top + 12);
}
