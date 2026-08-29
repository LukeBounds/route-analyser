import {
    accumulateSegments,
    escapeHtml,
    formatDuration,
    formatPace,
    isConfidentRouteMatch,
    joinNearbySegments,
    matchRouteSamples,
    parsePaceCurveBackup,
    persistentRuns,
    selectLongestRouteChain,
} from '../src/core.js';
import { builtInPaceCurves } from '../src/builtInPaceCurves.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
    }
}

function ok(value: unknown, message: string): void {
    if (!value) {
        throw new Error(message);
    }
}

equal(formatPace(719.6), '12:00', 'pace seconds carry into minutes');
equal(formatDuration(7_199), '2 h 0 min', 'duration minutes carry into hours');
equal(escapeHtml('<img onerror="bad">'), '&lt;img onerror=&quot;bad&quot;&gt;', 'HTML is escaped');

const paceBackup = parsePaceCurveBackup({
    format: 'route-analyser-pace-curves',
    version: 1,
    selectedCurveId: 'steady',
    curves: [{ id: 'steady', name: 'Steady', points: [{ grade: 0, pace: '6:30' }, { grade: 10, pace: 'vam:500' }] }],
});
equal(paceBackup?.curves[0].name, 'Steady', 'a valid named pace-curve backup is accepted');
equal(parsePaceCurveBackup({ format: 'route-analyser-pace-curves', version: 1, curves: [{ id: 'bad', name: '', points: [] }] }), null, 'a malformed pace-curve backup is rejected');

equal(builtInPaceCurves.length, 4, 'all supplied pace curves are built in');
equal(builtInPaceCurves.map(curve => curve.name).join('|'), '21h|24h|Optimistic|24h Slower Downhill', 'built-in pace curves retain their supplied names');
builtInPaceCurves.forEach(curve => {
    equal(curve.points.length, 25, `${curve.name} has a value at every standard grade`);
    ok(curve.points.every(point => Number.isFinite(point.grade) && typeof point.pace === 'string' && point.pace.length > 0), `${curve.name} contains valid pace values`);
});
equal(builtInPaceCurves[0].points.find(point => point.grade === 0)?.pace, '7:00', 'the 21h zero-grade pace matches the supplied curve');
equal(builtInPaceCurves[3].points.find(point => point.grade === -40)?.pace, 'vam:825', 'the slower-downhill curve matches the supplied descent VAM');

const nearby = joinNearbySegments([
    [{ lat: 51, lon: 0 }, { lat: 51.001, lon: 0 }],
    [{ lat: 51.0011, lon: 0 }, { lat: 51.002, lon: 0 }],
]);
equal(nearby.length, 1, 'nearby GPX segments are joined');

const distant = joinNearbySegments([
    [{ lat: 51, lon: 0 }, { lat: 51.001, lon: 0 }],
    [{ lat: 52, lon: 0 }, { lat: 52.001, lon: 0 }],
]);
equal(distant.length, 2, 'distant GPX segments stay separate');

const selected = selectLongestRouteChain([distant]);
equal(selected.discardedChains, 1, 'discarded route chains are reported');
ok(selected.points.length === 2, 'one continuous route chain is selected');

const longestByDistance = selectLongestRouteChain([[
    [{ lat: 51, lon: 0 }, { lat: 51.0001, lon: 0 }, { lat: 51.0002, lon: 0 }, { lat: 51.0003, lon: 0 }],
    [{ lat: 52, lon: 0 }, { lat: 52.01, lon: 0 }, { lat: 52.02, lon: 0 }],
]]);
equal(longestByDistance.points.length, 3, 'the longest GPX chain is selected by distance rather than point count');

const accumulated = accumulateSegments(distant);
equal(accumulated[2].d, accumulated[1].d, 'activity distance excludes gaps between track segments');
equal(accumulated[2].breakBefore, true, 'activity segment boundary is retained');

const runs = persistentRuns(
    ['gentle', 'gentle', 'steep', 'gentle', 'gentle'],
    [0, 100, 200, 220, 320, 420],
    100,
);
equal(runs.length, 1, 'a short grade-band blip is absorbed');
equal(runs[0].value, 'gentle', 'the persistent grade band wins');

const route = Array.from({ length: 20 }, (_, index) => ({ lat: 51 + index * 0.001, lon: 0, d: index * 111 }));
const activity = route.slice(2, 18).map(point => ({ lat: point.lat + 0.00001, lon: point.lon }));
const match = matchRouteSamples(route, activity);
equal(match.quality.orientation, 'forward', 'forward activity orientation is detected');
ok(match.quality.medianError < 5, 'route match reports a small median error');
ok(isConfidentRouteMatch(match.quality), 'a close forward match is accepted');

const reverseMatch = matchRouteSamples(route, [...activity].reverse());
equal(reverseMatch.quality.orientation, 'reverse', 'reverse activity orientation is detected');
ok(!isConfidentRouteMatch(reverseMatch.quality), 'a reverse match is not silently accepted');

const unrelated = matchRouteSamples(route, activity.map(point => ({ lat: point.lat + 2, lon: point.lon + 2 })));
ok(!isConfidentRouteMatch(unrelated.quality), 'an unrelated activity is rejected');

console.log('Core regression tests passed.');
