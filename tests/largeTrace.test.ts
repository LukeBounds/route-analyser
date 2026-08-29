import { LARGE_TRACE_FILE_BYTES, LARGE_TRACE_POINT_COUNT, largeTraceGuidance } from '../src/largeTrace.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

equal(largeTraceGuidance('route', 10_000, 2_000_000), null, 'ordinary routes do not show a large-file warning');
equal(typeof largeTraceGuidance('route', LARGE_TRACE_POINT_COUNT, 1), 'string', 'large point counts show guidance');
equal(typeof largeTraceGuidance('activity', 1, LARGE_TRACE_FILE_BYTES), 'string', 'large files show guidance');

console.log('Large-trace regression tests passed.');
