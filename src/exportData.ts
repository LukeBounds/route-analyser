import type { CsvValue } from './csv.js';
import type { PaceCurvePoint, RouteMatchQuality } from './core.js';
import {
    compareActivityTimes,
    interpolateActivityMovingTime,
    interpolateRouteCumulativeTime,
    type ActivityPoint,
} from './activity.js';
import type { RoutePoint } from './gpx.js';
import { createPaceInterpolator, type ResolvedPaceCurvePoint, type RoutePacePrediction } from './pace.js';
import { elevationGainLoss, type PrimaryTerrainSection } from './terrain.js';
import { waypointSegmentGeometry, type SnappedWaypoint } from './waypoints.js';

type SparseCell = [index: number, value: CsvValue];

function sparseRow(width: number, cells: SparseCell[]) {
    const row: CsvValue[] = Array(width).fill('');
    cells.forEach(([index, value]) => {
        if (value !== undefined && value !== null)
            row[index] = value;
    });
    return row;
}

function vamValue(elevationChange: number, seconds: number) {
    return seconds > 0 && Number.isFinite(elevationChange) ? elevationChange * 3600 / seconds : null;
}

function locateDistance(points: Array<{ d: number }>, distance: number) {
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        points[middle].d < distance ? low = middle + 1 : high = middle;
    }
    return low;
}

export const activityCsvHeader = [
    'record_type', 'section_number', 'start_name', 'end_name', 'start_distance_m', 'end_distance_m',
    'distance_m', 'elevation_change_m', 'predicted_moving_time_s', 'predicted_pace_s_per_km',
    'predicted_vam_m_per_h', 'predicted_cumulative_s', 'actual_moving_time_s', 'actual_pace_s_per_km',
    'actual_vam_m_per_h', 'actual_cumulative_s', 'actual_minus_predicted_s', 'match_median_error_m',
    'match_p90_error_m', 'match_within_150m_percent', 'match_ambiguous_samples', 'match_ambiguous_percent',
    'recording_gap_cutoff_s', 'stationary_rest_detection', 'minimum_moving_speed_kmh', 'pace_curve_name',
    'pace_curve_id',
];

export function buildActivityComparisonCsv(options: {
    route: RoutePoint[];
    profile: number[];
    sections: PrimaryTerrainSection[];
    waypoints: SnappedWaypoint[];
    activity: ActivityPoint[];
    prediction: RoutePacePrediction;
    matchQuality: RouteMatchQuality | null;
    movingSettings: {
        gapCutoffSeconds: number;
        detectStationaryRests: boolean;
        minimumMovingSpeedKmh: number;
    };
    paceCurveName: string;
    paceCurveId: string;
}): CsvValue[][] {
    const { route, profile, sections, waypoints, activity, prediction, matchQuality, movingSettings, paceCurveName, paceCurveId } = options;
    if (!activity.length)
        return [activityCsvHeader];
    const predictedAt = (distance: number) => interpolateRouteCumulativeTime(route, prediction.cumulative, distance);
    const actualAt = (distance: number) => interpolateActivityMovingTime(activity, distance);
    const rows: CsvValue[][] = [];
    const addComparison = (recordType: string, sectionNumber: string | number, startName: string, endName: string, from: number, to: number, change: number) => {
        const comparison = compareActivityTimes(from, to, predictedAt, actualAt);
        const distance = to - from;
        const predictedCumulative = predictedAt(to);
        const actualAtEnd = actualAt(to);
        const actualCumulative = actualAtEnd === null ? undefined : actualAtEnd - activity[0].moving;
        const summary = recordType === 'summary';
        rows.push([
            recordType, sectionNumber, startName, endName, from, to, distance, change,
            comparison?.expected,
            comparison && distance > 0 ? comparison.expected / (distance / 1000) : undefined,
            comparison ? vamValue(change, comparison.expected) : undefined,
            predictedCumulative,
            comparison?.actual,
            comparison && distance > 0 ? comparison.actual / (distance / 1000) : undefined,
            comparison ? vamValue(change, comparison.actual) : undefined,
            actualCumulative,
            comparison?.delta,
            summary ? matchQuality?.medianError : undefined,
            summary ? matchQuality?.p90Error : undefined,
            summary ? matchQuality?.within150m : undefined,
            summary ? matchQuality?.ambiguousSamples : undefined,
            summary ? matchQuality?.ambiguousPercent : undefined,
            summary ? movingSettings.gapCutoffSeconds : undefined,
            summary ? movingSettings.detectStationaryRests : undefined,
            summary ? movingSettings.minimumMovingSpeedKmh : undefined,
            paceCurveName,
            paceCurveId,
        ]);
    };
    const start = activity[0].routeD;
    const end = activity.at(-1)!.routeD;
    addComparison('summary', '', '', '', start, end, profile[locateDistance(route, end)] - profile[locateDistance(route, start)]);
    sections.forEach((section, index) => {
        const from = route[section.a].d;
        const to = route[section.b].d;
        addComparison('terrain_section', index + 1, '', '', from, to, route[section.b].ele! - route[section.a].ele!);
        section.c.forEach((child, childIndex) => addComparison(
            'terrain_subsection',
            `${index + 1}.${childIndex + 1}`,
            '',
            '',
            route[child.a].d,
            route[child.b].d,
            route[child.b].ele! - route[child.a].ele!,
        ));
    });
    waypoints.slice(1).forEach((endPoint, position) => {
        const startPoint = waypoints[position];
        const geometry = waypointSegmentGeometry(
            route,
            { index: startPoint.index, elevation: startPoint.waypoint.ele },
            { index: endPoint.index, elevation: endPoint.waypoint.ele },
        );
        addComparison(
            'waypoint_segment', '', startPoint.waypoint.name, endPoint.waypoint.name,
            route[startPoint.index].d, route[endPoint.index].d, geometry.elevationChange,
        );
    });
    return [activityCsvHeader, ...rows];
}

export const routeAnalysisCsvHeader = [
    'record_type', 'section_number', 'parent_section', 'section_type', 'section_label', 'start_name',
    'end_name', 'start_distance_m', 'end_distance_m', 'distance_m', 'elevation_change_m',
    'average_grade_percent', 'predicted_time_s', 'predicted_pace_s_per_km', 'predicted_vam_m_per_h',
    'cumulative_time_s', 'segment_average_time_s', 'segment_average_pace_s_per_km',
    'segment_average_vam_m_per_h', 'segment_average_cumulative_s', 'local_gradient_time_s',
    'local_gradient_pace_s_per_km', 'local_gradient_vam_m_per_h', 'local_gradient_cumulative_s',
    'setting', 'value', 'profile_elevation_gain_m', 'profile_elevation_loss_m',
];

export function buildRouteAnalysisCsv(options: {
    route: RoutePoint[];
    profileElevations: number[];
    sections: PrimaryTerrainSection[];
    totals: { up: number; down: number };
    prediction: RoutePacePrediction | null;
    sectionPredictionSeconds?: number[];
    predictedTotalSeconds?: number;
    waypoints: SnappedWaypoint[];
    rawPacePoints: PaceCurvePoint[];
    resolvedPacePoints: ResolvedPaceCurvePoint[];
    paceCurveName: string;
    paceCurveId: string;
    settings: Array<[name: string, value: CsvValue]>;
}): CsvValue[][] {
    const {
        route, profileElevations, sections, totals, prediction, sectionPredictionSeconds, predictedTotalSeconds, waypoints,
        rawPacePoints, resolvedPacePoints, paceCurveName, paceCurveId, settings,
    } = options;
    const rows: CsvValue[][] = [];
    const add = (cells: SparseCell[]) => rows.push(sparseRow(routeAnalysisCsvHeader.length, cells));
    const exportSettings: Array<[string, CsvValue]> = [
        ['route_distance_m', route.at(-1)?.d ?? 0],
        ['raw_elevation_gain_m', totals.up],
        ['raw_elevation_loss_m', totals.down],
        ['profile_total_elevation_gain_m', elevationGainLoss(profileElevations).up],
        ['profile_total_elevation_loss_m', elevationGainLoss(profileElevations).down],
        ['predicted_route_time_s', predictedTotalSeconds ?? ''],
        ['selected_pace_curve_name', paceCurveName],
        ['selected_pace_curve_id', paceCurveId],
        ...settings,
    ];
    exportSettings.forEach(([key, value]) => add([[0, 'setting'], [24, key], [25, value]]));
    rawPacePoints.forEach(point => add([[0, 'pace_curve_point'], [24, paceCurveName], [25, `grade=${point.grade}; value=${point.pace}`]]));
    let cumulative = 0;
    sections.forEach((section, index) => {
        const start = route[section.a];
        const end = route[section.b];
        const distance = end.d - start.d;
        const change = end.ele! - start.ele!;
        const profileElevation = elevationGainLoss(profileElevations, section.a, section.b);
        const seconds = prediction
            ? prediction.cumulative[section.b] - prediction.cumulative[section.a]
            : sectionPredictionSeconds?.[index];
        if (seconds !== undefined)
            cumulative += seconds;
        add([
            [0, 'terrain_section'], [1, index + 1], [3, section.k], [4, section.k], [7, start.d],
            [8, end.d], [9, distance], [10, change], [11, distance > 0 ? change / distance * 100 : undefined],
            [12, seconds], [13, seconds === undefined || distance <= 0 ? undefined : seconds / (distance / 1000)],
            [14, seconds === undefined ? undefined : vamValue(change, seconds)],
            [15, seconds === undefined ? undefined : cumulative],
            [26, profileElevation.up], [27, profileElevation.down],
        ]);
        section.c.forEach((child, childIndex) => {
            const childStart = route[child.a];
            const childEnd = route[child.b];
            const childDistance = childEnd.d - childStart.d;
            const childChange = childEnd.ele! - childStart.ele!;
            const childProfileElevation = elevationGainLoss(profileElevations, child.a, child.b);
            const childSeconds = prediction ? prediction.cumulative[child.b] - prediction.cumulative[child.a] : undefined;
            add([
                [0, 'terrain_subsection'], [1, `${index + 1}.${childIndex + 1}`], [2, index + 1], [3, child.k],
                [4, child.label], [7, childStart.d], [8, childEnd.d], [9, childDistance], [10, childChange],
                [11, childDistance > 0 ? childChange / childDistance * 100 : undefined], [12, childSeconds],
                [13, childSeconds === undefined || childDistance <= 0 ? undefined : childSeconds / (childDistance / 1000)],
                [14, childSeconds === undefined ? undefined : vamValue(childChange, childSeconds)],
                [15, prediction?.cumulative[child.b]],
                [26, childProfileElevation.up], [27, childProfileElevation.down],
            ]);
        });
    });
    waypoints.forEach(({ waypoint, index }) => {
        const point = route[index];
        add([[0, 'waypoint'], [5, waypoint.name], [7, point.d], [9, 0], [10, waypoint.ele ?? point.ele!]]);
    });
    const paceAt = resolvedPacePoints.length >= 2 ? createPaceInterpolator(resolvedPacePoints) : null;
    let averageCumulative = 0;
    let detailedCumulative = 0;
    waypoints.slice(1).forEach((end, position) => {
        const start = waypoints[position];
        const geometry = waypointSegmentGeometry(
            route,
            { index: start.index, elevation: start.waypoint.ele },
            { index: end.index, elevation: end.waypoint.ele },
        );
        let averageSeconds: number | undefined;
        let detailedSeconds: number | undefined;
        if (geometry.distance > 0 && paceAt && prediction) {
            averageSeconds = geometry.distance / 1000 * paceAt(geometry.averageGrade);
            detailedSeconds = prediction.cumulative[end.index] - prediction.cumulative[start.index];
            averageCumulative += averageSeconds;
            detailedCumulative += detailedSeconds;
        }
        add([
            [0, 'waypoint_segment'], [5, start.waypoint.name], [6, end.waypoint.name],
            [7, route[start.index].d], [8, route[end.index].d], [9, geometry.distance],
            [10, geometry.elevationChange], [11, geometry.distance > 0 ? geometry.averageGrade : undefined],
            [16, averageSeconds],
            [17, averageSeconds === undefined || geometry.distance <= 0 ? undefined : averageSeconds / (geometry.distance / 1000)],
            [18, averageSeconds === undefined ? undefined : vamValue(geometry.elevationChange, averageSeconds)],
            [19, averageSeconds === undefined ? undefined : averageCumulative], [20, detailedSeconds],
            [21, detailedSeconds === undefined || geometry.distance <= 0 ? undefined : detailedSeconds / (geometry.distance / 1000)],
            [22, detailedSeconds === undefined ? undefined : vamValue(geometry.elevationChange, detailedSeconds)],
            [23, detailedSeconds === undefined ? undefined : detailedCumulative],
        ]);
    });
    return [routeAnalysisCsvHeader, ...rows];
}
