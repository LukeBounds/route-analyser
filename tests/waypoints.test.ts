import { waypointSegmentGeometry } from '../src/waypoints.js';

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

console.log('Waypoint regression tests passed.');
