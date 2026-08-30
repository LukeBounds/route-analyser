import type { TerrainPoint } from './terrain.js';
import { haversineMeters } from './core.js';

export interface NamedGeoWaypoint {
    name: string;
    lat: number;
    lon: number;
    ele: number | null;
}

export interface WaypointRoutePoint extends TerrainPoint {
    lat: number;
    lon: number;
}

export interface SnappedWaypoint {
    waypoint: NamedGeoWaypoint;
    index: number;
}

export interface SnappedWaypoints {
    points: SnappedWaypoint[];
    ignoredNames: string[];
}

export function snapNamedWaypoints(
    route: WaypointRoutePoint[],
    waypoints: NamedGeoWaypoint[],
    maximumDistance = 250,
): SnappedWaypoints {
    if (!route.length)
        return { points: [], ignoredNames: waypoints.map(waypoint => waypoint.name) };
    const snapped = new Map<number, NamedGeoWaypoint[]>();
    const ignoredNames: string[] = [];
    for (const waypoint of waypoints) {
        let index = 0;
        let best = Infinity;
        route.forEach((point, pointIndex) => {
            const distance = haversineMeters(waypoint, point);
            if (distance < best) {
                best = distance;
                index = pointIndex;
            }
        });
        if (best > maximumDistance) {
            ignoredNames.push(waypoint.name);
            continue;
        }
        const values = snapped.get(index) ?? [];
        values.push(waypoint);
        snapped.set(index, values);
    }
    const points: SnappedWaypoint[] = [...snapped.entries()].map(([index, values]) => ({
        index,
        waypoint: {
            name: values.map(value => value.name).join(' / '),
            lat: route[index].lat,
            lon: route[index].lon,
            ele: values.length === 1 ? values[0].ele : route[index].ele,
        },
    }));
    const endpoint = (name: string, index: number): SnappedWaypoint => ({
        index,
        waypoint: { name, lat: route[index].lat, lon: route[index].lon, ele: route[index].ele },
    });
    const finalIndex = route.length - 1;
    const start = points.find(point => point.index === 0);
    start ? start.waypoint.name = `Start — ${start.waypoint.name}` : points.push(endpoint('Start', 0));
    const end = points.find(point => point.index === finalIndex);
    end ? end.waypoint.name = `End — ${end.waypoint.name}` : points.push(endpoint('End', finalIndex));
    points.sort((a, b) => a.index - b.index);
    return { points, ignoredNames };
}

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
