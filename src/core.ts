export interface GeoPoint {
    lat: number;
    lon: number;
}

export interface DistancePoint extends GeoPoint {
    d: number;
    segment: number;
    breakBefore: boolean;
}

export interface RouteMatchQuality {
    orientation: 'forward' | 'reverse';
    medianError: number;
    p90Error: number;
    maxError: number;
    within150m: number;
    progress: number;
}

export interface RouteMatch {
    indices: number[];
    errors: number[];
    quality: RouteMatchQuality;
}

export interface PersistentRun<T> {
    value: T;
    a: number;
    b: number;
}

export interface PaceCurvePoint {
    grade: number;
    pace: string;
}

export interface StoredPaceCurve {
    id: string;
    name: string;
    points: PaceCurvePoint[];
}

export interface PaceCurveBackup {
    format: 'route-analyser-pace-curves';
    version: 1;
    exportedAt?: string;
    selectedCurveId?: string;
    curves: StoredPaceCurve[];
}

export function isPaceCurvePoint(value: unknown): value is PaceCurvePoint {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<PaceCurvePoint>;
    return Number.isFinite(candidate.grade) && typeof candidate.pace === 'string' && candidate.pace.length <= 100;
}

export function isStoredPaceCurve(value: unknown): value is StoredPaceCurve {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<StoredPaceCurve>;
    return typeof candidate.id === 'string'
        && candidate.id.length > 0
        && candidate.id.length <= 200
        && typeof candidate.name === 'string'
        && candidate.name.trim().length > 0
        && candidate.name.length <= 80
        && Array.isArray(candidate.points)
        && candidate.points.length <= 1000
        && candidate.points.every(isPaceCurvePoint);
}

export function parsePaceCurveBackup(value: unknown): PaceCurveBackup | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as Partial<PaceCurveBackup>;
    if (candidate.format !== 'route-analyser-pace-curves'
        || candidate.version !== 1
        || !Array.isArray(candidate.curves)
        || !candidate.curves.length
        || !candidate.curves.every(isStoredPaceCurve)
        || (candidate.selectedCurveId !== undefined && typeof candidate.selectedCurveId !== 'string')) {
        return null;
    }
    return candidate as PaceCurveBackup;
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[character]!));
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
    const radians = Math.PI / 180;
    const latitude = (b.lat - a.lat) * radians;
    const longitude = (b.lon - a.lon) * radians;
    const value = Math.sin(latitude / 2) ** 2
        + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitude / 2) ** 2;
    return 12_742_000 * Math.asin(Math.sqrt(value));
}

export function pathDistance(points: GeoPoint[]): number {
    let distance = 0;
    for (let index = 1; index < points.length; index++) {
        distance += haversineMeters(points[index - 1], points[index]);
    }
    return distance;
}

export function joinNearbySegments<T extends GeoPoint>(segments: T[][], maximumGap = 100): T[][] {
    const chains: T[][] = [];
    for (const segment of segments.filter(candidate => candidate.length)) {
        const previous = chains.at(-1);
        if (!previous || haversineMeters(previous.at(-1)!, segment[0]) > maximumGap) {
            chains.push([...segment]);
            continue;
        }
        const duplicateBoundary = haversineMeters(previous.at(-1)!, segment[0]) < 0.01;
        previous.push(...segment.slice(duplicateBoundary ? 1 : 0));
    }
    return chains;
}

export function selectLongestRouteChain<T extends GeoPoint>(sources: T[][][], maximumGap = 100): {
    points: T[];
    discardedChains: number;
} {
    const chains = sources.flatMap(segments => joinNearbySegments(segments, maximumGap));
    const ranked = chains
        .map(points => ({ points, distance: pathDistance(points) }))
        .sort((a, b) => b.distance - a.distance || b.points.length - a.points.length);
    return {
        points: ranked[0]?.points ?? [],
        discardedChains: Math.max(0, ranked.length - 1),
    };
}

export function accumulateSegments<T extends GeoPoint>(segments: T[][]): Array<T & DistancePoint> {
    const output: Array<T & DistancePoint> = [];
    let distance = 0;
    segments.forEach((segment, segmentIndex) => {
        segment.forEach((point, pointIndex) => {
            if (pointIndex) {
                distance += haversineMeters(segment[pointIndex - 1], point);
            }
            output.push({
                ...point,
                d: distance,
                segment: segmentIndex,
                breakBefore: segmentIndex > 0 && pointIndex === 0,
            });
        });
    });
    return output;
}

export function formatPace(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '—';
    }
    const rounded = Math.round(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '—';
    }
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function persistentRuns<T>(values: T[], positions: number[], minimumLength: number): PersistentRun<T>[] {
    if (!values.length) {
        return [];
    }
    if (positions.length !== values.length + 1) {
        throw new Error('Persistent runs need one more boundary than value.');
    }
    const runs: PersistentRun<T>[] = [];
    let start = 0;
    for (let index = 1; index <= values.length; index++) {
        if (index === values.length || values[index] !== values[start]) {
            runs.push({ value: values[start], a: start, b: index });
            start = index;
        }
    }
    const length = (run: PersistentRun<T>) => positions[run.b] - positions[run.a];
    const coalesce = () => {
        for (let index = 1; index < runs.length;) {
            if (runs[index - 1].value === runs[index].value) {
                runs[index - 1].b = runs[index].b;
                runs.splice(index, 1);
            }
            else {
                index++;
            }
        }
    };
    while (runs.length > 1) {
        const shortIndex = runs.findIndex(run => length(run) < minimumLength);
        if (shortIndex < 0) {
            break;
        }
        if (shortIndex === 0) {
            runs[1].a = runs[0].a;
            runs.splice(0, 1);
        }
        else {
            runs[shortIndex - 1].b = runs[shortIndex].b;
            runs.splice(shortIndex, 1);
        }
        coalesce();
    }
    return runs;
}

function percentile(values: number[], fraction: number): number {
    if (!values.length) {
        return Infinity;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

class RouteGrid {
    private readonly cells = new Map<string, number[]>();
    private readonly cellSize = 0.002;

    constructor(private readonly route: GeoPoint[]) {
        route.forEach((point, index) => {
            const key = this.key(point.lat, point.lon);
            const values = this.cells.get(key) ?? [];
            values.push(index);
            this.cells.set(key, values);
        });
    }

    nearest(point: GeoPoint): { index: number; distance: number } {
        const candidates = this.nearbyIndexes(point);
        if (candidates.length)
            return nearestFromIndexes(this.route, point, candidates);
        const stride = Math.max(1, Math.ceil(this.route.length / 1000));
        const coarse = Array.from({ length: Math.ceil(this.route.length / stride) }, (_, offset) => Math.min(this.route.length - 1, offset * stride));
        const approximate = nearestFromIndexes(this.route, point, coarse).index;
        const from = Math.max(0, approximate - stride * 2), to = Math.min(this.route.length - 1, approximate + stride * 2);
        return nearestFromIndexes(this.route, point, Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
    }

    nearestInRange(point: GeoPoint, from: number, to: number): { index: number; distance: number } {
        const nearby = this.nearbyIndexes(point).filter(index => index >= from && index <= to);
        const candidates = nearby.length
            ? nearby
            : Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => from + offset);
        return nearestFromIndexes(this.route, point, candidates);
    }

    private nearbyIndexes(point: GeoPoint): number[] {
        const latitude = Math.floor(point.lat / this.cellSize);
        const longitude = Math.floor(point.lon / this.cellSize);
        const candidates: number[] = [];
        for (let y = latitude - 2; y <= latitude + 2; y++) {
            for (let x = longitude - 2; x <= longitude + 2; x++) {
                candidates.push(...(this.cells.get(`${y}:${x}`) ?? []));
            }
        }
        return candidates;
    }

    private key(latitude: number, longitude: number): string {
        return `${Math.floor(latitude / this.cellSize)}:${Math.floor(longitude / this.cellSize)}`;
    }
}

function nearestFromIndexes(route: GeoPoint[], point: GeoPoint, indexes: number[]): { index: number; distance: number } {
    let bestIndex = indexes[0] ?? 0;
    let bestDistance = Infinity;
    for (const index of indexes) {
        const distance = haversineMeters(point, route[index]);
        if (distance < bestDistance) {
            bestIndex = index;
            bestDistance = distance;
        }
    }
    return { index: bestIndex, distance: bestDistance };
}

function matchDirection(route: Array<GeoPoint & { d: number }>, samples: GeoPoint[], direction: 1 | -1, grid: RouteGrid): RouteMatch {
    let previous = grid.nearest(samples[0]).index;
    const indices: number[] = [];
    const errors: number[] = [];
    for (const sample of samples) {
        const from = direction === 1 ? Math.max(previous, previous - 20) : Math.max(0, previous - 450);
        const to = direction === 1 ? Math.min(route.length - 1, previous + 450) : Math.min(route.length - 1, previous + 20);
        const constrainedFrom = direction === 1 ? previous : from, constrainedTo = direction === 1 ? to : previous;
        let match = grid.nearestInRange(sample, constrainedFrom, constrainedTo);
        if (match.distance > 150) {
            const global = grid.nearest(sample);
            const progresses = direction === 1 ? global.index >= previous : global.index <= previous;
            if (progresses) {
                match = global;
            }
        }
        previous = direction === 1 ? Math.max(previous, match.index) : Math.min(previous, match.index);
        const error = haversineMeters(sample, route[previous]);
        indices.push(previous);
        errors.push(error);
    }
    const progress = indices.length < 2 ? 0 : Math.abs(route[indices.at(-1)!].d - route[indices[0]].d);
    const quality: RouteMatchQuality = {
        orientation: direction === 1 ? 'forward' : 'reverse',
        medianError: percentile(errors, 0.5),
        p90Error: percentile(errors, 0.9),
        maxError: Math.max(...errors),
        within150m: errors.filter(error => error <= 150).length / Math.max(1, errors.length) * 100,
        progress,
    };
    return { indices, errors, quality };
}

export function matchRouteSamples(route: Array<GeoPoint & { d: number }>, samples: GeoPoint[]): RouteMatch {
    if (!route.length || !samples.length) {
        throw new Error('Route matching needs route and activity points.');
    }
    const grid = new RouteGrid(route);
    const forward = matchDirection(route, samples, 1, grid);
    const reverse = matchDirection(route, samples, -1, grid);
    const score = (match: RouteMatch) => match.quality.medianError
        + match.quality.p90Error * 0.5
        + (match.quality.progress < 50 ? 1_000 : 0);
    return score(reverse) + 10 < score(forward) ? reverse : forward;
}

export function isConfidentRouteMatch(quality: RouteMatchQuality): boolean {
    return quality.orientation === 'forward'
        && quality.within150m >= 80
        && quality.medianError <= 75
        && quality.p90Error <= 200
        && quality.progress >= 50;
}
