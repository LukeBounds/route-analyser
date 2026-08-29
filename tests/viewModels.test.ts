import type { RoutePacePrediction } from '../src/pace.js';
import { pacePageTemplate, routePageTemplate } from '../src/templates.js';
import { createRouteViewModel, createTerrainRows, createWaypointSegmentRows } from '../src/viewModels.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function close(actual: number | null, expected: number, message: string): void {
    if (actual === null || Math.abs(actual - expected) > 1e-9)
        throw new Error(`${message}: expected ${expected}, received ${String(actual)}`);
}

const points = [
    { d: 0, ele: 100 },
    { d: 100, ele: 105 },
    { d: 200, ele: 110 },
];
const prediction: RoutePacePrediction = {
    cumulative: [0, 60, 150],
    seconds: [0, 60, 90],
};
const sections = [{
    k: 'climb' as const,
    a: 0,
    b: 2,
    c: [
        { k: 'climb' as const, a: 0, b: 1, label: 'gentle sub-climb' },
        { k: 'climb' as const, a: 1, b: 2, label: 'moderate sub-climb' },
    ],
}];
const activity = {
    compare: (from: number, to: number) => ({ expected: to - from, actual: (to - from) * 1.2, delta: (to - from) * .2 }),
    cumulativeAt: (distance: number) => distance * 1.2,
};

const terrainRows = createTerrainRows(points, sections, prediction, activity);
equal(terrainRows.length, 3, 'terrain view models contain the primary section and both children');
equal(terrainRows[1].number, '1.1', 'subsection numbering is derived before rendering');
equal(terrainRows[1].label, 'gentle sub-climb', 'subsection labels are retained in the view model');
equal(terrainRows[1].predicted?.seconds, 60, 'subsection prediction uses cumulative route prediction boundaries');
equal(terrainRows[2].predicted?.cumulativeSeconds, 150, 'subsection cumulative prediction uses its route endpoint');
equal(terrainRows[0].actual?.seconds, 240, 'primary actual metrics are calculated before rendering');
equal(terrainRows[0].actual?.differenceSeconds, 40, 'activity difference is retained in the row model');

const route = createRouteViewModel(points, sections, { up: 10, down: 0 }, 150);
equal(route.terrain[0].distance, 200, 'route view model totals terrain distance by kind');
close(route.terrain[0].averageGrade, 5, 'route view model calculates the climb summary grade');
equal(route.predictedSeconds, 150, 'route view model carries the selected prediction total');

const waypointSegments = createWaypointSegmentRows(
    points,
    [
        { name: 'Start', index: 0, elevation: 101 },
        { name: 'Top', index: 2, elevation: 111 },
    ],
    () => 600,
    prediction,
    activity,
);
equal(waypointSegments.rows.length, 1, 'waypoint rows are created from adjacent named points');
equal(waypointSegments.rows[0].elevationChange, 10, 'waypoint row uses explicit endpoint elevations');
equal(waypointSegments.rows[0].segmentAverage?.seconds, 120, 'segment-average prediction is calculated in the view model');
equal(waypointSegments.rows[0].localGradient?.seconds, 150, 'local-gradient prediction uses the shared cumulative route prediction');
equal(waypointSegments.summaries[0].distance, 200, 'ascent summary distance is derived from waypoint rows');

const routeTemplate = routePageTemplate();
equal(routeTemplate.includes('id="route-page"'), true, 'route template owns the route workspace');
equal(routeTemplate.includes('data-page-link="pace"'), true, 'route template exposes non-reloading workspace navigation');
const paceTemplate = pacePageTemplate([{ key: 'example', name: '<Example>', points: [] }]);
equal(paceTemplate.includes('&lt;Example&gt;'), true, 'pace template escapes built-in curve names');
equal(paceTemplate.includes('id="speed-chart"'), true, 'pace template owns both comparison canvases');

console.log('View-model regression tests passed.');
