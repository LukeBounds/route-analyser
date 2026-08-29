export const LARGE_TRACE_POINT_COUNT = 100_000;
export const LARGE_TRACE_FILE_BYTES = 25 * 1024 * 1024;

export function largeTraceGuidance(kind: 'route' | 'activity', pointCount: number, fileBytes: number): string | null {
    if (pointCount < LARGE_TRACE_POINT_COUNT && fileBytes < LARGE_TRACE_FILE_BYTES)
        return null;
    return `This is a large ${kind} (${pointCount.toLocaleString()} points, ${(fileBytes / 1024 / 1024).toFixed(1)} MB). Full detail is retained, so analysis and chart updates may take longer.`;
}
