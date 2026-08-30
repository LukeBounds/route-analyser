import {
    createPaceLibraryState,
    PaceLibraryModel,
    paceLibraryFormat,
    normalisePaceChartPreferences,
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

let nextId = 1;
const model = new PaceLibraryModel(curves, 'steady', null, () => `new-${nextId++}`);
equal(model.activeCurve.name, 'Steady', 'pace model selects the stored active curve');
equal(model.chartPreferences.curveIds[0], 'steady', 'missing chart preferences default to every curve');
const created = model.createCurve('Steady', [{ grade: 0, pace: '7:00' }]);
equal(created.name, 'Steady 2', 'new curve names are made unique');
equal(model.selectedCurveId, created.id, 'a newly created curve becomes active');
const duplicate = model.duplicateActive();
equal(duplicate.name, 'Steady 2 copy', 'duplicating a curve creates an independently named copy');
duplicate.points[0].pace = '8:00';
equal(created.points[0].pace, '7:00', 'duplicated points do not share references');
equal(model.setCurveCompared('steady', false), true, 'a comparison curve can be deselected while others remain');
equal(model.setChartSeries(false, false, false), false, 'at least one pace or speed chart is retained');
equal(model.chartPreferences.showPace, true, 'pace chart is restored when both charts were disabled');
const deleted = model.deleteActive();
equal(deleted?.id, duplicate.id, 'the active curve is deleted through the model');
equal(model.selectedCurveId, created.id, 'deletion selects the adjacent curve');
const importedCount = model.importBackup({
    format: 'route-analyser-pace-curves',
    version: 1,
    selectedCurveId: 'steady',
    curves,
});
equal(importedCount, 1, 'backup import reports its imported curve count');
equal(model.activeCurve.name, 'Steady 3', 'imported names and colliding IDs are made unique');
equal(model.storageState().selectedCurveId, model.selectedCurveId, 'model produces versioned persistence state');
equal(model.backup('2026-08-30T00:00:00.000Z').exportedAt, '2026-08-30T00:00:00.000Z', 'model produces a dated portable backup');

const filteredPreferences = normalisePaceChartPreferences({
    curveIds: ['missing', 'steady', 'steady'], showPace: false, showSpeed: true, showVam: true,
}, curves);
equal(filteredPreferences.curveIds.length, 1, 'chart preferences remove missing and duplicate curve IDs');
equal(filteredPreferences.showVam, true, 'valid chart display preferences are retained');
equal(normalisePaceChartPreferences({ showPace: false, showSpeed: false }, curves).showPace, true, 'stored preferences cannot hide both primary charts');

console.log('Pace library regression tests passed.');
