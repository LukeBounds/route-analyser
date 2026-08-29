import { prepareCanvas } from './canvas.js';
import type { PrimaryTerrainSection, TerrainKind, TerrainSection } from '../terrain.js';

export type TerrainChartPoint = {
    d: number;
};

export type TerrainChartWaypoint = {
    name: string;
    index: number;
};

export function locateChartDistance(points: TerrainChartPoint[], distance: number) {
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        points[middle].d < distance ? low = middle + 1 : high = middle;
    }
    return low;
}

export function visibleElevationBounds(elevations: number[], first: number, last: number) {
    let low = Infinity;
    let high = -Infinity;
    for (let index = first; index <= last; index++) {
        const elevation = elevations[index];
        if (!Number.isFinite(elevation))
            continue;
        if (elevation < low)
            low = elevation;
        if (elevation > high)
            high = elevation;
    }
    return low === Infinity ? null : { low, high };
}

export function terrainDistanceAt(
    canvas: HTMLCanvasElement,
    clientX: number,
    viewStart: number,
    viewEnd: number,
) {
    const rect = canvas.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - 64);
    const distance = viewStart + (clientX - rect.left - 50) / plotWidth * (viewEnd - viewStart);
    return Math.max(viewStart, Math.min(viewEnd, distance));
}

export function drawTerrainProfile(options: {
    canvas: HTMLCanvasElement;
    points: TerrainChartPoint[];
    elevations: number[];
    sections: TerrainSection[];
    primarySections: PrimaryTerrainSection[];
    waypoints: TerrainChartWaypoint[];
    viewStart: number;
    viewEnd: number;
    showWaypoints: boolean;
    colourMode: 'sections' | 'gradient';
    gradeThreshold: number;
    localGrade: (index: number) => number;
    hoveredPrimary: number | null;
    hoverDistance: number | null;
    selectionStart: number | null;
    selectionEnd: number | null;
    sectionColours: Record<TerrainKind, string>;
}) {
    const {
        canvas,
        points,
        elevations,
        sections,
        primarySections,
        waypoints,
        viewStart,
        viewEnd,
        showWaypoints,
        colourMode,
        gradeThreshold,
        localGrade,
        hoveredPrimary,
        hoverDistance,
        selectionStart,
        selectionEnd,
        sectionColours,
    } = options;
    if (!elevations.length || !points.length)
        return;
    const total = points.at(-1)!.d;
    const first = locateChartDistance(points, viewStart);
    const last = locateChartDistance(points, viewEnd);
    const bounds = visibleElevationBounds(elevations, first, last);
    if (!bounds)
        return;
    const padding = Math.max(5, (bounds.high - bounds.low) * .08);
    const low = bounds.low - padding;
    const elevationSpan = Math.max(10, bounds.high - bounds.low + padding * 2);
    const { context, width, height, theme } = prepareCanvas(canvas);
    const left = 50;
    const right = 14;
    const top = 14;
    const bottom = showWaypoints && waypoints.some(({ index }) => index >= first && index <= last) ? 108 : 30;
    const distanceSpan = Math.max(1, viewEnd - viewStart);
    const X = (distance: number) => left + (distance - viewStart) / distanceSpan * (width - left - right);
    const Y = (elevation: number) => top + (low + elevationSpan - elevation) / elevationSpan * (height - top - bottom);
    const gradientColour = (index: number) => {
        const grade = localGrade(index);
        if (grade >= gradeThreshold + 7)
            return '#a52f24';
        if (grade >= gradeThreshold + 3)
            return '#d66a35';
        if (grade >= gradeThreshold)
            return '#d99939';
        if (grade <= -gradeThreshold - 7)
            return '#16634f';
        if (grade <= -gradeThreshold - 3)
            return '#31805a';
        if (grade <= -gradeThreshold)
            return '#75ad96';
        return '#607183';
    };
    const line = (section: TerrainSection, lineWidth = 3, colour?: string) => {
        const start = Math.max(section.a, first);
        const end = Math.min(section.b, last);
        if (start >= end)
            return;
        context.lineWidth = lineWidth;
        if (colour || colourMode === 'sections') {
            context.strokeStyle = colour ?? sectionColours[section.k];
            context.beginPath();
            for (let index = start; index <= end; index++)
                index === start
                    ? context.moveTo(X(points[index].d), Y(elevations[index]))
                    : context.lineTo(X(points[index].d), Y(elevations[index]));
            context.stroke();
            return;
        }
        for (let index = start; index < end; index++) {
            context.strokeStyle = gradientColour(index);
            context.beginPath();
            context.moveTo(X(points[index].d), Y(elevations[index]));
            context.lineTo(X(points[index + 1].d), Y(elevations[index + 1]));
            context.stroke();
        }
    };

    context.strokeStyle = theme.axis;
    context.beginPath();
    context.moveTo(left, top);
    context.lineTo(left, height - bottom);
    context.lineTo(width - right, height - bottom);
    context.stroke();
    context.fillStyle = theme.text;
    context.font = '12px system-ui';
    context.fillText(`${Math.round(low + elevationSpan)} m`, 3, top + 10);
    context.fillText(`${Math.round(low)} m`, 3, height - bottom);
    context.fillText(`${(viewStart / 1000).toFixed(2)} km`, left, height - 8);
    context.fillText(`${(viewEnd / 1000).toFixed(2)} km`, width - right - 50, height - 8);
    context.save();
    context.beginPath();
    context.rect(left, top, width - left - right, height - top - bottom);
    context.clip();
    sections.forEach(section => line(section));
    if (showWaypoints) {
        waypoints.filter(({ index }) => index >= first && index <= last).forEach(({ index }) => {
            const x = X(points[index].d);
            const y = Y(elevations[index]);
            context.save();
            context.setLineDash([3, 4]);
            context.strokeStyle = '#2563eb';
            context.globalAlpha = .55;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(x, top);
            context.lineTo(x, height - bottom);
            context.stroke();
            context.restore();
            context.fillStyle = '#2563eb';
            context.beginPath();
            context.arc(x, y, 4, 0, Math.PI * 2);
            context.fill();
        });
    }
    if (viewStart !== 0 || viewEnd !== total) {
        context.fillStyle = theme.markerFill;
        context.strokeStyle = theme.text;
        context.lineWidth = 1.5;
        const boundaries = new Set<number>();
        primarySections.forEach(primary => primary.c.forEach(section => {
            boundaries.add(section.a);
            boundaries.add(section.b);
        }));
        boundaries.forEach(index => {
            if (index < first || index > last)
                return;
            context.beginPath();
            context.arc(X(points[index].d), Y(elevations[index]), 3.5, 0, Math.PI * 2);
            context.fill();
            context.stroke();
        });
    }
    if (hoveredPrimary !== null && viewStart === 0 && viewEnd === total) {
        const primary = primarySections[hoveredPrimary];
        if (primary) {
            line({ k: 'flat', a: primary.a, b: primary.b }, 8, theme.hover);
            primary.c.forEach(section => line(section, 4));
        }
    }
    context.restore();
    if (showWaypoints) {
        context.fillStyle = '#2563eb';
        context.font = '11px system-ui';
        context.textAlign = 'center';
        const laneEnds: number[] = [];
        const visibleWaypoints = waypoints
            .filter(({ index }) => index >= first && index <= last)
            .sort((a, b) => points[a.index].d - points[b.index].d);
        visibleWaypoints.forEach(({ name, index }) => {
            const x = X(points[index].d);
            const labelWidth = context.measureText(name).width + 10;
            let lane = 0;
            while (laneEnds[lane] !== undefined && x - labelWidth / 2 < laneEnds[lane])
                lane++;
            laneEnds[lane] = x + labelWidth / 2;
            if (lane < 6)
                context.fillText(name, x, height - bottom + 16 + lane * 14);
        });
        context.textAlign = 'start';
    }
    if (selectionStart !== null && selectionEnd !== null) {
        const x = Math.min(X(selectionStart), X(selectionEnd));
        const selectionWidth = Math.abs(X(selectionEnd) - X(selectionStart));
        context.fillStyle = 'rgba(37,99,235,.18)';
        context.fillRect(x, top, selectionWidth, height - top - bottom);
        context.strokeStyle = '#2563eb';
        context.lineWidth = 1;
        context.strokeRect(x, top, selectionWidth, height - top - bottom);
    }
    if (hoverDistance !== null) {
        const primary = hoveredPrimary === null ? null : primarySections[hoveredPrimary];
        const point = locateChartDistance(points, hoverDistance);
        const waypoint = showWaypoints ? waypoints.find(entry => entry.index === point)?.name : undefined;
        const subsection = primary?.c.findIndex(section => point >= section.a && point <= section.b);
        const grade = localGrade(point);
        const section = primary
            ? `${primary.k[0].toUpperCase() + primary.k.slice(1)} ${hoveredPrimary! + 1}${subsection === undefined || subsection < 0 ? '' : `.${subsection + 1}`} · `
            : '';
        context.fillStyle = theme.hover;
        context.fillText(`${waypoint ? `${waypoint} · ` : ''}${section}${grade >= 0 ? '+' : ''}${grade.toFixed(1)}% local grade`, left + 8, top + 16);
    }
}
