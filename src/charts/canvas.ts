export type NumericBounds = {
    min: number;
    max: number;
};

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
    return { context, width: rect.width, height: rect.height };
}

export function widestText(context: CanvasRenderingContext2D, labels: Iterable<string>) {
    let width = 0;
    for (const label of labels)
        width = Math.max(width, context.measureText(label).width);
    return width;
}
