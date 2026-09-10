import { generatePaceCurveForRoute, scalePaceCurve } from '../src/paceGenerator.js';
import { isSemanticallyValidPacePoint } from '../src/pace.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function close(actual: number, expected: number, tolerance: number, message: string): void {
    if (Math.abs(actual - expected) > tolerance)
        throw new Error(`${message}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

const doubled = scalePaceCurve([
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: 'vam:600' },
    { grade: 20, pace: '' },
], 2);
equal(doubled.length, 2, 'curve generation omits incomplete draft points');
equal(doubled[0].pace, '10:00', 'pace inputs scale in seconds per kilometre');
equal(doubled[1].pace, 'vam:300', 'VAM inputs scale inversely to pace');

const anchored = scalePaceCurve([
    { grade: -10, pace: '6:00' },
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: 'vam:600' },
], 2, { preserveZeroGradePace: true });
equal(anchored[0].pace, '12:00', 'anchored scaling still adjusts downhill pace');
equal(anchored[1].pace, '5:00', 'anchored scaling preserves the zero-grade pace');
equal(anchored[2].pace, 'vam:300', 'anchored scaling adjusts uphill VAM');
const nicelyRoundedAnchored = scalePaceCurve([
    { grade: 0, pace: '5:02' },
    { grade: 10, pace: 'vam:603' },
], 1.1, { preserveZeroGradePace: true, roundToNiceValues: true });
equal(nicelyRoundedAnchored[0].pace, '5:02', 'zero-grade preservation takes priority over nice-number rounding');
equal(nicelyRoundedAnchored[1].pace, 'vam:550', 'generated VAM values use five-metre increments');

const generated = generatePaceCurveForRoute({
    name: 'Test climb',
    points: [{ d: 0, ele: 0 }, { d: 1000, ele: 100 }],
    profile: [0, 100],
    localGradientWindow: 50,
}, [
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: '10:00' },
], 1200);
equal(generated.scaleFactor, 2, 'target generation derives the scale from the source prediction');
equal(generated.points[1].pace, '20:00', 'target generation produces a persistable pace curve');
close(generated.generatedPredictionSeconds, 1200, 1, 'the persisted generated curve reproduces the target route time');

const anchoredGenerated = generatePaceCurveForRoute({
    name: 'Flat then climb',
    points: [{ d: 0, ele: 0 }, { d: 1000, ele: 0 }, { d: 2000, ele: 100 }],
    profile: [0, 0, 100],
    localGradientWindow: 50,
}, [
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: '10:00' },
], 1200, { preserveZeroGradePace: true });
equal(anchoredGenerated.points[0].pace, '5:00', 'route generation can anchor the zero-grade point');
close(anchoredGenerated.generatedPredictionSeconds, 1200, 1, 'anchored generation solves for the route target');

const verySlowAnchored = generatePaceCurveForRoute({
    name: 'Flat then climb',
    points: [{ d: 0, ele: 0 }, { d: 1000, ele: 0 }, { d: 2000, ele: 100 }],
    profile: [0, 0, 100],
    localGradientWindow: 50,
}, [
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: '10:00' },
], 999 * 3600, { preserveZeroGradePace: true });
close(verySlowAnchored.generatedPredictionSeconds, 999 * 3600, 1, 'anchored generation has no arbitrary slow-target scale ceiling');

const roundedBracket = generatePaceCurveForRoute({
    name: 'Long climb',
    points: [{ d: 0, ele: 0 }, { d: 10000, ele: 1000 }],
    profile: [0, 1000],
    localGradientWindow: 50,
}, [
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: 'vam:600' },
], 80000, { preserveZeroGradePace: true, roundToNiceValues: true });
close(roundedBracket.generatedPredictionSeconds, 80000, 1, 'rounded generation chooses the nearest side of a binary-search step');

let unreachableAnchoredTarget = '';
try {
    generatePaceCurveForRoute({
        name: 'Flat route',
        points: [{ d: 0, ele: 0 }, { d: 1000, ele: 0 }],
        profile: [0, 0],
        localGradientWindow: 50,
    }, [
        { grade: 0, pace: '5:00' },
        { grade: 10, pace: '10:00' },
    ], 600, { preserveZeroGradePace: true });
}
catch (problem) {
    unreachableAnchoredTarget = problem instanceof Error ? problem.message : '';
}
equal(
    unreachableAnchoredTarget,
    'That target cannot be reached while keeping the 0% gradient pace unchanged. Allow the flat pace to change or choose a closer target.',
    'anchored generation explains unreachable targets',
);

let invalidTarget = '';
try {
    generatePaceCurveForRoute({
        name: 'Test', points: [{ d: 0, ele: 0 }, { d: 100, ele: 0 }], profile: [0, 0], localGradientWindow: 50,
    }, [{ grade: 0, pace: '5:00' }, { grade: 10, pace: '10:00' }], 0);
}
catch (problem) {
    invalidTarget = problem instanceof Error ? problem.message : '';
}
equal(invalidTarget, 'Enter a target moving time greater than zero.', 'invalid target times fail with a useful message');

const verySlow = generatePaceCurveForRoute({
    name: 'Very short climb',
    points: [{ d: 0, ele: 0 }, { d: 5, ele: .5 }, { d: 10, ele: 1 }],
    profile: [0, .5, 1],
    localGradientWindow: 50,
}, [
    { grade: 0, pace: '5:00' },
    { grade: 10, pace: '10:00' },
], 999 * 3600);
close(verySlow.generatedPredictionSeconds, 999 * 3600, 1, 'very slow targets remain representable');
equal(verySlow.points.every(isSemanticallyValidPacePoint), true, 'generated points remain semantically valid');

let unrepresentableRoundedTarget = '';
try {
    generatePaceCurveForRoute({
        name: 'Very short climb',
        points: [{ d: 0, ele: 0 }, { d: 5, ele: .5 }, { d: 10, ele: 1 }],
        profile: [0, .5, 1],
        localGradientWindow: 50,
    }, [
        { grade: 0, pace: '5:00' },
        { grade: 10, pace: 'vam:600' },
    ], 999 * 3600, { roundToNiceValues: true });
}
catch (problem) {
    unrepresentableRoundedTarget = problem instanceof Error ? problem.message : '';
}
equal(
    unrepresentableRoundedTarget,
    'That target cannot be represented by a valid pace curve. Turn off nice-number rounding or choose a closer target.',
    'materially missed rounded targets are rejected rather than saved',
);

let unrepresentableFastTarget = '';
try {
    generatePaceCurveForRoute({
        name: 'Short flat',
        points: [{ d: 0, ele: 0 }, { d: 1000, ele: 0 }],
        profile: [0, 0],
        localGradientWindow: 50,
    }, [
        { grade: 0, pace: '5:00' },
        { grade: 10, pace: '10:00' },
    ], .1);
}
catch (problem) {
    unrepresentableFastTarget = problem instanceof Error ? problem.message : '';
}
equal(
    unrepresentableFastTarget,
    'That target requires pace values outside the supported range. Choose a closer target.',
    'unrepresentably fast targets are rejected rather than producing zero pace',
);

console.log('Pace-generator regression tests passed.');
