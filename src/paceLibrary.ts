import { isStoredPaceCurve, type PaceCurveBackup, type PaceCurvePoint, type StoredPaceCurve } from './core.js';

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

const clonePoints = (points: PaceCurvePoint[]) => points.map(point => ({ ...point }));

export interface PaceChartPreferences {
    curveIds: string[];
    showPace: boolean;
    showSpeed: boolean;
    showVam: boolean;
}

export function normalisePaceChartPreferences(value: unknown, curves: StoredPaceCurve[]): PaceChartPreferences {
    const candidate = value && typeof value === 'object' ? value as Partial<PaceChartPreferences> : null;
    const validIds = new Set(curves.map(curve => curve.id));
    const curveIds = Array.isArray(candidate?.curveIds)
        ? candidate.curveIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
        : [];
    const showSpeed = candidate?.showSpeed !== false;
    const showPace = candidate?.showPace !== false || !showSpeed;
    return {
        curveIds: curveIds.length ? [...new Set(curveIds)] : curves.map(curve => curve.id),
        showPace,
        showSpeed,
        showVam: candidate?.showVam === true,
    };
}

export class PaceLibraryModel {
    readonly curves: StoredPaceCurve[];
    selectedCurveId: string;
    chartPreferences: PaceChartPreferences;

    constructor(
        curves: StoredPaceCurve[],
        selectedCurveId: string | undefined,
        chartPreferences: unknown,
        private readonly createId: () => string,
    ) {
        if (!curves.length)
            throw new Error('A pace library needs at least one curve.');
        this.curves = cloneCurves(curves);
        this.selectedCurveId = this.curves.some(curve => curve.id === selectedCurveId)
            ? selectedCurveId!
            : this.curves[0].id;
        this.chartPreferences = normalisePaceChartPreferences(chartPreferences, this.curves);
    }

    get activeCurve() {
        return this.curves.find(curve => curve.id === this.selectedCurveId)!;
    }

    get points() {
        return this.activeCurve.points;
    }

    select(id: string) {
        if (!this.curves.some(curve => curve.id === id))
            return false;
        this.selectedCurveId = id;
        return true;
    }

    replaceActivePoints(points: PaceCurvePoint[]) {
        this.activeCurve.points = clonePoints(points);
        return this.activeCurve.points;
    }

    uniqueName(requested: string, ignoreId?: string) {
        const base = requested.trim() || 'Pace curve';
        const names = new Set(this.curves
            .filter(curve => curve.id !== ignoreId)
            .map(curve => curve.name.toLocaleLowerCase()));
        if (!names.has(base.toLocaleLowerCase()))
            return base;
        let suffix = 2;
        while (names.has(`${base} ${suffix}`.toLocaleLowerCase()))
            suffix++;
        return `${base} ${suffix}`;
    }

    renameActive(requested: string, ensureUnique = true) {
        const trimmed = requested.trim();
        if (!trimmed)
            return null;
        const name = ensureUnique ? this.uniqueName(trimmed, this.selectedCurveId) : trimmed;
        this.activeCurve.name = name;
        return name;
    }

    createCurve(requestedName: string, points: PaceCurvePoint[]) {
        const curve: StoredPaceCurve = {
            id: this.createId(),
            name: this.uniqueName(requestedName),
            points: clonePoints(points),
        };
        this.curves.push(curve);
        this.chartPreferences.curveIds.push(curve.id);
        this.selectedCurveId = curve.id;
        return curve;
    }

    duplicateActive() {
        return this.createCurve(`${this.activeCurve.name} copy`, this.activeCurve.points);
    }

    deleteActive() {
        if (this.curves.length <= 1)
            return null;
        const deleting = this.activeCurve;
        const index = this.curves.indexOf(deleting);
        this.curves.splice(index, 1);
        const next = this.curves[Math.min(index, this.curves.length - 1)];
        this.chartPreferences.curveIds = this.chartPreferences.curveIds.filter(id => id !== deleting.id);
        if (!this.chartPreferences.curveIds.length)
            this.chartPreferences.curveIds = [next.id];
        this.selectedCurveId = next.id;
        return deleting;
    }

    importBackup(backup: PaceCurveBackup) {
        const importedIds = new Map<string, string>();
        for (const source of backup.curves) {
            const id = this.curves.some(curve => curve.id === source.id) ? this.createId() : source.id;
            const curve: StoredPaceCurve = {
                id,
                name: this.uniqueName(source.name),
                points: clonePoints(source.points),
            };
            importedIds.set(source.id, id);
            this.curves.push(curve);
            this.chartPreferences.curveIds.push(id);
        }
        this.chartPreferences.curveIds = [...new Set(this.chartPreferences.curveIds)];
        this.selectedCurveId = backup.selectedCurveId && importedIds.has(backup.selectedCurveId)
            ? importedIds.get(backup.selectedCurveId)!
            : importedIds.values().next().value!;
        return backup.curves.length;
    }

    setCurveCompared(id: string, compared: boolean) {
        if (!this.curves.some(curve => curve.id === id))
            return false;
        const selected = new Set(this.chartPreferences.curveIds);
        if (compared)
            selected.add(id);
        else if (selected.size > 1)
            selected.delete(id);
        else
            return false;
        this.chartPreferences.curveIds = [...selected];
        return true;
    }

    setChartSeries(showPace: boolean, showSpeed: boolean, showVam: boolean) {
        const accepted = showPace || showSpeed;
        this.chartPreferences.showPace = accepted ? showPace : true;
        this.chartPreferences.showSpeed = showSpeed;
        this.chartPreferences.showVam = showVam;
        return accepted;
    }

    storageState() {
        return createPaceLibraryState(this.curves, this.selectedCurveId);
    }

    backup(exportedAt = new Date().toISOString()): PaceCurveBackup & { exportedAt: string } {
        return {
            format: 'route-analyser-pace-curves',
            version: 1,
            exportedAt,
            selectedCurveId: this.selectedCurveId,
            curves: cloneCurves(this.curves),
        };
    }
}

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
