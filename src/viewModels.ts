import type { RoutePacePrediction } from './pace.js';
import { elevationGainLoss, type PrimaryTerrainSection, type TerrainKind, type TerrainSection } from './terrain.js';
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
    profileElevationGain: number;
    profileElevationLoss: number;
    averageGrade: number | null;
    predicted: PaceMetricsViewModel | null;
    actual: ActualMetricsViewModel | null;
};

export type TerrainAggregateViewModel = {
    distance: number;
    elevationChange: number;
    profileElevationGain: number;
    profileElevationLoss: number;
    averageGrade: number | null;
    predictedSeconds: number | null;
    actualSeconds: number | null;
    actualDifferenceSeconds: number | null;
};

export type TerrainSummaryViewModel = {
    byKind: Record<TerrainKind, TerrainAggregateViewModel>;
    overall: TerrainAggregateViewModel;
};

export type RouteSummaryItemViewModel = {
    kind: TerrainKind;
    distance: number;
    averageGrade: number | null;
};

export type RouteViewModel = {
    terrain: RouteSummaryItemViewModel[];
    profileElevationGain: number;
    profileElevationLoss: number;
    sectionElevationGain: number;
    sectionElevationLoss: number;
    rawElevationGain: number;
    rawElevationLoss: number;
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
    actualSeconds: number | null;
};

export type WaypointOverallSummaryViewModel = Omit<WaypointDirectionSummaryViewModel, 'direction' | 'actualSeconds'>;

export type WaypointSegmentsViewModel = {
    rows: WaypointSegmentRowViewModel[];
    summaries: [WaypointDirectionSummaryViewModel, WaypointDirectionSummaryViewModel];
    overall: WaypointOverallSummaryViewModel;
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
    profileElevations: number[],
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
    const profileElevation = elevationGainLoss(profileElevations, section.a, section.b);
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
        profileElevationGain: profileElevation.up,
        profileElevationLoss: profileElevation.down,
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
    profileElevations?: number[] | null,
): TerrainRowViewModel[] {
    const elevations = profileElevations ?? points.map((_, index) => elevation(points, index));
    return sections.flatMap((section, primaryIndex) => {
        const parent = terrainRow(
            points,
            elevations,
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
                elevations,
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

function aggregateTerrainRows(rows: TerrainRowViewModel[]): TerrainAggregateViewModel {
    const distance = rows.reduce((total, row) => total + row.distance, 0);
    const elevationChange = rows.reduce((total, row) => total + row.elevationChange, 0);
    const profileElevationGain = rows.reduce((total, row) => total + row.profileElevationGain, 0);
    const profileElevationLoss = rows.reduce((total, row) => total + row.profileElevationLoss, 0);
    const completePrediction = rows.length > 0 && rows.every(row => row.predicted !== null);
    const completeActivity = rows.length > 0 && rows.every(row => row.actual !== null);
    return {
        distance,
        elevationChange,
        profileElevationGain,
        profileElevationLoss,
        averageGrade: distance > 0 ? elevationChange / distance * 100 : null,
        predictedSeconds: completePrediction ? rows.reduce((total, row) => total + row.predicted!.seconds, 0) : null,
        actualSeconds: completeActivity ? rows.reduce((total, row) => total + row.actual!.seconds, 0) : null,
        actualDifferenceSeconds: completeActivity ? rows.reduce((total, row) => total + row.actual!.differenceSeconds, 0) : null,
    };
}

export function createTerrainSummary(rows: TerrainRowViewModel[]): TerrainSummaryViewModel {
    const leafRows = rows.filter(row => row.child || !row.hasChildren);
    return {
        byKind: {
            climb: aggregateTerrainRows(leafRows.filter(row => row.kind === 'climb')),
            descent: aggregateTerrainRows(leafRows.filter(row => row.kind === 'descent')),
            flat: aggregateTerrainRows(leafRows.filter(row => row.kind === 'flat')),
            rolling: aggregateTerrainRows(leafRows.filter(row => row.kind === 'rolling')),
        },
        overall: aggregateTerrainRows(leafRows),
    };
}

export function createRouteViewModel(
    points: ViewPoint[],
    sections: PrimaryTerrainSection[],
    totals: { up: number; down: number },
    predictedSeconds: number | null,
    profileElevations?: number[] | null,
): RouteViewModel {
    const leafSections = sections.flatMap(section => section.c.length ? section.c : [section]);
    const profileTotals = elevationGainLoss(profileElevations ?? points.map((_, index) => elevation(points, index)));
    const sectionTotals = leafSections.reduce((total, section) => {
        const change = elevation(points, section.b) - elevation(points, section.a);
        if (change > 0)
            total.up += change;
        else
            total.down -= change;
        return total;
    }, { up: 0, down: 0 });
    const terrain = (['climb', 'descent', 'rolling', 'flat'] as TerrainKind[]).map(kind => {
        let distance = 0;
        let elevationChange = 0;
        leafSections.filter(section => section.k === kind).forEach(section => {
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
        profileElevationGain: profileTotals.up,
        profileElevationLoss: profileTotals.down,
        sectionElevationGain: sectionTotals.up,
        sectionElevationLoss: sectionTotals.down,
        rawElevationGain: totals.up,
        rawElevationLoss: totals.down,
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
        { direction: 'ascent', distance: 0, elevationChange: 0, averageGrade: null, segmentAverageSeconds: 0, localGradientSeconds: 0, actualSeconds: null },
        { direction: 'descent', distance: 0, elevationChange: 0, averageGrade: null, segmentAverageSeconds: 0, localGradientSeconds: 0, actualSeconds: null },
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
        const actual = activity
            ? actualMetrics(geometry.distance, geometry.elevationChange, comparison, activity.cumulativeAt(endDistance))
            : null;
        if (direction && actual)
            direction.actualSeconds = (direction.actualSeconds ?? 0) + actual.seconds;
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
            actual,
        }];
    });

    summaries.forEach(summary => {
        summary.averageGrade = summary.distance > 0
            ? summary.elevationChange / summary.distance * 100
            : null;
    });
    const overallDistance = rows.reduce((total, row) => total + row.distance, 0);
    const overallElevationChange = rows.reduce((total, row) => total + row.elevationChange, 0);

    return {
        rows,
        summaries,
        overall: {
            distance: overallDistance,
            elevationChange: overallElevationChange,
            averageGrade: overallDistance > 0 ? overallElevationChange / overallDistance * 100 : null,
            segmentAverageSeconds: segmentAverageCumulative,
            localGradientSeconds: localGradientCumulative,
        },
        segmentAverageTotalSeconds: segmentAverageCumulative,
        localGradientTotalSeconds: localGradientCumulative,
    };
}
