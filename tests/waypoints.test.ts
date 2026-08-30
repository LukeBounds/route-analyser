import { snapNamedWaypoints, waypointSegmentGeometry } from '../src/waypoints.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
    }
}

const route = [
    { d: 0, ele: 100 },
    { d: 500, ele: 140 },
    { d: 1000, ele: 130 },
];

const explicit = waypointSegmentGeometry(
    route,
    { index: 0, elevation: 102 },
    { index: 1, elevation: 152 },
);
equal(explicit.distance, 500, 'waypoint segment distance comes from snapped route positions');
equal(explicit.elevationChange, 50, 'named waypoint elevations take precedence over route elevations');
equal(explicit.averageGrade, 10, 'segment-average grade uses the displayed waypoint endpoint elevations');

const fallback = waypointSegmentGeometry(
    route,
    { index: 1, elevation: null },
    { index: 2, elevation: null },
);
equal(fallback.elevationChange, -10, 'missing waypoint elevations fall back to unsmoothed route elevations');
equal(fallback.averageGrade, -2, 'fallback route elevations produce the segment-average grade');

const snapped = snapNamedWaypoints([
    { lat: 51, lon: 0, d: 0, ele: 100 },
    { lat: 51.001, lon: 0, d: 111, ele: 120 },
    { lat: 51.002, lon: 0, d: 222, ele: 90 },
], [
    { name: 'Start marker', lat: 51, lon: 0, ele: 101 },
    { name: 'First name', lat: 51.001, lon: 0, ele: 125 },
    { name: 'Second name', lat: 51.001001, lon: 0, ele: 126 },
    { name: 'Too far', lat: 52, lon: 0, ele: 200 },
]);
equal(snapped.points.length, 3, 'snapped waypoints include automatic route endpoints');
equal(snapped.points[0].waypoint.name, 'Start — Start marker', 'a named start waypoint is retained with the endpoint label');
equal(snapped.points[1].waypoint.name, 'First name / Second name', 'waypoints at one route position are merged');
equal(snapped.points[1].waypoint.ele, 120, 'merged waypoints use the unsmoothed route elevation');
equal(snapped.points[2].waypoint.name, 'End', 'a missing end waypoint is inserted');
equal(snapped.ignoredNames[0], 'Too far', 'distant named waypoints are reported');

console.log('Waypoint regression tests passed.');
