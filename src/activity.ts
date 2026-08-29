import {
    haversineMeters,
    matchRouteSamples,
    type RouteMatchQuality,
} from './core.js';
import type { RecordedActivityPoint, RoutePoint } from './gpx.js';

export type ActivityPoint = RecordedActivityPoint & {
    moving: number;
    routeD: number;
};

export type ActivityMovingSettings = {
    gapCutoffSeconds: number;
    detectStationaryRests: boolean;
    minimumMovingSpeedKmh: number;
};

export type ActivityComparison = {
    expected: number;
    actual: number;
    delta: number;
};

export function alignActivityToRoute(route: RoutePoint[], recorded: RecordedActivityPoint[]): {
    points: ActivityPoint[];
    quality: RouteMatchQuality;
} {
    const match = matchRouteSamples(route, recorded);
    return {
        points: recorded.map((point, index) => ({
            ...point,
            moving: 0,
            routeD: route[match.indices[index]].d,
        })),
        quality: match.quality,
    };
}

export function calculateActivityMovingTime(points: ActivityPoint[], settings: ActivityMovingSettings): ActivityPoint[] {
    const gapCutoff = settings.gapCutoffSeconds * 1000;
    const minimumSpeed = settings.detectStationaryRests ? settings.minimumMovingSpeedKmh / 3.6 : 0;
    const windowRadius = 15_000;
    let moving = 0;
    let left = 0;
    let right = 0;
    return points.map((point, index) => {
        while (left < index && (points[left].segment !== point.segment || point.time - points[left].time > windowRadius))
            left++;
        right = Math.max(right, index);
        while (right + 1 < points.length && points[right + 1].segment === point.segment && points[right + 1].time - point.time <= windowRadius)
            right++;
        if (index && !point.breakBefore && points[index - 1].segment === point.segment) {
            const elapsed = point.time - points[index - 1].time;
            const windowSeconds = (points[right].time - points[left].time) / 1000;
            const windowSpeed = windowSeconds > 0 ? haversineMeters(points[left], points[right]) / windowSeconds : 0;
            if (elapsed >= 0 && elapsed <= gapCutoff && windowSpeed >= minimumSpeed)
                moving += elapsed / 1000;
        }
        return { ...point, moving };
    });
}

export function interpolateRouteCumulativeTime(route: Array<{ d: number }>, cumulative: number[], distance: number): number | null {
    if (!route.length || cumulative.length !== route.length || distance < 0 || distance > route.at(-1)!.d)
        return null;
    let low = 0;
    let high = route.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        route[middle].d < distance ? low = middle + 1 : high = middle;
    }
    if (low === 0)
        return cumulative[0];
    const start = route[low - 1];
    const end = route[low];
    const fraction = (distance - start.d) / Math.max(1, end.d - start.d);
    return cumulative[low - 1] + (cumulative[low] - cumulative[low - 1]) * fraction;
}

export function interpolateActivityMovingTime(activity: ActivityPoint[], distance: number): number | null {
    if (activity.length < 2 || distance < activity[0].routeD || distance > activity.at(-1)!.routeD)
        return null;
    let low = 0;
    let high = activity.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        activity[middle].routeD < distance ? low = middle + 1 : high = middle;
    }
    if (low === 0)
        return activity[0].moving;
    const start = activity[low - 1];
    const end = activity[low];
    const span = end.routeD - start.routeD;
    if (span < 1)
        return end.moving;
    return start.moving + (end.moving - start.moving) * (distance - start.routeD) / span;
}

export function compareActivityTimes(
    from: number,
    to: number,
    predictedAt: (distance: number) => number | null,
    actualAt: (distance: number) => number | null,
): ActivityComparison | null {
    const expectedStart = predictedAt(from);
    const expectedEnd = predictedAt(to);
    const actualStart = actualAt(from);
    const actualEnd = actualAt(to);
    if (expectedStart === null || expectedEnd === null || actualStart === null || actualEnd === null)
        return null;
    const expected = expectedEnd - expectedStart;
    const actual = actualEnd - actualStart;
    return { expected, actual, delta: actual - expected };
}

export function createActivityGradientSamples(
    activity: ActivityPoint[],
    localGradeAt: (distance: number) => number,
): Array<{ grade: number; pace: number }> {
    const samples: Array<{ grade: number; pace: number }> = [];
    let start = 0;
    for (let end = 1; end < activity.length; end++) {
        const distance = activity[end].routeD - activity[start].routeD;
        if (distance < 100)
            continue;
        const seconds = activity[end].moving - activity[start].moving;
        const midpoint = (activity[end].routeD + activity[start].routeD) / 2;
        const pace = seconds / (distance / 1000);
        if (seconds > 0 && Number.isFinite(pace) && pace > 30 && pace < 7200)
            samples.push({ grade: localGradeAt(midpoint), pace });
        start = end;
    }
    return samples;
}
