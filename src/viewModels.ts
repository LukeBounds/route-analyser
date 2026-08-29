import type { RoutePacePrediction } from './pace.js';
import type { PrimaryTerrainSection, TerrainKind, TerrainSection } from './terrain.js';
import { waypointSegmentGeometry } from './waypoints.js';

export type ViewPoint = {
    d: number;
    ele: number | null;
};

export type PaceMetricsViewModel = {
    seconds: number;
    paceSecondsPerKm: number | null;
    vamMetersPerHour: number | null;
    cumulativeSeconds: number;
};

export type ActualMetricsViewModel = PaceMetricsViewModel & {
    differenceSeconds: number;
};

export type ActivityComparisonValue = {
    expected: number;
    actual: number;
    delta: number;
};

export type ActivityViewAccessor = {
    compare: (from: number, to: number) => ActivityComparisonValue | null;
    cumulativeAt: (distance: number) => number | null;
};

export type TerrainRowViewModel = {
    number: string;
    primaryIndex: number;
    child: boolean;
    hasChildren: boolean;
    kind: TerrainKind;
    label: string;
    startDistance: number;
    endDistance: number;
    distance: number;
    elevationChange: number;
    averageGrade: number | null;
    predicted: PaceMetricsViewModel | null;
    actual: ActualMetricsViewModel | null;
};

export type RouteSummaryItemViewModel = {
    kind: TerrainKind;
    distance: number;
    averageGrade: number | null;
};

export type RouteViewModel = {
    terrain: RouteSummaryItemViewModel[];
    totalAscent: number;
    totalDescent: number;
    predictedSeconds: number | null;
};

export type ActivityComparisonViewModel = {
    curveName: string;
    expectedSeconds: number;
    actualSeconds: number;
    differenceSeconds: number;
    elapsedSeconds: number;
    distance: number;
    coveragePercent: number;
    qualityText: string;
    guidanceHtml: string;
};

export type WaypointViewModel = {
    name: string;
    index: number;
    elevation: number | null;
};

export type WaypointSegmentRowViewModel = {
    startName: string;
    endName: string;
    startDistance: number;
    endDistance: number;
    distance: number;
    elevationChange: number;
    averageGrade: number;
    segmentAverage: PaceMetricsViewModel | null;
    localGradient: PaceMetricsViewModel | null;
    actual: ActualMetricsViewModel | null;
};

export type WaypointDirectionSummaryViewModel = {
    direction: 'ascent' | 'descent';
    distance: number;
    elevationChange: number;
    averageGrade: number | null;
    segmentAverageSeconds: number;
    localGradientSeconds: number;
};

export type WaypointSegmentsViewModel = {
    rows: WaypointSegmentRowViewModel[];
    summaries: [WaypointDirectionSummaryViewModel, WaypointDirectionSummaryViewModel];
    segmentAverageTotalSeconds: number;
    localGradientTotalSeconds: number;
};

function elevation(points: ViewPoint[], index: number) {
    const value = points[index]?.ele;
    if (value === null || value === undefined)
        throw Error('A rendered route point is missing elevation.');
    return value;
}

function paceMetrics(distance: number, elevationChange: number, seconds: number, cumulativeSeconds: number): PaceMetricsViewModel {
    return {
        seconds,
        paceSecondsPerKm: distance > 0 ? seconds / (distance / 1000) : null,
        vamMetersPerHour: seconds > 0 ? elevationChange * 3600 / seconds : null,
        cumulativeSeconds,
    };
}

function actualMetrics(
    distance: number,
    elevationChange: number,
    comparison: ActivityComparisonValue | null,
    cumulativeSeconds: number | null,
): ActualMetricsViewModel | null {
    if (!comparison || cumulativeSeconds === null)
        return null;
    return {
        ...paceMetrics(distance, elevationChange, comparison.actual, cumulativeSeconds),
        differenceSeconds: comparison.delta,
    };
}

function terrainRow(
    points: ViewPoint[],
    section: TerrainSection,
    number: string,
    primaryIndex: number,
    child: boolean,
    hasChildren: boolean,
    prediction?: RoutePacePrediction | null,
    activity?: ActivityViewAccessor | null,
): TerrainRowViewModel {
    const startDistance = points[section.a].d;
    const endDistance = points[section.b].d;
    const distance = endDistance - startDistance;
    const elevationChange = elevation(points, section.b) - elevation(points, section.a);
    const predictedSeconds = prediction
        ? prediction.cumulative[section.b] - prediction.cumulative[section.a]
        : null;
    const comparison = activity?.compare(startDistance, endDistance) ?? null;
    return {
        number,
        primaryIndex,
        child,
        hasChildren,
        kind: section.k,
        label: section.label ?? section.k,
        startDistance,
        endDistance,
        distance,
        elevationChange,
        averageGrade: distance > 0 ? elevationChange / distance * 100 : null,
        predicted: predictedSeconds === null || !prediction
            ? null
            : paceMetrics(distance, elevationChange, predictedSeconds, prediction.cumulative[section.b]),
        actual: activity
            ? actualMetrics(distance, elevationChange, comparison, activity.cumulativeAt(endDistance))
            : null,
    };
}

export function createTerrainRows(
    points: ViewPoint[],
    sections: PrimaryTerrainSection[],
    prediction?: RoutePacePrediction | null,
    activity?: ActivityViewAccessor | null,
): TerrainRowViewModel[] {
    return sections.flatMap((section, primaryIndex) => {
        const parent = terrainRow(
            points,
            section,
            String(primaryIndex + 1),
            primaryIndex,
            false,
            (section.k === 'climb' || section.k === 'descent') && section.c.length > 0,
            prediction,
            activity,
        );
        const children = section.k === 'climb' || section.k === 'descent'
            ? section.c.map((child, childIndex) => terrainRow(
                points,
                child,
                `${primaryIndex + 1}.${childIndex + 1}`,
                primaryIndex,
                true,
                false,
                prediction,
                activity,
            ))
            : [];
        return [parent, ...children];
    });
}

export function createRouteViewModel(
    points: ViewPoint[],
    sections: TerrainSection[],
    totals: { up: number; down: number },
    predictedSeconds: number | null,
): RouteViewModel {
    const terrain = (['climb', 'descent', 'flat', 'rolling'] as TerrainKind[]).map(kind => {
        let distance = 0;
        let elevationChange = 0;
        sections.filter(section => section.k === kind).forEach(section => {
            const sectionDistance = points[section.b].d - points[section.a].d;
            distance += sectionDistance;
            elevationChange += elevation(points, section.b) - elevation(points, section.a);
        });
        return {
            kind,
            distance,
            averageGrade: distance > 0 && (kind === 'climb' || kind === 'descent')
                ? elevationChange / distance * 100
                : null,
        };
    });
    return {
        terrain,
        totalAscent: totals.up,
        totalDescent: totals.down,
        predictedSeconds,
    };
}

export function createWaypointSegmentRows(
    points: ViewPoint[],
    waypoints: WaypointViewModel[],
    paceAtGrade?: ((grade: number) => number) | null,
    prediction?: RoutePacePrediction | null,
    activity?: ActivityViewAccessor | null,
): WaypointSegmentsViewModel {
    let segmentAverageCumulative = 0;
    let localGradientCumulative = 0;
    const summaries: WaypointSegmentsViewModel['summaries'] = [
        { direction: 'ascent', distance: 0, elevationChange: 0, averageGrade: null, segmentAverageSeconds: 0, localGradientSeconds: 0 },
        { direction: 'descent', distance: 0, elevationChange: 0, averageGrade: null, segmentAverageSeconds: 0, localGradientSeconds: 0 },
    ];

    const rows = waypoints.slice(1).flatMap((end, position) => {
        const start = waypoints[position];
        const geometry = waypointSegmentGeometry(
            points,
            { index: start.index, elevation: start.elevation },
            { index: end.index, elevation: end.elevation },
        );
        if (geometry.distance <= 0)
            return [];

        const direction = geometry.elevationChange > 0 ? summaries[0] : geometry.elevationChange < 0 ? summaries[1] : null;
        if (direction) {
            direction.distance += geometry.distance;
            direction.elevationChange += geometry.elevationChange;
        }

        let segmentAverage: PaceMetricsViewModel | null = null;
        let localGradient: PaceMetricsViewModel | null = null;
        if (paceAtGrade && prediction) {
            const segmentAverageSeconds = geometry.distance / 1000 * paceAtGrade(geometry.averageGrade);
            const localGradientSeconds = prediction.cumulative[end.index] - prediction.cumulative[start.index];
            segmentAverageCumulative += segmentAverageSeconds;
            localGradientCumulative += localGradientSeconds;
            segmentAverage = paceMetrics(geometry.distance, geometry.elevationChange, segmentAverageSeconds, segmentAverageCumulative);
            localGradient = paceMetrics(geometry.distance, geometry.elevationChange, localGradientSeconds, localGradientCumulative);
            if (direction) {
                direction.segmentAverageSeconds += segmentAverageSeconds;
                direction.localGradientSeconds += localGradientSeconds;
            }
        }

        const startDistance = points[start.index].d;
        const endDistance = points[end.index].d;
        const comparison = activity?.compare(startDistance, endDistance) ?? null;
        return [{
            startName: start.name,
            endName: end.name,
            startDistance,
            endDistance,
            distance: geometry.distance,
            elevationChange: geometry.elevationChange,
            averageGrade: geometry.averageGrade,
            segmentAverage,
            localGradient,
            actual: activity
                ? actualMetrics(geometry.distance, geometry.elevationChange, comparison, activity.cumulativeAt(endDistance))
                : null,
        }];
    });

    summaries.forEach(summary => {
        summary.averageGrade = summary.distance > 0
            ? summary.elevationChange / summary.distance * 100
            : null;
    });

    return {
        rows,
        summaries,
        segmentAverageTotalSeconds: segmentAverageCumulative,
        localGradientTotalSeconds: localGradientCumulative,
    };
}
