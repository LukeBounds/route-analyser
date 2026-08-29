import {
    analyseTerrain,
    localGradeAtDistance,
    smoothElevations,
    type TerrainPoint,
    type TerrainSettings,
} from '../src/terrain.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
    }
}

function close(actual: number, expected: number, message: string): void {
    if (Math.abs(actual - expected) > 1e-9) {
        throw new Error(`${message}: expected ${expected}, received ${actual}`);
    }
}

const settings = (overrides: Partial<TerrainSettings> = {}): TerrainSettings => ({
    gradeThreshold: 2,
    rollingWindow: 150,
    minimumSection: 0,
    flatRollingBridge: 0,
    profileSmoothing: 0,
    bridgeCounterSlopes: false,
    counterSlopeBridge: 250,
    counterSlopeReversal: 5,
    ...overrides,
});

const points = (distances: number[], elevations: number[]): TerrainPoint[] => distances.map((d, index) => ({
    d,
    ele: elevations[index],
}));

const climb = analyseTerrain(points([0, 200, 400], [0, 10, 20]), settings());
equal(climb.sections.length, 1, 'a sustained climb produces one terrain section');
equal(climb.sections[0].k, 'climb', 'a sustained positive grade is a climb');
equal(climb.primarySections[0].c[0].label, 'moderate sub-climb', 'a five-percent climb uses the current moderate band');
equal(
    localGradeAtDistance(points([0, 200, 400], [0, 10, 20]), [0, 10, 20], 200),
    5,
    'the shared 100 m local-gradient calculation preserves sparse-route behaviour',
);
equal(
    localGradeAtDistance(points([0, 0, 100], [0, 1, 6]), [0, 1, 6], 0),
    6,
    'the shared local-gradient calculation safely spans duplicate-distance points',
);

const descent = analyseTerrain(points([0, 200, 400], [20, 10, 0]), settings());
equal(descent.sections[0].k, 'descent', 'a sustained negative grade is a descent');

const flat = analyseTerrain(points([0, 200, 400], [10, 10, 10]), settings());
equal(flat.sections[0].k, 'flat', 'a level route is flat');

const alternating = points([0, 100, 200, 300], [0, 10, 0, 0]);
const rolling = analyseTerrain(alternating, settings({ rollingWindow: 200 }));
equal(rolling.sections[0].k, 'rolling', 'internal climb and descent movements become rolling within the rolling window');
equal(rolling.sections[0].a, 0, 'the rolling span starts with the internal climb');
equal(rolling.sections[0].b, 2, 'the rolling span ends with the internal descent');
const notRolling = analyseTerrain(alternating, settings({ rollingWindow: 150 }));
equal(notRolling.sections[0].k, 'climb', 'surrounding directions outside the rolling window are not rolling');
equal(notRolling.sections[1].k, 'descent', 'the opposite direction remains separate outside the rolling window');

const shortFlat = points([0, 500, 600, 1100], [0, 25, 25, 50]);
const flatBridge = analyseTerrain(shortFlat, settings({ flatRollingBridge: 300 }));
equal(flatBridge.primarySections.length, 1, 'two climbs join across a qualifying flat bridge');
equal(flatBridge.primarySections[0].k, 'climb', 'the joined flat bridge retains the surrounding climb direction');
equal(flatBridge.primarySections[0].c.some(section => section.label === 'sub-flat'), true, 'a joined flat remains visible as a subsection');
const bridgeDisabled = analyseTerrain(shortFlat, settings({ flatRollingBridge: 0 }));
equal(bridgeDisabled.primarySections.length, 3, 'a flat interruption remains primary when bridging is disabled');

const disproportionateFlat = analyseTerrain(
    points([0, 500, 650, 1150], [0, 25, 25, 50]),
    settings({ flatRollingBridge: 300 }),
);
equal(disproportionateFlat.primarySections.length, 3, 'the 25-percent rule rejects a disproportionate flat bridge');

const mergedMinimum = analyseTerrain(shortFlat, settings({ minimumSection: 150 }));
equal(mergedMinimum.sections.length, 1, 'a fragment below Minimum section is absorbed before primary bridging');
equal(mergedMinimum.sections[0].k, 'climb', 'an absorbed short flat follows its longer neighbouring climb');

const counterSlopePoints = points([0, 500, 600, 1100], [0, 50, 45, 95]);
const counterSlope = analyseTerrain(counterSlopePoints, settings({
    bridgeCounterSlopes: true,
    counterSlopeBridge: 250,
    counterSlopeReversal: 5,
}));
equal(counterSlope.primarySections.length, 1, 'a qualifying short counter-slope is bridged');
equal(
    counterSlope.primarySections[0].c[1].label,
    'bridged counter-slope moderate descent',
    'a bridged counter-slope remains explicitly labelled',
);
const reversalRejected = analyseTerrain(counterSlopePoints, settings({
    bridgeCounterSlopes: true,
    counterSlopeBridge: 250,
    counterSlopeReversal: 4,
}));
equal(reversalRejected.primarySections.length, 3, 'counter-slope reversal percentage is enforced independently');
const lengthRejected = analyseTerrain(counterSlopePoints, settings({
    bridgeCounterSlopes: true,
    counterSlopeBridge: 99,
    counterSlopeReversal: 5,
}));
equal(lengthRejected.primarySections.length, 3, 'counter-slope bridge distance is enforced independently');

const changingGrade = analyseTerrain(points([0, 200, 400, 600], [0, 6, 26, 32]), settings());
equal(changingGrade.primarySections.length, 1, 'grade-band changes do not split a sustained primary climb');
equal(
    changingGrade.primarySections[0].c.map(section => section.label).join('|'),
    'gentle sub-climb|steep sub-climb|gentle sub-climb',
    'persistent local grade bands become separate subsections',
);

const noisy = points([0, 10, 20], [0, 10, 0]);
equal(smoothElevations(noisy, 0).join(','), '0,10,0', 'zero smoothing preserves the source profile');
const smoothed = smoothElevations(noisy, 20);
close(smoothed[0], 5, 'smoothing averages the start window');
close(smoothed[1], 10 / 3, 'smoothing averages the centre window');
close(smoothed[2], 5, 'smoothing averages the end window');

const undulating = points([0, 10, 20, 30], [0, 2, 1, 3]);
const unsmoothedTotals = analyseTerrain(undulating, settings({ profileSmoothing: 0 })).totals;
const smoothedTotals = analyseTerrain(undulating, settings({ profileSmoothing: 20 })).totals;
equal(unsmoothedTotals.up, 4, 'raw total ascent retains every positive point-to-point change');
equal(unsmoothedTotals.down, 1, 'raw total descent retains every negative point-to-point change');
equal(smoothedTotals.up, unsmoothedTotals.up, 'profile smoothing does not alter total ascent');
equal(smoothedTotals.down, unsmoothedTotals.down, 'profile smoothing does not alter total descent');

const rawRevalidation = analyseTerrain(
    points([0, 50, 100], [0, 0, 10]),
    settings({ profileSmoothing: 200 }),
);
equal(
    rawRevalidation.sections[0].k,
    'climb',
    'the current raw endpoint sanity check can reclassify a smoothed flat section',
);

console.log('Terrain regression tests passed.');
