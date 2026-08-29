import { createMapterhornProvider, mapterhornTileCoordinate } from '../src/elevation.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function ok(value: unknown, message: string): void {
    if (!value)
        throw new Error(message);
}

const coordinate = mapterhornTileCoordinate({ lat: 54.454, lon: -3.212 });
ok(coordinate.x >= 0 && coordinate.x < 2 ** 15, 'tile x is within the selected zoom');
ok(coordinate.y >= 0 && coordinate.y < 2 ** 15, 'tile y is within the selected zoom');
ok(coordinate.pixelX >= 0 && coordinate.pixelX < 512, 'tile pixel x is in bounds');
ok(coordinate.pixelY >= 0 && coordinate.pixelY < 512, 'tile pixel y is in bounds');

const provider = createMapterhornProvider();
const sameTile = provider.prepare([
    { lat: 54.454, lon: -3.212, ele: null },
    { lat: 54.45401, lon: -3.21201, ele: null },
]);
equal(sameTile.requestCount, 1, 'nearby samples share one elevation tile request');

const separateTiles = provider.prepare([
    { lat: 54.454, lon: -3.212, ele: null },
    { lat: 51.507, lon: -0.128, ele: null },
]);
equal(separateTiles.requestCount, 2, 'distant samples use separate elevation tile requests');
equal(provider.name, 'Mapterhorn', 'provider metadata is exposed to the UI');

console.log('Elevation-provider regression tests passed.');
