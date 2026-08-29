export type ElevationPoint = {
    lat: number;
    lon: number;
    ele: number | null;
};

export type ElevationProgress = {
    completed: number;
    total: number;
};

export interface ElevationLookupPlan {
    requestCount: number;
    fill: (onProgress?: (progress: ElevationProgress) => void) => Promise<void>;
}

export interface ElevationProvider {
    id: string;
    name: string;
    attributionUrl: string;
    prepare: (points: ElevationPoint[]) => ElevationLookupPlan;
}

type TileSample = {
    point: ElevationPoint;
    x: number;
    y: number;
};

type TerrainTile = {
    z: number;
    x: number;
    y: number;
    samples: TileSample[];
};

export function mapterhornTileCoordinate(point: Pick<ElevationPoint, 'lat' | 'lon'>, zoom = 15, tileSize = 512) {
    const count = 2 ** zoom;
    const longitude = Math.max(-180, Math.min(179.999999, point.lon));
    const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
    const projectedX = (longitude + 180) / 360 * count;
    const projectedY = (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * count;
    const x = Math.max(0, Math.min(count - 1, Math.floor(projectedX)));
    const y = Math.max(0, Math.min(count - 1, Math.floor(projectedY)));
    return {
        x,
        y,
        pixelX: Math.max(0, Math.min(tileSize - 1, Math.floor((projectedX - x) * tileSize))),
        pixelY: Math.max(0, Math.min(tileSize - 1, Math.floor((projectedY - y) * tileSize))),
    };
}

export function createMapterhornProvider(options: {
    zoom?: number;
    tileSize?: number;
    concurrency?: number;
    tileUrl?: (tile: Pick<TerrainTile, 'z' | 'x' | 'y'>) => string;
} = {}): ElevationProvider {
    const zoom = options.zoom ?? 15;
    const tileSize = options.tileSize ?? 512;
    const concurrency = options.concurrency ?? 4;
    const tileUrl = options.tileUrl ?? (tile => `https://tiles.mapterhorn.com/${tile.z}/${tile.x}/${tile.y}.webp`);
    return {
        id: 'mapterhorn',
        name: 'Mapterhorn',
        attributionUrl: 'https://mapterhorn.com/attribution/',
        prepare(points) {
            const tiles = new Map<string, TerrainTile>();
            points.forEach(point => {
                const coordinate = mapterhornTileCoordinate(point, zoom, tileSize);
                const key = `${zoom}/${coordinate.x}/${coordinate.y}`;
                const tile = tiles.get(key) ?? { z: zoom, x: coordinate.x, y: coordinate.y, samples: [] };
                tile.samples.push({ point, x: coordinate.pixelX, y: coordinate.pixelY });
                tiles.set(key, tile);
            });
            const requests = [...tiles.values()];
            return {
                requestCount: requests.length,
                async fill(onProgress) {
                    const queue = [...requests];
                    let completed = 0;
                    async function worker() {
                        while (queue.length) {
                            const tile = queue.shift()!;
                            const response = await fetch(tileUrl(tile));
                            if (!response.ok)
                                throw Error('Mapterhorn terrain tiles could not be reached.');
                            const bitmap = await createImageBitmap(await response.blob());
                            const canvas = document.createElement('canvas');
                            canvas.width = canvas.height = tileSize;
                            const context = canvas.getContext('2d', { willReadFrequently: true })!;
                            context.drawImage(bitmap, 0, 0);
                            bitmap.close();
                            const pixels = context.getImageData(0, 0, tileSize, tileSize).data;
                            tile.samples.forEach(sample => {
                                const offset = (sample.y * tileSize + sample.x) * 4;
                                const elevation = pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
                                if (!pixels[offset + 3] || !Number.isFinite(elevation) || elevation < -1000 || elevation > 10000)
                                    throw Error('A Mapterhorn terrain tile returned an invalid elevation value.');
                                sample.point.ele = elevation;
                            });
                            onProgress?.({ completed: ++completed, total: requests.length });
                        }
                    }
                    await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
                },
            };
        },
    };
}
