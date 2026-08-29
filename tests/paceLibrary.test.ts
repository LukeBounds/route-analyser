import {
    createPaceLibraryState,
    paceLibraryFormat,
    parsePaceLibraryStorage,
} from '../src/paceLibrary.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
    }
}

const curves = [{
    id: 'steady',
    name: 'Steady',
    points: [{ grade: 0, pace: '6:30' }, { grade: 10, pace: 'vam:600' }],
}];
const state = createPaceLibraryState(curves, 'steady');
equal(state.format, paceLibraryFormat, 'pace library storage has a stable format marker');
equal(state.version, 1, 'pace library storage has an explicit schema version');
equal(parsePaceLibraryStorage(state)?.selectedCurveId, 'steady', 'versioned storage retains the selected curve');
equal(parsePaceLibraryStorage(state)?.migrated, false, 'current storage does not need migration');

const legacy = parsePaceLibraryStorage(curves);
equal(legacy?.curves[0].name, 'Steady', 'the previous bare-array library is migrated');
equal(legacy?.migrated, true, 'legacy array storage is identified for rewrite');
equal(parsePaceLibraryStorage({ format: paceLibraryFormat, version: 99, curves }), null, 'unknown storage versions fail closed');

console.log('Pace library regression tests passed.');
