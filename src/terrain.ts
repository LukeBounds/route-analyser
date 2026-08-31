import { persistentRuns } from './core.js';

export type TerrainKind = 'climb' | 'descent' | 'flat' | 'rolling';

export interface TerrainPoint {
    d: number;
    ele: number | null;
}

export interface TerrainSection {
    k: TerrainKind;
    a: number;
    b: number;
    label?: string;
}

export interface PrimaryTerrainSection {
    k: TerrainKind;
    a: number;
    b: number;
    c: TerrainSection[];
}

export interface TerrainSettings {
    gradeThreshold: number;
    localGradientWindow: number;
    rollingWindow: number;
    minimumSection: number;
    flatRollingBridge: number;
    profileSmoothing: number;
    bridgeCounterSlopes: boolean;
    counterSlopeBridge: number;
    counterSlopeReversal: number;
}

export interface TerrainAnalysis {
    profile: number[];
    sections: TerrainSection[];
    primarySections: PrimaryTerrainSection[];
    totals: {
        up: number;
        down: number;
    };
}

function elevations(points: TerrainPoint[]): number[] {
    return points.map(point => {
        if (point.ele === null || !Number.isFinite(point.ele)) {
            throw new Error('Terrain analysis needs a complete elevation profile.');
        }
        return point.ele;
    });
}

function profileElevationAtDistance(points: TerrainPoint[], profile: number[], distance: number) {
    let low = 0;
    let high = points.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (points[middle].d <= distance)
            low = middle + 1;
        else
            high = middle;
    }
    const lower = Math.max(0, low - 1);
    const upper = Math.min(points.length - 1, low);
    if (lower === upper || points[upper].d <= points[lower].d)
        return profile[lower];
    const fraction = (distance - points[lower].d) / (points[upper].d - points[lower].d);
    return profile[lower] + (profile[upper] - profile[lower]) * Math.max(0, Math.min(1, fraction));
}

export function localGradeAtDistance(
    points: TerrainPoint[],
    profile: number[],
    distance: number,
    window = 50,
): number {
    if (!points.length || profile.length !== points.length || window <= 0) {
        return 0;
    }
    const startDistance = Math.max(points[0].d, distance - window / 2);
    const endDistance = Math.min(points.at(-1)!.d, distance + window / 2);
    const profileDistance = endDistance - startDistance;
    return profileDistance <= 0
        ? 0
        : (profileElevationAtDistance(points, profile, endDistance)
            - profileElevationAtDistance(points, profile, startDistance)) / profileDistance * 100;
}

function sectionLength(points: TerrainPoint[], section: TerrainSection): number {
    return points[section.b].d - points[section.a].d;
}

function sections(kinds: TerrainKind[]): TerrainSection[] {
    const output: TerrainSection[] = [];
    let start = 0;
    for (let index = 1; index <= kinds.length; index++) {
        if (index === kinds.length || kinds[index] !== kinds[start]) {
            output.push({ k: kinds[start], a: start, b: index });
            start = index;
        }
    }
    return output;
}

function coalesce(input: TerrainSection[]): TerrainSection[] {
    const output: TerrainSection[] = [];
    for (const section of input) {
        const previous = output.at(-1);
        if (previous && previous.k === section.k) {
            previous.b = section.b;
        }
        else {
            output.push({ ...section });
        }
    }
    return output;
}

export function smoothElevations(points: TerrainPoint[], smoothingDistance: number): number[] {
    const raw = elevations(points);
    let first = 0;
    let last = 0;
    let sum = 0;
    return points.map(point => {
        while (last < points.length && points[last].d <= point.d + smoothingDistance / 2) {
            sum += raw[last++];
        }
        while (first < points.length && points[first].d < point.d - smoothingDistance / 2) {
            sum -= raw[first++];
        }
        return sum / (last - first);
    });
}

export function elevationGainLoss(elevations: number[], startIndex = 0, endIndex = elevations.length - 1) {
    let up = 0;
    let down = 0;
    for (let index = startIndex + 1; index <= endIndex; index++) {
        const change = elevations[index] - elevations[index - 1];
        if (change > 0)
            up += change;
        else
            down -= change;
    }
    return { up, down };
}

function internalRolling(
    points: TerrainPoint[],
    kinds: TerrainKind[],
    profile: number[],
    window: number,
    threshold: number,
): TerrainKind[] {
    const output = [...kinds];
    const runs = sections(kinds);
    for (let start = 0; start < runs.length; start++) {
        let hasClimb = false;
        let hasDescent = false;
        for (let end = start; end < runs.length; end++) {
            hasClimb ||= runs[end].k === 'climb';
            hasDescent ||= runs[end].k === 'descent';
            const distance = points[runs[end].b].d - points[runs[start].a].d;
            if (distance > window) {
                break;
            }
            const grade = distance > 0
                ? (profile[runs[end].b] - profile[runs[start].a]) / distance * 100
                : 0;
            if (hasClimb && hasDescent && Math.abs(grade) < threshold) {
                for (let index = runs[start].a; index < runs[end].b; index++) {
                    output[index] = 'rolling';
                }
            }
        }
    }
    return output;
}

function mergeShortSections(
    points: TerrainPoint[],
    input: TerrainSection[],
    minimumLength: number,
): TerrainSection[] {
    let output = input.map(section => ({ ...section }));
    let changed = true;
    while (changed && output.length > 1) {
        changed = false;
        for (let index = 0; index < output.length; index++) {
            if (sectionLength(points, output[index]) >= minimumLength) {
                continue;
            }
            const target = index === 0
                ? 1
                : index === output.length - 1
                    ? index - 1
                    : sectionLength(points, output[index - 1]) >= sectionLength(points, output[index + 1])
                        ? index - 1
                        : index + 1;
            if (target < index) {
                output[target].b = output[index].b;
                output.splice(index, 1);
            }
            else {
                output[target].a = output[index].a;
                output.splice(index, 1);
            }
            output = coalesce(output);
            changed = true;
            break;
        }
    }
    return output;
}

function revalidateFlats(
    points: TerrainPoint[],
    rawElevations: number[],
    input: TerrainSection[],
    threshold: number,
): TerrainSection[] {
    const output = input.map(section => {
        if (section.k !== 'flat' && section.k !== 'rolling') {
            return section;
        }
        const distance = sectionLength(points, section);
        const grade = distance > 0
            ? (rawElevations[section.b] - rawElevations[section.a]) / distance * 100
            : 0;
        return Math.abs(grade) >= threshold
            ? { ...section, k: grade > 0 ? 'climb' as TerrainKind : 'descent' as TerrainKind }
            : section;
    });
    return coalesce(output);
}

function gradientSubsections(
    points: TerrainPoint[],
    rawElevations: number[],
    parent: PrimaryTerrainSection,
    profile: number[],
    localGradientWindow: number,
    threshold: number,
    minimumLength: number,
): TerrainSection[] {
    if (parent.c.length > 1) {
        return parent.c.flatMap(source => {
            if (source.k === 'flat' || source.k === 'rolling') {
                return [{ ...source, label: `sub-${source.k}` }];
            }
            const children = gradientSubsections(
                points,
                rawElevations,
                { k: source.k, a: source.a, b: source.b, c: [source] },
                profile,
                localGradientWindow,
                threshold,
                minimumLength,
            );
            return source.k === parent.k
                ? children
                : children.map(child => ({
                    ...child,
                    label: `bridged counter-slope ${child.label?.replace('sub-', '') ?? child.k}`,
                }));
        });
    }

    const band = (index: number) => {
        const midpoint = (points[index].d + points[index + 1].d) / 2;
        const grade = localGradeAtDistance(points, profile, midpoint, localGradientWindow);
        const amount = Math.abs(grade);
        if (amount < threshold) {
            return { kind: 'rolling' as TerrainKind, label: 'sub-rolling' };
        }
        const kind: TerrainKind = grade > 0 ? 'climb' : 'descent';
        const prefix = kind === 'climb' ? 'sub-climb' : 'sub-descent';
        if (amount < threshold + 3) {
            return { kind, label: `gentle ${prefix}` };
        }
        if (amount < threshold + 7) {
            return { kind, label: `moderate ${prefix}` };
        }
        return { kind, label: `steep ${prefix}` };
    };

    const candidates = Array.from(
        { length: Math.max(0, parent.b - parent.a) },
        (_, offset) => band(parent.a + offset),
    );
    const byLabel = new Map(candidates.map(candidate => [candidate.label, candidate]));
    const runs = persistentRuns(
        candidates.map(candidate => candidate.label),
        points.slice(parent.a, parent.b + 1).map(point => point.d),
        minimumLength,
    );
    const output: TerrainSection[] = runs.map(run => {
        const candidate = byLabel.get(run.value)!;
        return {
            k: candidate.kind,
            a: parent.a + run.a,
            b: parent.a + run.b,
            label: candidate.label,
        };
    });
    const labelled = output.map(section => {
        const distance = sectionLength(points, section);
        const grade = distance > 0
            ? (rawElevations[section.b] - rawElevations[section.a]) / distance * 100
            : 0;
        const amount = Math.abs(grade);
        if (amount < threshold) {
            return { ...section, k: 'rolling' as TerrainKind, label: 'sub-rolling' };
        }
        const kind: TerrainKind = grade > 0 ? 'climb' : 'descent';
        const prefix = kind === 'climb' ? 'sub-climb' : 'sub-descent';
        const level = amount < threshold + 3
            ? 'gentle'
            : amount < threshold + 7
                ? 'moderate'
                : 'steep';
        const label = kind === parent.k
            ? `${level} ${prefix}`
            : `local counter-slope ${level} ${kind}`;
        return { ...section, k: kind, label };
    });
    return labelled.reduce<TerrainSection[]>((all, section) => {
        const previous = all.at(-1);
        if (previous && previous.label === section.label) {
            previous.b = section.b;
        }
        else {
            all.push(section);
        }
        return all;
    }, []);
}

function primarySections(
    points: TerrainPoint[],
    rawElevations: number[],
    terrainSections: TerrainSection[],
    profile: number[],
    settings: TerrainSettings,
): PrimaryTerrainSection[] {
    const output: PrimaryTerrainSection[] = [];
    for (let index = 0; index < terrainSections.length;) {
        const section = terrainSections[index];
        if (section.k !== 'climb' && section.k !== 'descent') {
            output.push({ k: section.k, a: section.a, b: section.b, c: [section] });
            index++;
            continue;
        }

        const children = [section];
        let end = section.b;
        let nextIndex = index + 1;
        while (nextIndex + 1 < terrainSections.length && terrainSections[nextIndex + 1].k === section.k) {
            const middle = terrainSections[nextIndex];
            const next = terrainSections[nextIndex + 1];
            const opposite = middle.k === (section.k === 'climb' ? 'descent' : 'climb');
            const middleLength = sectionLength(points, middle);
            const shortFlatOrRolling = (middle.k === 'rolling' || middle.k === 'flat')
                && settings.flatRollingBridge > 0
                && middleLength <= settings.flatRollingBridge
                && middleLength <= Math.min(points[end].d - points[section.a].d, sectionLength(points, next)) * .25;
            const reversal = Math.abs(rawElevations[middle.b] - rawElevations[middle.a]);
            const surrounding = Math.abs(rawElevations[end] - rawElevations[section.a])
                + Math.abs(rawElevations[next.b] - rawElevations[next.a]);
            const shortCounterSlope = settings.bridgeCounterSlopes
                && opposite
                && settings.counterSlopeBridge > 0
                && middleLength <= settings.counterSlopeBridge
                && surrounding > 0
                && reversal / surrounding * 100 <= settings.counterSlopeReversal;
            if (!shortFlatOrRolling && !shortCounterSlope) {
                break;
            }
            children.push(middle, next);
            end = next.b;
            nextIndex += 2;
        }

        const parent: PrimaryTerrainSection = {
            k: section.k,
            a: section.a,
            b: end,
            c: children,
        };
        parent.c = gradientSubsections(
            points,
            rawElevations,
            parent,
            profile,
            settings.localGradientWindow,
            settings.gradeThreshold,
            settings.minimumSection,
        );
        output.push(parent);
        index = nextIndex;
    }
    return output;
}

export function analyseTerrain(points: TerrainPoint[], settings: TerrainSettings): TerrainAnalysis {
    if (points.length < 3) {
        throw new Error('Terrain analysis needs at least three route points.');
    }
    const rawElevations = elevations(points);
    const profile = smoothElevations(points, settings.profileSmoothing);
    const base = points.slice(0, -1).map((point, index): TerrainKind => {
        const midpoint = (point.d + points[index + 1].d) / 2;
        const grade = localGradeAtDistance(points, profile, midpoint, settings.localGradientWindow);
        return grade >= settings.gradeThreshold
            ? 'climb'
            : grade <= -settings.gradeThreshold
                ? 'descent'
                : 'flat';
    });

    let terrainSections = sections(internalRolling(
        points,
        base,
        profile,
        settings.rollingWindow,
        settings.gradeThreshold,
    ));
    terrainSections = mergeShortSections(points, terrainSections, settings.minimumSection);
    terrainSections = revalidateFlats(points, rawElevations, terrainSections, settings.gradeThreshold);

    const totals = elevationGainLoss(rawElevations);

    return {
        profile,
        sections: terrainSections,
        primarySections: primarySections(points, rawElevations, terrainSections, profile, settings),
        totals,
    };
}
