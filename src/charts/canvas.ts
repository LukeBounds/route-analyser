export type NumericBounds = {
    min: number;
    max: number;
};

export type ChartTheme = {
    axis: string;
    grid: string;
    text: string;
    zero: string;
    tooltipBackground: string;
    tooltipText: string;
    markerFill: string;
    hover: string;
};

function chartTheme(canvas: HTMLCanvasElement): ChartTheme {
    const style = getComputedStyle(canvas);
    const colour = (property: string, fallback: string) => style.getPropertyValue(property).trim() || fallback;
    return {
        axis: colour('--chart-axis', '#cbd3db'),
        grid: colour('--chart-grid', 'rgba(148,163,184,.35)'),
        text: colour('--chart-text', '#667281'),
        zero: colour('--chart-zero', '#64748b'),
        tooltipBackground: colour('--chart-tooltip-background', 'rgba(17,24,39,.92)'),
        tooltipText: colour('--chart-tooltip-text', '#fff'),
        markerFill: colour('--chart-marker-fill', '#f8fafc'),
        hover: colour('--chart-hover', '#111827'),
    };
}

export function numericBounds<T>(values: Iterable<T>, valueOf: (value: T) => number): NumericBounds | null {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
        const number = valueOf(value);
        if (!Number.isFinite(number))
            continue;
        if (number < min)
            min = number;
        if (number > max)
            max = number;
    }
    return min === Infinity ? null : { min, max };
}

export function maximumValue<T>(values: Iterable<T>, valueOf: (value: T) => number, fallback = 0) {
    let maximum = fallback;
    let found = false;
    for (const value of values) {
        const number = valueOf(value);
        if (Number.isFinite(number) && (!found || number > maximum)) {
            maximum = number;
            found = true;
        }
    }
    return maximum;
}

export function prepareCanvas(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext('2d')!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height, theme: chartTheme(canvas) };
}

export function widestText(context: CanvasRenderingContext2D, labels: Iterable<string>) {
    let width = 0;
    for (const label of labels)
        width = Math.max(width, context.measureText(label).width);
    return width;
}
