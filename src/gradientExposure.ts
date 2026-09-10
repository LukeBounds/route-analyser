import { createPaceInterpolator, type ResolvedPaceCurvePoint } from './pace.js';
import { localGradeAtDistance, type TerrainPoint } from './terrain.js';

export interface GradientExposureBand {
    label: string;
    minimumGrade: number | null;
    maximumGrade: number | null;
    distance: number;
    distanceSharePercent: number;
    predictedSeconds: number | null;
    predictedTimeSharePercent: number | null;
}

export interface CurvePointInfluence {
    grade: number;
    secondsPerKm: number;
    addedSecondsPerOnePercentSlower: number;
    influencePercent: number;
}

export interface GradientExposureAnalysis {
    bands: GradientExposureBand[];
    totalDistance: number;
    totalPredictedSeconds: number | null;
    curvePointInfluence: CurvePointInfluence[];
}

type BandDefinition = Pick<GradientExposureBand, 'label' | 'minimumGrade' | 'maximumGrade'>;

export const gradientExposureBands: BandDefinition[] = [
    { label: 'Below −55%', minimumGrade: null, maximumGrade: -55 },
    { label: '−55% to −50%', minimumGrade: -55, maximumGrade: -50 },
    { label: '−50% to −45%', minimumGrade: -50, maximumGrade: -45 },
    { label: '−45% to −40%', minimumGrade: -45, maximumGrade: -40 },
    { label: '−40% to −35%', minimumGrade: -40, maximumGrade: -35 },
    { label: '−35% to −30%', minimumGrade: -35, maximumGrade: -30 },
    { label: '−30% to −25%', minimumGrade: -30, maximumGrade: -25 },
    { label: '−25% to −20%', minimumGrade: -25, maximumGrade: -20 },
    { label: '−20% to −15%', minimumGrade: -20, maximumGrade: -15 },
    { label: '−15% to −10%', minimumGrade: -15, maximumGrade: -10 },
    { label: '−10% to −5%', minimumGrade: -10, maximumGrade: -5 },
    { label: '−5% to −3%', minimumGrade: -5, maximumGrade: -3 },
    { label: '−3% to −1%', minimumGrade: -3, maximumGrade: -1 },
    { label: '−1% to +1%', minimumGrade: -1, maximumGrade: 1 },
    { label: '+1% to +3%', minimumGrade: 1, maximumGrade: 3 },
    { label: '+3% to +5%', minimumGrade: 3, maximumGrade: 5 },
    { label: '+5% to +10%', minimumGrade: 5, maximumGrade: 10 },
    { label: '+10% to +15%', minimumGrade: 10, maximumGrade: 15 },
    { label: '+15% to +20%', minimumGrade: 15, maximumGrade: 20 },
    { label: '+20% to +25%', minimumGrade: 20, maximumGrade: 25 },
    { label: '+25% to +30%', minimumGrade: 25, maximumGrade: 30 },
    { label: '+30% to +35%', minimumGrade: 30, maximumGrade: 35 },
    { label: '+35% to +40%', minimumGrade: 35, maximumGrade: 40 },
    { label: '+40% to +45%', minimumGrade: 40, maximumGrade: 45 },
    { label: '+45% to +50%', minimumGrade: 45, maximumGrade: 50 },
    { label: '+50% to +55%', minimumGrade: 50, maximumGrade: 55 },
    { label: '+55% and above', minimumGrade: 55, maximumGrade: null },
];

function bandIndexForGrade(grade: number) {
    return gradientExposureBands.findIndex(band =>
        (band.minimumGrade === null || grade >= band.minimumGrade)
        && (band.maximumGrade === null || grade < band.maximumGrade));
}

export function analyseGradientExposure(
    points: TerrainPoint[],
    profile: number[],
    localGradientWindow: number,
    curve: ResolvedPaceCurvePoint[] = [],
): GradientExposureAnalysis {
    if (points.length < 2 || profile.length !== points.length)
        throw new Error('Gradient exposure needs a complete analysed route profile.');
    const samples: Array<{ distance: number; grade: number }> = [];
    const distances = gradientExposureBands.map(() => 0);
    for (let index = 1; index < points.length; index++) {
        const distance = points[index].d - points[index - 1].d;
        if (distance <= 0)
            continue;
        const midpoint = (points[index].d + points[index - 1].d) / 2;
        const grade = localGradeAtDistance(points, profile, midpoint, localGradientWindow);
        const bandIndex = bandIndexForGrade(grade);
        if (bandIndex < 0)
            continue;
        samples.push({ distance, grade });
        distances[bandIndex] += distance;
    }
    const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
    const paceAt = curve.length >= 2 ? createPaceInterpolator(curve) : null;
    const predictedTimes = gradientExposureBands.map(() => 0);
    let totalPredictedSeconds: number | null = paceAt ? 0 : null;
    if (paceAt) {
        samples.forEach(sample => {
            const seconds = sample.distance / 1000 * paceAt(sample.grade);
            predictedTimes[bandIndexForGrade(sample.grade)] += seconds;
            totalPredictedSeconds! += seconds;
        });
    }
    const bands = gradientExposureBands.map((band, index): GradientExposureBand => ({
        ...band,
        distance: distances[index],
        distanceSharePercent: totalDistance > 0 ? distances[index] / totalDistance * 100 : 0,
        predictedSeconds: paceAt ? predictedTimes[index] : null,
        predictedTimeSharePercent: paceAt && totalPredictedSeconds! > 0
            ? predictedTimes[index] / totalPredictedSeconds! * 100
            : null,
    }));
    const influenceDeltas = paceAt ? curve.map((point, pointIndex) => {
        const adjusted = curve.map((candidate, index) => ({
            ...candidate,
            seconds: candidate.seconds * (index === pointIndex ? 1.01 : 1),
        }));
        const adjustedPaceAt = createPaceInterpolator(adjusted);
        const adjustedTotal = samples.reduce(
            (sum, sample) => sum + sample.distance / 1000 * adjustedPaceAt(sample.grade),
            0,
        );
        return {
            grade: point.grade,
            secondsPerKm: point.seconds,
            addedSecondsPerOnePercentSlower: Math.max(0, adjustedTotal - totalPredictedSeconds!),
        };
    }) : [];
    const totalInfluence = influenceDeltas.reduce(
        (sum, influence) => sum + influence.addedSecondsPerOnePercentSlower,
        0,
    );
    const curvePointInfluence = influenceDeltas.map(influence => ({
        ...influence,
        influencePercent: totalInfluence > 0
            ? influence.addedSecondsPerOnePercentSlower / totalInfluence * 100
            : 0,
    }));
    return { bands, totalDistance, totalPredictedSeconds, curvePointInfluence };
}
