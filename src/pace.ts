import type { PaceCurveBackup, PaceCurvePoint } from './core.js';
import { parsePaceCurveBackup } from './core.js';
import { localGradeAtDistance, type TerrainPoint } from './terrain.js';

export type PacePointMethod = 'pace' | 'vam';

export interface ResolvedPaceCurvePoint extends PaceCurvePoint {
    seconds: number;
}

export interface RoutePacePrediction {
    cumulative: number[];
    seconds: number[];
}

export function parsePaceSeconds(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match || Number(match[2]) > 59) {
        return null;
    }
    const seconds = Number(match[1]) * 60 + Number(match[2]);
    return seconds > 0 ? seconds : null;
}

export function pacePointMethod(point: PaceCurvePoint): PacePointMethod {
    return point.pace.startsWith('vam:') ? 'vam' : 'pace';
}

export function pacePointInput(point: PaceCurvePoint): string {
    return pacePointMethod(point) === 'vam' ? point.pace.slice(4) : point.pace;
}

export function pacePointSeconds(point: PaceCurvePoint): number | null {
    if (pacePointMethod(point) === 'pace') {
        return parsePaceSeconds(point.pace);
    }
    const vam = Number(pacePointInput(point));
    return point.grade !== 0 && Number.isFinite(vam) && vam > 0
        ? 36000 * Math.abs(point.grade) / vam
        : null;
}

export function isSemanticallyValidPacePoint(point: PaceCurvePoint): boolean {
    return Number.isFinite(point.grade)
        && Math.abs(point.grade) <= 100
        && (point.pace.trim() === '' || pacePointSeconds(point) !== null);
}

export function parseValidatedPaceCurveBackup(value: unknown): PaceCurveBackup | null {
    const backup = parsePaceCurveBackup(value);
    return backup && backup.curves.every(curve => curve.points.every(isSemanticallyValidPacePoint))
        ? backup
        : null;
}

export function resolvePaceCurve(points: PaceCurvePoint[]): ResolvedPaceCurvePoint[] {
    return points
        .map(point => ({ ...point, seconds: pacePointSeconds(point) }))
        .filter((point): point is ResolvedPaceCurvePoint => point.seconds !== null && isSemanticallyValidPacePoint(point))
        .sort((a, b) => a.grade - b.grade);
}

export function createPaceInterpolator(points: ResolvedPaceCurvePoint[]): (grade: number) => number {
    if (points.length < 2) {
        throw new Error('Pace interpolation needs at least two valid curve points.');
    }
    const curve = [...points].sort((a, b) => a.grade - b.grade);
    return grade => {
        if (grade <= curve[0].grade) {
            return curve[0].seconds;
        }
        if (grade >= curve.at(-1)!.grade) {
            return curve.at(-1)!.seconds;
        }
        const upperIndex = curve.findIndex(point => point.grade >= grade);
        const lower = curve[upperIndex - 1];
        const upper = curve[upperIndex];
        const gradeSpan = upper.grade - lower.grade;
        return gradeSpan <= 0
            ? upper.seconds
            : lower.seconds + (upper.seconds - lower.seconds) * (grade - lower.grade) / gradeSpan;
    };
}

export function predictRoutePace(
    points: TerrainPoint[],
    profile: number[],
    curve: ResolvedPaceCurvePoint[],
): RoutePacePrediction {
    if (profile.length !== points.length) {
        throw new Error('Route pace prediction needs one profile elevation per route point.');
    }
    const paceAt = createPaceInterpolator(curve);
    const cumulative = [0];
    const seconds = [0];
    for (let index = 1; index < points.length; index++) {
        const distance = points[index].d - points[index - 1].d;
        if (distance <= 0) {
            seconds.push(0);
            cumulative.push(cumulative[index - 1]);
            continue;
        }
        const midpoint = (points[index].d + points[index - 1].d) / 2;
        const grade = localGradeAtDistance(points, profile, midpoint);
        const segmentSeconds = distance / 1000 * paceAt(grade);
        seconds.push(segmentSeconds);
        cumulative.push(cumulative[index - 1] + segmentSeconds);
    }
    return { cumulative, seconds };
}
