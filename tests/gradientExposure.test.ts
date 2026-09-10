import { analyseGradientExposure } from '../src/gradientExposure.js';
import { resolvePaceCurve } from '../src/pace.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function close(actual: number, expected: number, tolerance: number, message: string): void {
    if (Math.abs(actual - expected) > tolerance)
        throw new Error(`${message}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

const points = [
    { d: 0, ele: 0 },
    { d: 1000, ele: 0 },
    { d: 2000, ele: 100 },
    { d: 3000, ele: 0 },
];
const distanceOnly = analyseGradientExposure(points, [0, 0, 100, 0], 50);
close(distanceOnly.totalDistance, 3000, .01, 'gradient exposure covers the complete route distance');
equal(distanceOnly.totalPredictedSeconds, null, 'distance exposure is available before pace analysis');
close(
    distanceOnly.bands.reduce((sum, band) => sum + band.distanceSharePercent, 0),
    100,
    .001,
    'gradient-band distance shares total 100 percent',
);

const withPace = analyseGradientExposure(
    points,
    [0, 0, 100, 0],
    50,
    resolvePaceCurve([
        { grade: -10, pace: '5:00' },
        { grade: 0, pace: '6:00' },
        { grade: 10, pace: '12:00' },
    ]),
);
close(withPace.totalPredictedSeconds!, 1380, 1, 'gradient exposure uses local-gradient route pace');
close(
    withPace.bands.reduce((sum, band) => sum + (band.predictedTimeSharePercent ?? 0), 0),
    100,
    .001,
    'predicted-time shares total 100 percent',
);
close(
    withPace.curvePointInfluence.reduce((sum, point) => sum + point.influencePercent, 0),
    100,
    .001,
    'curve-point influence shares total 100 percent',
);
equal(
    withPace.curvePointInfluence.reduce((most, point) => point.influencePercent > most.influencePercent ? point : most).grade,
    10,
    'the pace point governing the slow climb is most influential',
);

console.log('Gradient-exposure regression tests passed.');
