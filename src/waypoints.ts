import type { TerrainPoint } from './terrain.js';

export interface WaypointAnchor {
    index: number;
    elevation: number | null;
}

export interface WaypointSegmentGeometry {
    distance: number;
    elevationChange: number;
    averageGrade: number;
}

function anchorElevation(points: TerrainPoint[], anchor: WaypointAnchor): number {
    const point = points[anchor.index];
    if (!point) {
        throw new Error('A waypoint is outside the analysed route.');
    }
    const elevation = anchor.elevation ?? point.ele;
    if (elevation === null || !Number.isFinite(elevation)) {
        throw new Error('Waypoint segment analysis needs endpoint elevations.');
    }
    return elevation;
}

export function waypointSegmentGeometry(
    points: TerrainPoint[],
    start: WaypointAnchor,
    end: WaypointAnchor,
): WaypointSegmentGeometry {
    const startPoint = points[start.index];
    const endPoint = points[end.index];
    if (!startPoint || !endPoint) {
        throw new Error('A waypoint is outside the analysed route.');
    }
    const distance = endPoint.d - startPoint.d;
    const elevationChange = anchorElevation(points, end) - anchorElevation(points, start);
    return {
        distance,
        elevationChange,
        averageGrade: distance > 0 ? elevationChange / distance * 100 : 0,
    };
}
