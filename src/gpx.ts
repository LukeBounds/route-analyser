import { accumulateSegments, selectLongestRouteChain, type DistancePoint } from './core.js';

export type GpxPoint = {
    lat: number;
    lon: number;
    ele: number | null;
};

export type RoutePoint = GpxPoint & DistancePoint;

export type NamedWaypoint = GpxPoint & {
    name: string;
};

export type RecordedActivityPoint = RoutePoint & {
    time: number;
};

export type ParsedRoute = {
    points: RoutePoint[];
    waypoints: NamedWaypoint[];
    warnings: string[];
};

function childText(element: Element, name: string) {
    return [...element.children].find(child => child.localName === name)?.textContent;
}

function parsePoint(element: Element): GpxPoint {
    const elevationText = childText(element, 'ele');
    const elevation = elevationText === undefined ? null : Number(elevationText);
    return {
        lat: Number(element.getAttribute('lat')),
        lon: Number(element.getAttribute('lon')),
        ele: Number.isFinite(elevation) ? elevation : null,
    };
}

function validPoints(elements: Element[]) {
    return elements
        .map(parsePoint)
        .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

function parseXml(text: string, errorMessage: string) {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.querySelector('parsererror'))
        throw new Error(errorMessage);
    return document;
}

export function parseRouteGpx(text: string): ParsedRoute {
    const document = parseXml(text, 'This GPX could not be read.');
    const waypoints = [...document.querySelectorAll('wpt')].flatMap(element => {
        const name = childText(element, 'name')?.trim();
        if (!name)
            return [];
        return [{ ...parsePoint(element), name }];
    }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    const trackSources = [...document.querySelectorAll('trk')].map(track => {
        const trackSegments = [...track.children].filter(child => child.localName === 'trkseg');
        const segments = trackSegments
            .map(segment => validPoints([...segment.children].filter(child => child.localName === 'trkpt')))
            .filter(segment => segment.length >= 2);
        if (segments.length)
            return segments;
        const directPoints = validPoints([...track.children].filter(child => child.localName === 'trkpt'));
        return directPoints.length >= 2 ? [directPoints] : [];
    });
    const routeSources = [...document.querySelectorAll('rte')]
        .map(route => [validPoints([...route.children].filter(child => child.localName === 'rtept'))])
        .filter(source => source[0].length >= 2);
    const selected = selectLongestRouteChain([...trackSources, ...routeSources]);
    if (selected.points.length < 3)
        throw new Error('No usable GPX track or route was found.');
    const points = accumulateSegments([selected.points]);
    if ((points.at(-1)?.d ?? 0) < 10)
        throw new Error('The selected trace does not contain at least 10 m of usable route distance.');
    const warnings = selected.discardedChains
        ? [`Ignored ${selected.discardedChains} disconnected GPX ${selected.discardedChains === 1 ? 'part' : 'parts'} instead of adding artificial distance between them.`]
        : [];
    return { points, waypoints, warnings };
}

export function parseActivityGpx(text: string): RecordedActivityPoint[] {
    const document = parseXml(text, 'This activity GPX could not be read.');
    const candidates = [...document.querySelectorAll('trk')].map(track => {
        const trackSegments = [...track.children].filter(child => child.localName === 'trkseg');
        const segmentElements = trackSegments.length ? trackSegments : [track];
        const segments = segmentElements.map(segment => [...segment.children]
            .filter(child => child.localName === 'trkpt')
            .map(point => {
                const time = Date.parse(childText(point, 'time') || '');
                return { ...parsePoint(point), time };
            })
            .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.time)))
            .filter(segment => segment.length);
        return { segments, points: accumulateSegments(segments) };
    }).filter(candidate => candidate.points.length >= 3)
        .sort((a, b) => (b.points.at(-1)?.d ?? 0) - (a.points.at(-1)?.d ?? 0) || b.points.length - a.points.length);
    if (!candidates[0])
        throw new Error('The activity needs at least three timestamped track points.');
    return candidates[0].points;
}
