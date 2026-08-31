import type { RoutePacePrediction } from '../src/pace.js';
import { pacePageTemplate, routePageTemplate } from '../src/templates.js';
import { createRouteViewModel, createTerrainRows, createTerrainSummary, createWaypointSegmentRows } from '../src/viewModels.js';

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
const terrainSummary = createTerrainSummary(terrainRows);
equal(terrainSummary.byKind.climb.distance, 200, 'terrain summary counts leaf climbs without duplicating their parent');
equal(terrainSummary.byKind.climb.predictedSeconds, 150, 'terrain summary totals leaf-section prediction time');
equal(terrainSummary.byKind.climb.actualSeconds, 240, 'terrain summary totals leaf-section recorded time');
equal(terrainSummary.byKind.flat.distance, 0, 'terrain summary includes an empty flat category when none exists');
equal(terrainSummary.byKind.rolling.distance, 0, 'terrain summary includes an empty rolling category when none exists');
equal(terrainSummary.overall.distance, 200, 'overall terrain summary covers all leaf-level terrain');
equal(terrainSummary.overall.profileElevationGain, 10, 'overall terrain summary totals point-to-point profile gain');
equal(terrainSummary.overall.profileElevationLoss, 0, 'overall terrain summary totals point-to-point profile loss');

const undulatingProfileRows = createTerrainRows(points, sections, null, null, [100, 110, 105]);
const undulatingProfileSummary = createTerrainSummary(undulatingProfileRows);
equal(undulatingProfileSummary.overall.profileElevationGain, 10, 'profile gain retains internal rises within leaf sections');
equal(undulatingProfileSummary.overall.profileElevationLoss, 5, 'profile loss retains internal falls within leaf sections');

const counterSlopeSummary = createTerrainSummary([
    terrainRows[0],
    terrainRows[1],
    { ...terrainRows[2], kind: 'descent', elevationChange: -5, profileElevationGain: 0, profileElevationLoss: 5 },
]);
equal(counterSlopeSummary.byKind.climb.distance, 100, 'leaf summary excludes a primary parent when subsections exist');
equal(counterSlopeSummary.byKind.descent.distance, 100, 'leaf summary assigns a counter-slope to its subsection kind');

const counterSlopeRoute = createRouteViewModel(points, [{
    ...sections[0],
    c: [sections[0].c[0], { ...sections[0].c[1], k: 'descent' as const }],
}], { up: 10, down: 0 }, 150);
equal(counterSlopeRoute.terrain[0].distance, 100, 'top-level climb tile uses the same leaf partition as the table summary');
equal(counterSlopeRoute.terrain[1].distance, 100, 'top-level descent tile assigns counter-slopes by their leaf kind');

const route = createRouteViewModel(points, sections, { up: 10, down: 0 }, 150);
equal(route.terrain[0].distance, 200, 'route view model totals terrain distance by kind');
close(route.terrain[0].averageGrade, 5, 'route view model calculates the climb summary grade');
equal(route.terrain.map(item => item.kind).join(','), 'climb,descent,rolling,flat', 'terrain tiles use the intended display order');
equal(route.predictedSeconds, 150, 'route view model carries the selected prediction total');
equal(route.profileElevationGain, 10, 'route view model exposes profile elevation gain');
equal(route.sectionElevationGain, 10, 'route view model totals positive leaf-section net changes');
equal(route.rawElevationGain, 10, 'route view model identifies unsmoothed gain as raw elevation data');

const profileComparison = createRouteViewModel(points, sections, { up: 10, down: 0 }, 150, [100, 110, 105]);
equal(profileComparison.profileElevationGain, 10, 'profile comparison retains point-to-point rises');
equal(profileComparison.profileElevationLoss, 5, 'profile comparison retains point-to-point falls');

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
equal(waypointSegments.summaries[0].actualSeconds, 240, 'ascent summary totals recorded time from matching waypoint rows');
equal(waypointSegments.overall.distance, 200, 'overall summary includes the complete waypoint-segment distance');
equal(waypointSegments.overall.segmentAverageSeconds, 120, 'overall summary retains the complete segment-average time');
equal(waypointSegments.overall.localGradientSeconds, 150, 'overall summary retains the complete local-gradient time');

const routeTemplate = routePageTemplate();
equal(routeTemplate.includes('id="route-page"'), true, 'route template owns the route workspace');
equal(routeTemplate.includes('data-page-link="pace"'), true, 'route template exposes non-reloading workspace navigation');
const paceTemplate = pacePageTemplate([{ key: 'example', name: '<Example>', points: [] }]);
equal(paceTemplate.includes('&lt;Example&gt;'), true, 'pace template escapes built-in curve names');
equal(paceTemplate.includes('id="speed-chart"'), true, 'pace template owns both comparison canvases');

console.log('View-model regression tests passed.');
