import {
    createPaceInterpolator,
    isSemanticallyValidPacePoint,
    pacePointSeconds,
    parsePaceSeconds,
    parseValidatedPaceCurveBackup,
    predictRoutePace,
    resolvePaceCurve,
} from '../src/pace.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
    }
}

function close(actual: number, expected: number, message: string): void {
    if (Math.abs(actual - expected) > 1e-9) {
        throw new Error(`${message}: expected ${expected}, received ${actual}`);
    }
}

equal(parsePaceSeconds('6:30'), 390, 'pace text is converted to seconds per kilometre');
equal(parsePaceSeconds('6:60'), null, 'invalid pace seconds are rejected');
equal(parsePaceSeconds('0:00'), null, 'zero pace is rejected');
equal(pacePointSeconds({ grade: 10, pace: 'vam:600' }), 600, 'uphill VAM is converted to equivalent pace');
equal(pacePointSeconds({ grade: -10, pace: 'vam:600' }), 600, 'downhill VAM uses the absolute vertical rate');
equal(pacePointSeconds({ grade: 0, pace: 'vam:600' }), null, 'VAM is invalid at zero grade');
equal(isSemanticallyValidPacePoint({ grade: 0, pace: '' }), true, 'an empty editable pace point remains a valid draft');
equal(isSemanticallyValidPacePoint({ grade: 0, pace: 'broken' }), false, 'malformed completed pace input is rejected');
equal(isSemanticallyValidPacePoint({ grade: 101, pace: '6:30' }), false, 'impractical gradient values are rejected semantically');

const resolved = resolvePaceCurve([
    { grade: 10, pace: '10:00' },
    { grade: -10, pace: '5:00' },
    { grade: 0, pace: 'broken' },
]);
equal(resolved.length, 2, 'invalid draft points are omitted from a resolved curve');
equal(resolved[0].grade, -10, 'resolved curve points are sorted by grade');
const paceAt = createPaceInterpolator(resolved);
equal(paceAt(-20), 300, 'pace interpolation clamps below the curve');
equal(paceAt(20), 600, 'pace interpolation clamps above the curve');
equal(paceAt(0), 450, 'pace interpolation is linear between curve points');

const predictionPoints = Array.from({ length: 21 }, (_, index) => ({ d: index * 50, ele: index * 5 }));
const prediction = predictRoutePace(
    predictionPoints,
    predictionPoints.map(point => point.ele),
    resolvePaceCurve([{ grade: 0, pace: '5:00' }, { grade: 10, pace: '10:00' }]),
);
close(prediction.cumulative.at(-1)!, 600, 'route prediction applies the interpolated pace to every route interval');
equal(prediction.seconds.length, predictionPoints.length, 'route prediction retains one interval value per route point');

const validBackup = parseValidatedPaceCurveBackup({
    format: 'route-analyser-pace-curves',
    version: 1,
    curves: [{ id: 'valid', name: 'Valid', points: [{ grade: 0, pace: '6:30' }, { grade: 10, pace: 'vam:600' }] }],
});
equal(validBackup?.curves[0].name, 'Valid', 'semantically valid pace backups are accepted');
equal(parseValidatedPaceCurveBackup({
    format: 'route-analyser-pace-curves',
    version: 1,
    curves: [{ id: 'bad', name: 'Bad', points: [{ grade: 0, pace: 'not a pace' }] }],
}), null, 'semantically malformed pace backups are rejected');

console.log('Pace regression tests passed.');
