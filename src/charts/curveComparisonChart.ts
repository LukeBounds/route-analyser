import { maximumValue, numericBounds, prepareCanvas, widestText, type ChartTheme } from './canvas.js';

export type CurveComparisonPoint = {
    grade: number;
    seconds: number;
};

export type CurveComparisonSeries = {
    id: string;
    name: string;
    color: string;
    points: CurveComparisonPoint[];
};

export type CurveComparisonMetric = 'pace' | 'speed';

export type CurveComparisonChartOptions = {
    canvas: HTMLCanvasElement;
    curves: CurveComparisonSeries[];
    metric: CurveComparisonMetric;
    activeCurveId: string;
    showVam: boolean;
    showVamGuides: boolean;
    hoveredGrade: number | null;
    formatPace: (seconds: number) => string;
};

function allPoints(curves: CurveComparisonSeries[]) {
    const points: CurveComparisonPoint[] = [];
    curves.forEach(curve => curve.points.forEach(point => points.push(point)));
    return points;
}

export function curveGradeBounds(points: Iterable<CurveComparisonPoint>) {
    const bounds = numericBounds(points, point => point.grade);
    if (!bounds)
        return { minGrade: 0, maxGrade: 0 };
    return {
        minGrade: Math.min(0, Math.floor(bounds.min / 5) * 5),
        maxGrade: Math.max(0, Math.ceil(bounds.max / 5) * 5),
    };
}

export function hoveredComparisonGrade(
    canvas: HTMLCanvasElement,
    curves: CurveComparisonSeries[],
    clientX: number,
) {
    const points = allPoints(curves);
    if (points.length < 2)
        return null;
    const rect = canvas.getBoundingClientRect();
    const { minGrade, maxGrade } = curveGradeBounds(points);
    const plotX = (grade: number) => 54 + (grade - minGrade) / Math.max(1, maxGrade - minGrade) * (rect.width - 54 - 58);
    let closest = points[0];
    let closestDistance = Math.abs(plotX(closest.grade) - (clientX - rect.left));
    for (let index = 1; index < points.length; index++) {
        const distance = Math.abs(plotX(points[index].grade) - (clientX - rect.left));
        if (distance < closestDistance) {
            closest = points[index];
            closestDistance = distance;
        }
    }
    return closestDistance < 14 ? closest.grade : null;
}

function drawGradeGrid(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    minGrade: number,
    maxGrade: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
    theme: ChartTheme,
) {
    const X = (grade: number) => left + (grade - minGrade) / Math.max(1, maxGrade - minGrade) * (width - left - right);
    const tick = Math.max(5, Math.ceil((maxGrade - minGrade) / 8 / 5) * 5);
    context.font = '12px system-ui';
    context.textAlign = 'center';
    for (let grade = Math.ceil(minGrade / tick) * tick; grade <= maxGrade; grade += tick) {
        const x = X(grade);
        context.strokeStyle = grade === 0 ? theme.zero : theme.axis;
        context.lineWidth = grade === 0 ? 1.5 : 1;
        context.setLineDash(grade === 0 ? [4, 3] : []);
        context.beginPath();
        context.moveTo(x, top);
        context.lineTo(x, height - bottom);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = theme.text;
        context.fillText(`${grade}%`, x, height - 8);
    }
    context.textAlign = 'start';
    return X;
}

function drawVamScale(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
    maxVam: number,
    showGuides: boolean,
    theme: ChartTheme,
) {
    const V = (vam: number) => top + (maxVam * 1.1 - vam) / (maxVam * 1.1) * (height - top - bottom);
    context.font = '11px system-ui';
    context.textAlign = 'left';
    for (let index = 0; index <= 4; index++) {
        const vam = maxVam * index / 4;
        const y = V(vam);
        context.fillStyle = theme.text;
        context.fillText(`${Math.round(vam)}`, width - right + 4, y + 4);
        if (showGuides && index) {
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

export function drawCurveComparisonChart(options: CurveComparisonChartOptions) {
    const { canvas, curves, metric, activeCurveId, showVam, showVamGuides, hoveredGrade, formatPace } = options;
    const points = allPoints(curves);
    const { context, width, height, theme } = prepareCanvas(canvas);
    const left = 54;
    const right = 58;
    const top = 18;
    const bottom = 34;
    context.clearRect(0, 0, width, height);
    if (points.length < 2) {
        context.fillStyle = theme.text;
        context.font = '14px system-ui';
        context.fillText('Select a curve with at least two valid points.', left + 12, height / 2);
        return;
    }

    const { minGrade, maxGrade } = curveGradeBounds(points);
    const valueOf = metric === 'pace' ? (point: CurveComparisonPoint) => point.seconds : (point: CurveComparisonPoint) => 3600 / point.seconds;
    const valueBounds = numericBounds(points, valueOf)!;
    const valueRange = Math.max(metric === 'pace' ? 30 : .5, valueBounds.max - valueBounds.min);
    const maxVam = Math.max(100, maximumValue(points, point => point.grade === 0 ? 0 : 36000 * Math.abs(point.grade) / point.seconds));
    const X = drawGradeGrid(context, width, height, minGrade, maxGrade, left, right, top, bottom, theme);
    const Y = metric === 'pace'
        ? (value: number) => top + (value - valueBounds.min + valueRange * .1) / (valueRange * 1.2) * (height - top - bottom)
        : (value: number) => top + (valueBounds.max + valueRange * .1 - value) / (valueRange * 1.2) * (height - top - bottom);
    const V = showVam ? drawVamScale(context, width, height, left, right, top, bottom, maxVam, showVamGuides, theme) : null;

    context.font = '11px system-ui';
    for (let index = 0; index <= 5; index++) {
        const value = valueBounds.min + (valueBounds.max - valueBounds.min) * index / 5;
        const y = Y(value);
        context.strokeStyle = theme.grid;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        context.fillStyle = theme.text;
        context.textAlign = 'right';
        context.fillText(metric === 'pace' ? formatPace(value) : value.toFixed(1), left - 5, y + 4);
    }

    curves.forEach(curve => {
        if (V && curve.points.length) {
            context.strokeStyle = curve.color;
            context.globalAlpha = .72;
            context.lineWidth = 1.8;
            context.setLineDash([6, 4]);
            context.beginPath();
            curve.points.forEach((point, index) => {
                const y = V(point.grade === 0 ? 0 : 36000 * Math.abs(point.grade) / point.seconds);
                index ? context.lineTo(X(point.grade), y) : context.moveTo(X(point.grade), y);
            });
            context.stroke();
            context.setLineDash([]);
            context.globalAlpha = 1;
        }
        context.strokeStyle = curve.color;
        context.lineWidth = curve.id === activeCurveId ? 3 : 2.2;
        context.beginPath();
        curve.points.forEach((point, index) => index
            ? context.lineTo(X(point.grade), Y(valueOf(point)))
            : context.moveTo(X(point.grade), Y(valueOf(point))));
        context.stroke();
        context.fillStyle = curve.color;
        curve.points.forEach(point => {
            context.beginPath();
            context.arc(X(point.grade), Y(valueOf(point)), curve.id === activeCurveId ? 4 : 3, 0, Math.PI * 2);
            context.fill();
        });
    });

    context.textAlign = 'start';
    if (hoveredGrade === null)
        return;
    const entries = curves.flatMap(curve => {
        if (!curve.points.length)
            return [];
        let point = curve.points[0];
        for (let index = 1; index < curve.points.length; index++) {
            if (Math.abs(curve.points[index].grade - hoveredGrade) < Math.abs(point.grade - hoveredGrade))
                point = curve.points[index];
        }
        return [{ curve, point }];
    });
    if (!entries.length)
        return;
    const x = X(hoveredGrade);
    context.strokeStyle = theme.zero;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, height - bottom);
    context.stroke();
    context.setLineDash([]);
    context.font = '11px system-ui';
    const labels = entries.map(({ curve, point }) => {
        const speed = 3600 / point.seconds;
        const vam = point.grade === 0 ? 0 : Math.round(36000 * Math.abs(point.grade) / point.seconds);
        return metric === 'pace'
            ? `${curve.name.slice(0, 24)} · ${point.grade}% · ${formatPace(point.seconds)}/km · ${speed.toFixed(1)} km/h · ${vam} m/h`
            : `${curve.name.slice(0, 24)} · ${point.grade}% · ${speed.toFixed(1)} km/h · ${formatPace(point.seconds)}/km · ${vam} m/h`;
    });
    const boxWidth = Math.min(width - left - right, widestText(context, labels) + 14);
    const boxHeight = labels.length * 17 + 10;
    const boxX = Math.min(width - right - boxWidth, Math.max(left, x + 8));
    const boxY = top + 6;
    context.fillStyle = theme.tooltipBackground;
    context.fillRect(boxX, boxY, boxWidth, boxHeight);
    labels.forEach((label, index) => {
        context.fillStyle = entries[index].curve.color;
        context.fillRect(boxX + 6, boxY + 8 + index * 17, 5, 5);
        context.fillStyle = theme.tooltipText;
        context.fillText(label, boxX + 16, boxY + 14 + index * 17);
    });
}
