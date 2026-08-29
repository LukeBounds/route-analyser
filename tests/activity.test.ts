import {
    calculateActivityMovingTime,
    compareActivityTimes,
    createActivityGradientSamples,
    interpolateActivityMovingTime,
    interpolateRouteCumulativeTime,
    type ActivityPoint,
} from '../src/activity.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function close(actual: number | null, expected: number, message: string): void {
    if (actual === null || Math.abs(actual - expected) > 0.001)
        throw new Error(`${message}: expected ${expected}, received ${String(actual)}`);
}

function activityPoint(options: Partial<ActivityPoint> & Pick<ActivityPoint, 'time'>): ActivityPoint {
    const { time, ...overrides } = options;
    return {
        lat: 51,
        lon: 0,
        ele: 100,
        time,
        d: 0,
        moving: 0,
        routeD: 0,
        segment: 0,
        breakBefore: false,
        ...overrides,
    };
}

const withPause = calculateActivityMovingTime([
    activityPoint({ time: 0, lat: 51 }),
    activityPoint({ time: 10_000, lat: 51.0001 }),
    activityPoint({ time: 200_000, lat: 51.0002 }),
], {
    gapCutoffSeconds: 120,
    detectStationaryRests: false,
    minimumMovingSpeedKmh: .5,
});
equal(withPause.at(-1)?.moving, 10, 'recording gaps longer than the cutoff do not add moving time');

const stationary = [
    activityPoint({ time: 0 }),
    activityPoint({ time: 10_000 }),
    activityPoint({ time: 20_000 }),
];
equal(calculateActivityMovingTime(stationary, {
    gapCutoffSeconds: 120,
    detectStationaryRests: false,
    minimumMovingSpeedKmh: .5,
}).at(-1)?.moving, 20, 'stationary time remains when rest detection is disabled');
equal(calculateActivityMovingTime(stationary, {
    gapCutoffSeconds: 120,
    detectStationaryRests: true,
    minimumMovingSpeedKmh: .5,
}).at(-1)?.moving, 0, 'stationary time is removed when rest detection is enabled');

const route = [{ d: 0 }, { d: 100 }, { d: 300 }];
const cumulative = [0, 60, 180];
close(interpolateRouteCumulativeTime(route, cumulative, 200), 120, 'predicted route time interpolates by route distance');
equal(interpolateRouteCumulativeTime(route, cumulative, 301), null, 'predicted interpolation rejects distances beyond the route');

const timedActivity = [
    activityPoint({ time: 0, routeD: 0, moving: 0 }),
    activityPoint({ time: 60_000, routeD: 100, moving: 60 }),
    activityPoint({ time: 180_000, routeD: 300, moving: 180 }),
];
close(interpolateActivityMovingTime(timedActivity, 200), 120, 'actual moving time interpolates by matched route distance');
const comparison = compareActivityTimes(
    0,
    200,
    distance => interpolateRouteCumulativeTime(route, cumulative, distance),
    distance => interpolateActivityMovingTime(timedActivity, distance),
);
equal(comparison?.delta, 0, 'activity comparison uses equivalent predicted and actual intervals');

const gradientSamples = createActivityGradientSamples([
    activityPoint({ time: 0, routeD: 0, moving: 0 }),
    activityPoint({ time: 60_000, routeD: 100, moving: 60 }),
    activityPoint({ time: 150_000, routeD: 200, moving: 150 }),
], distance => distance / 100);
equal(gradientSamples.length, 2, 'activity gradient samples cover consecutive 100 m windows');
equal(gradientSamples[0].grade, .5, 'activity sample grade is measured at the distance midpoint');
equal(gradientSamples[1].pace, 900, 'activity sample pace uses its own moving time and distance');

console.log('Activity regression tests passed.');
