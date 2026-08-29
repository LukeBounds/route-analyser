import { isStoredPaceCurve, type StoredPaceCurve } from './core.js';

export const paceLibraryFormat = 'route-analyser-pace-library';
export const paceLibraryVersion = 1;

export interface PaceLibraryState {
    format: typeof paceLibraryFormat;
    version: typeof paceLibraryVersion;
    selectedCurveId?: string;
    curves: StoredPaceCurve[];
}

export interface LoadedPaceLibrary {
    curves: StoredPaceCurve[];
    selectedCurveId?: string;
    migrated: boolean;
}

const cloneCurves = (curves: StoredPaceCurve[]) => curves.map(curve => ({
    ...curve,
    points: curve.points.map(point => ({ ...point })),
}));

export function parsePaceLibraryStorage(value: unknown): LoadedPaceLibrary | null {
    if (Array.isArray(value) && value.length && value.every(isStoredPaceCurve)) {
        return { curves: cloneCurves(value), migrated: true };
    }
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as Partial<PaceLibraryState>;
    if (candidate.format !== paceLibraryFormat
        || candidate.version !== paceLibraryVersion
        || !Array.isArray(candidate.curves)
        || !candidate.curves.length
        || !candidate.curves.every(isStoredPaceCurve)
        || (candidate.selectedCurveId !== undefined && typeof candidate.selectedCurveId !== 'string')) {
        return null;
    }
    return {
        curves: cloneCurves(candidate.curves),
        selectedCurveId: candidate.selectedCurveId,
        migrated: false,
    };
}

export function createPaceLibraryState(
    curves: StoredPaceCurve[],
    selectedCurveId: string,
): PaceLibraryState {
    return {
        format: paceLibraryFormat,
        version: paceLibraryVersion,
        selectedCurveId,
        curves: cloneCurves(curves),
    };
}
