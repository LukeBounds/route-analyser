import { buildActivityComparisonCsv, buildRouteAnalysisCsv } from '../src/exportData.js';
import type { ActivityPoint } from '../src/activity.js';
import type { RoutePoint } from '../src/gpx.js';
import type { PrimaryTerrainSection } from '../src/terrain.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function ok(value: unknown, message: string): void {
    if (!value)
        throw new Error(message);
}

const route: RoutePoint[] = [
    { lat: 51, lon: 0, ele: 100, d: 0, segment: 0, breakBefore: false },
    { lat: 51.001, lon: 0, ele: 110, d: 100, segment: 0, breakBefore: false },
    { lat: 51.002, lon: 0, ele: 120, d: 200, segment: 0, breakBefore: false },
];
const sections: PrimaryTerrainSection[] = [{
    k: 'climb', a: 0, b: 2, c: [{ k: 'climb', a: 0, b: 2, label: 'moderate sub-climb' }],
}];
const waypoints = [
    { index: 0, waypoint: { name: 'Start', lat: 51, lon: 0, ele: 100 } },
    { index: 2, waypoint: { name: 'End', lat: 51.002, lon: 0, ele: 120 } },
];
const prediction = { cumulative: [0, 60, 120], seconds: [0, 60, 60] };

const routeCsv = buildRouteAnalysisCsv({
    route,
    profileElevations: [100, 110, 120],
    sections,
    totals: { up: 20, down: 0 },
    prediction,
    sectionPredictionSeconds: [120],
    predictedTotalSeconds: 120,
    waypoints,
    rawPacePoints: [{ grade: 0, pace: '10:00' }, { grade: 10, pace: 'vam:600' }],
    resolvedPacePoints: [
        { grade: 0, pace: '10:00', seconds: 600 },
        { grade: 10, pace: 'vam:600', seconds: 600 },
    ],
    paceCurveName: 'Test curve',
    paceCurveId: 'test',
    settings: [['grade_threshold_percent', 2]],
});
equal(routeCsv[0][0], 'record_type', 'route CSV begins with the shared header');
ok(routeCsv.some(row => row[0] === 'terrain_section'), 'route CSV contains primary terrain rows');
ok(routeCsv.some(row => row[0] === 'terrain_subsection'), 'route CSV contains terrain subsection rows');
ok(routeCsv.some(row => row[0] === 'waypoint_segment'), 'route CSV contains waypoint segment rows');
equal(routeCsv.find(row => row[24] === 'selected_pace_curve_name')?.[25], 'Test curve', 'route CSV includes selected curve metadata');
equal(routeCsv.find(row => row[24] === 'raw_elevation_gain_m')?.[25], 20, 'route CSV labels point-to-point gain as raw elevation data');
equal(routeCsv.find(row => row[24] === 'raw_elevation_loss_m')?.[25], 0, 'route CSV labels point-to-point loss as raw elevation data');
equal(routeCsv.find(row => row[24] === 'profile_total_elevation_gain_m')?.[25], 20, 'route CSV includes profile point-to-point elevation gain');
equal(routeCsv.find(row => row[0] === 'terrain_subsection')?.[26], 20, 'route CSV includes subsection profile elevation gain');

const activity: ActivityPoint[] = route.map((point, index) => ({
    ...point,
    time: index * 70_000,
    moving: index * 70,
    routeD: point.d,
}));
const activityCsv = buildActivityComparisonCsv({
    route,
    profile: [100, 110, 120],
    sections,
    waypoints,
    activity,
    prediction,
    matchQuality: {
        orientation: 'forward', medianError: 2, p90Error: 4, maxError: 5, within150m: 100,
        progress: 200, ambiguousSamples: 0, ambiguousPercent: 0,
    },
    movingSettings: { gapCutoffSeconds: 120, detectStationaryRests: false, minimumMovingSpeedKmh: .5 },
    paceCurveName: 'Test curve',
    paceCurveId: 'test',
});
equal(activityCsv[0][0], 'record_type', 'activity CSV begins with the shared header');
equal(activityCsv[1][0], 'summary', 'activity CSV begins its data with a summary');
equal(activityCsv[1][16], 20, 'activity CSV reports actual minus predicted moving time');
equal(activityCsv[1][17], 2, 'activity CSV includes route-match quality in the summary');
ok(activityCsv.some(row => row[0] === 'terrain_subsection'), 'activity CSV includes subsection comparisons');

console.log('Export-data regression tests passed.');
