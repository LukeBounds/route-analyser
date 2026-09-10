import { formatPace, type PaceCurvePoint } from './core.js';
import {
    createPaceInterpolator,
    isSemanticallyValidPacePoint,
    pacePointInput,
    pacePointMethod,
    pacePointSeconds,
    predictRoutePace,
    resolvePaceCurve,
    roundPaceCurvePoints,
} from './pace.js';
import type { TerrainPoint } from './terrain.js';

export interface PaceGenerationRoute {
    name: string;
    points: TerrainPoint[];
    profile: number[];
    localGradientWindow: number;
}

export interface GeneratedPaceCurve {
    points: PaceCurvePoint[];
    scaleFactor: number;
    sourcePredictionSeconds: number;
    generatedPredictionSeconds: number;
    targetMovingSeconds: number;
}

export interface PaceGenerationOptions {
    preserveZeroGradePace?: boolean;
    roundToNiceValues?: boolean;
}

function scaledVam(value: number) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error('That target requires VAM values outside the supported range. Choose a closer target.');
    return String(Number(value.toPrecision(10)));
}

export function scalePaceCurve(
    points: PaceCurvePoint[],
    scaleFactor: number,
    options: PaceGenerationOptions = {},
): PaceCurvePoint[] {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0)
        throw new Error('The pace scale must be greater than zero.');
    const sourceCurve = resolvePaceCurve(points);
    const scaled = points.flatMap(point => {
        const seconds = pacePointSeconds(point);
        if (seconds === null)
            return [];
        const gradeWeight = options.preserveZeroGradePace
            ? Math.min(1, Math.abs(point.grade) / 5)
            : 1;
        const pointScale = 1 + (scaleFactor - 1) * gradeWeight;
        const scaledPoint = {
            grade: point.grade,
            pace: pacePointMethod(point) === 'vam'
                ? `vam:${scaledVam(Number(pacePointInput(point)) / pointScale)}`
                : formatPace(seconds * pointScale),
        };
        if (!isSemanticallyValidPacePoint(scaledPoint) || !scaledPoint.pace)
            throw new Error('That target requires pace values outside the supported range. Choose a closer target.');
        return [scaledPoint];
    });
    if (options.preserveZeroGradePace
        && sourceCurve.length >= 2
        && !scaled.some(point => point.grade === 0)) {
        scaled.push({
            grade: 0,
            pace: formatPace(createPaceInterpolator(sourceCurve)(0)),
        });
    }
    const sorted = scaled.sort((a, b) => a.grade - b.grade);
    if (!options.roundToNiceValues)
        return sorted;
    const rounded = roundPaceCurvePoints(sorted);
    if (!options.preserveZeroGradePace || sourceCurve.length < 2)
        return rounded;
    const sourceZeroPace = formatPace(createPaceInterpolator(sourceCurve)(0));
    return rounded.map(point => point.grade === 0 ? { ...point, pace: sourceZeroPace } : point);
}

function routePredictionSeconds(route: PaceGenerationRoute, points: PaceCurvePoint[]) {
    const curve = resolvePaceCurve(points);
    if (curve.length < 2)
        throw new Error('The generated curve does not contain enough valid gradient points.');
    return predictRoutePace(
        route.points,
        route.profile,
        curve,
        route.localGradientWindow,
    ).cumulative.at(-1)!;
}

function findAnchoredScale(
    route: PaceGenerationRoute,
    sourcePoints: PaceCurvePoint[],
    sourcePrediction: number,
    targetMovingSeconds: number,
    options: PaceGenerationOptions,
) {
    if (Math.abs(sourcePrediction - targetMovingSeconds) < .5)
        return 1;
    const predictionAt = (factor: number) => routePredictionSeconds(
        route,
        scalePaceCurve(sourcePoints, factor, options),
    );
    let low = .01;
    let high = 1;
    let lowPrediction = predictionAt(low);
    let highPrediction = sourcePrediction;
    if (targetMovingSeconds < lowPrediction - .5)
        throw new Error('That target is too fast while keeping the 0% gradient pace unchanged. Allow the flat pace to change or choose a slower target.');
    if (targetMovingSeconds > sourcePrediction) {
        const unroundedPredictionAtTwo = routePredictionSeconds(
            route,
            scalePaceCurve(sourcePoints, 2, { ...options, roundToNiceValues: false }),
        );
        if (unroundedPredictionAtTwo <= sourcePrediction + Number.EPSILON * sourcePrediction)
            throw new Error('That target cannot be reached while keeping the 0% gradient pace unchanged. Allow the flat pace to change or choose a closer target.');
        low = high;
        lowPrediction = highPrediction;
        while (highPrediction < targetMovingSeconds) {
            high *= 2;
            if (!Number.isFinite(high))
                throw new Error('That target cannot be reached while keeping the 0% gradient pace unchanged. Allow the flat pace to change or choose a closer target.');
            try {
                highPrediction = predictionAt(high);
            }
            catch {
                throw new Error('That target cannot be reached while keeping the 0% gradient pace unchanged. Allow the flat pace to change or choose a closer target.');
            }
            if (highPrediction < targetMovingSeconds) {
                low = high;
                lowPrediction = highPrediction;
            }
        }
    }
    for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (low + high) / 2;
        const middlePrediction = predictionAt(middle);
        if (middlePrediction < targetMovingSeconds) {
            low = middle;
            lowPrediction = middlePrediction;
        }
        else {
            high = middle;
            highPrediction = middlePrediction;
        }
    }
    return Math.abs(lowPrediction - targetMovingSeconds) <= Math.abs(highPrediction - targetMovingSeconds)
        ? low
        : high;
}

export function generatePaceCurveForRoute(
    route: PaceGenerationRoute,
    sourcePoints: PaceCurvePoint[],
    targetMovingSeconds: number,
    options: PaceGenerationOptions = {},
): GeneratedPaceCurve {
    if (!Number.isFinite(targetMovingSeconds) || targetMovingSeconds <= 0)
        throw new Error('Enter a target moving time greater than zero.');
    if (route.points.length < 2 || route.profile.length !== route.points.length)
        throw new Error('Upload and analyse a route with elevation before generating a curve.');
    const sourceCurve = resolvePaceCurve(sourcePoints);
    if (sourceCurve.length < 2)
        throw new Error('The starting curve needs at least two valid gradient points.');
    const sourcePrediction = predictRoutePace(
        route.points,
        route.profile,
        sourceCurve,
        route.localGradientWindow,
    ).cumulative.at(-1)!;
    if (!Number.isFinite(sourcePrediction) || sourcePrediction <= 0)
        throw new Error('The starting curve could not produce a route prediction.');
    const scaleFactor = options.preserveZeroGradePace
        ? findAnchoredScale(route, sourcePoints, sourcePrediction, targetMovingSeconds, options)
        : targetMovingSeconds / sourcePrediction;
    const points = scalePaceCurve(sourcePoints, scaleFactor, options);
    const generatedPredictionSeconds = routePredictionSeconds(route, points);
    const difference = Math.abs(generatedPredictionSeconds - targetMovingSeconds);
    const routeDistanceKm = route.points.at(-1)!.d / 1000;
    const acceptableDifference = options.roundToNiceValues
        ? Math.max(300, targetMovingSeconds * .02)
        : Math.max(2, routeDistanceKm * .75);
    if (!Number.isFinite(generatedPredictionSeconds) || difference > acceptableDifference)
        throw new Error('That target cannot be represented by a valid pace curve. Turn off nice-number rounding or choose a closer target.');
    return {
        points,
        scaleFactor,
        sourcePredictionSeconds: sourcePrediction,
        generatedPredictionSeconds,
        targetMovingSeconds,
    };
}
