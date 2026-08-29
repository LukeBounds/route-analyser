import { maximumValue, numericBounds } from '../src/charts/canvas.js';
import { curveGradeBounds } from '../src/charts/curveComparisonChart.js';
import { locateChartDistance, visibleElevationBounds } from '../src/charts/terrainProfileChart.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

const longValues = Array.from({ length: 200_000 }, (_, index) => index - 100_000);
const bounds = numericBounds(longValues, value => value);
equal(bounds?.min, -100_000, 'iterative bounds handle a long input without argument spreading');
equal(bounds?.max, 99_999, 'iterative bounds retain the final maximum');
equal(maximumValue([-10, -5], value => value), -5, 'maximum calculation does not clamp negative inputs to its fallback');
equal(maximumValue([], value => Number(value), 12), 12, 'maximum calculation uses its fallback only for an empty input');

const grades = curveGradeBounds([
    { grade: -7, seconds: 400 },
    { grade: 13, seconds: 700 },
]);
equal(grades.minGrade, -10, 'comparison grade bounds round down to a five-percent tick');
equal(grades.maxGrade, 15, 'comparison grade bounds round up to a five-percent tick');

const elevations = visibleElevationBounds([100, 80, 120, 90], 1, 3);
equal(elevations?.low, 80, 'terrain bounds only inspect the visible profile');
equal(elevations?.high, 120, 'terrain bounds include the final visible point');
const route = [{ d: 0 }, { d: 100 }, { d: 300 }, { d: 600 }];
equal(locateChartDistance(route, 250), 2, 'chart distance lookup returns the first route point at or beyond the distance');
equal(locateChartDistance(route, 600), 3, 'chart distance lookup handles the route endpoint');

console.log('Chart regression tests passed.');
