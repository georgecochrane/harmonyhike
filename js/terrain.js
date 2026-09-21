// Getting the land: elevation from the AWS Terrain Tiles (Terrarium PNGs), land cover read from OpenStreetMap map tiles, and place
// names from Nominatim. The same maths as the desktop app's TileElevationProvider and OsmLandCoverProvider.

const TILE = 256, EARTH = 40075016.686, PI = Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const LAND = { nature: 0, farmland: 1, town: 2, water: 3 };

// Colours from OpenStreetMap's standard style, as [r, g, b, class].
const PALETTE = [
    [170, 211, 223, 3],
    [224, 223, 223, 2], [242, 218, 217, 2], [255, 214, 209, 2], [235, 219, 232, 2], [217, 208, 201, 2], [238, 238, 238, 2], [255, 255, 255, 2], [240, 240, 216, 2],
    [238, 240, 213, 1], [205, 235, 176, 1], [201, 225, 191, 1], [174, 223, 163, 1],
    [173, 209, 158, 0], [200, 215, 171, 0], [214, 217, 159, 0], [200, 250, 204, 0], [170, 203, 175, 0], [170, 224, 203, 0],
    [238, 229, 220, 0], [245, 233, 198, 0], [255, 241, 186, 0], [221, 236, 236, 0], [242, 239, 233, 0],
];
const classCache = new Map();
function classify(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let hit = classCache.get(key);
    if (hit !== undefined) return hit;
    let best = 24 * 24 + 1, land = -1;
    for (const [pr, pg, pb, c] of PALETTE) {
        const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (d < best) { best = d; land = c; }
    }
    classCache.set(key, land);
    return land;
}

async function loadTile(cache, url, decode) {
    if (cache.has(url)) return cache.get(url);
    const promise = (async () => {
        for (let attempt = 0; attempt < 2; ++attempt) {
            try {
                const response = await fetch(url, { mode: 'cors' });
                if (!response.ok) throw new Error(response.status);
                const bitmap = await createImageBitmap(await response.blob());
                const canvas = new OffscreenCanvas(TILE, TILE);
                const g = canvas.getContext('2d', { willReadFrequently: true });
                g.drawImage(bitmap, 0, 0);
                return decode(g.getImageData(0, 0, TILE, TILE).data);
            } catch (e) { /* try again once */ }
        }
        return null;
    })();
    cache.set(url, promise);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    const tile = await promise;
    if (tile === null) cache.delete(url);
    return tile;
}

// The public elevation tiles now and then contain isolated wrong pixels (one cell, or a cluster of two or three, thousands of metres
// off), which show up as needles. Replace any pixel that sticks out from most of its eight neighbours by more than a slope no real
// hillside has (or 40 m, whichever is more) with the median of those neighbours. Same rule as Source/Terrain/Despike.h.
function despikeTile(heights, size, metresPerPixel) {
    const allowed = Math.max(40, 3 * metresPerPixel), source = Float32Array.from(heights), n = [];
    for (let y = 0; y < size; ++y) for (let x = 0; x < size; ++x) {
        n.length = 0;
        for (let dy = -1; dy <= 1; ++dy) for (let dx = -1; dx <= 1; ++dx) {
            const nx = x + dx, ny = y + dy;
            if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            n.push(source[ny * size + nx]);
        }
        if (n.length < 3) continue;
        n.sort((a, b) => a - b);
        const v = source[y * size + x], high = n[Math.max(0, n.length - 3)], low = n[Math.min(n.length - 1, 2)];
        if (v > high + allowed || v < low - allowed || !Number.isFinite(v)) heights[y * size + x] = n[n.length >> 1];
    }
    return heights;
}

// For drawing: lays water flat. Every water vertex (class 3) is set to a smooth surface (the average of the water around it, never higher than the
// nearby shore), so lakes are level and rivers slope gently instead of showing the shape of the bed. Same rule as TerrainGrid::flattenWater in the app.
export function flattenWater(heights, classes, n) {
    if (!classes || classes.length !== heights.length || n < 8) return heights;
    const count = n * n, radius = Math.max(3, Math.floor(n / 40)), WATER = 3;
    const out = Float32Array.from(heights);
    let sum = new Float64Array(count), weight = new Float64Array(count), tmp = new Float64Array(count);
    for (let i = 0; i < count; ++i) if (classes[i] === WATER) { sum[i] = heights[i]; weight[i] = 1; }
    const blur = (a, alongX) => {
        for (let line = 0; line < n; ++line) {
            let running = 0;
            for (let k = -radius; k < n + radius; ++k) {
                const add = k + radius, drop = k - radius - 1;
                if (add >= 0 && add < n) running += a[alongX ? line * n + add : add * n + line];
                if (drop >= 0 && drop < n) running -= a[alongX ? line * n + drop : drop * n + line];
                if (k >= 0 && k < n) tmp[alongX ? line * n + k : k * n + line] = running;
            }
        }
        const t = tmp; tmp = a; return t;
    };
    sum = blur(sum, true); sum = blur(sum, false); weight = blur(weight, true); weight = blur(weight, false);
    let shore = new Float32Array(count).fill(1e30), scratch = new Float32Array(count);
    for (let i = 0; i < count; ++i) if (classes[i] !== WATER) shore[i] = heights[i];
    for (let pass = 0; pass < 2; ++pass) {
        for (let y = 0; y < n; ++y) for (let x = 0; x < n; ++x) {
            let m = 1e30;
            for (let d = -2; d <= 2; ++d) {
                const xx = pass === 0 ? x + d : x, yy = pass === 0 ? y : y + d;
                if (xx >= 0 && yy >= 0 && xx < n && yy < n) m = Math.min(m, shore[yy * n + xx]);
            }
            scratch[y * n + x] = m;
        }
        [shore, scratch] = [scratch, shore];
    }
    for (let i = 0; i < count; ++i) if (classes[i] === WATER && weight[i] > 0) {
        let level = sum[i] / weight[i];
        if (shore[i] < 1e29) level = Math.min(level, shore[i]);
        out[i] = level;
    }
    return out;
}

export class TerrainSource {
    constructor() { this.elevationTiles = new Map(); this.mapTiles = new Map(); }

    // Heights (metres) on a res x res grid covering a disc of the given radius, or null if the tiles couldn't be fetched.
    // Grid convention: x east, y south, so a top-down view has north at the top.
    async fetchElevation(lat, lon, radiusMeters, res) {
        const latRad = clamp(lat, -85, 85) * PI / 180, cosLat = Math.max(0.01, Math.cos(latRad));
        const radius = Math.max(1, radiusMeters);
        const extra = res > 100 ? 1 : 0;   // a finer grid uses tiles one level finer
        const zoom = clamp(Math.floor(Math.log2(EARTH * cosLat / (2 * radius))) + extra, 0, 15);
        const worldPixels = TILE * 2 ** zoom, tilesAcross = 2 ** zoom, mpp = EARTH * cosLat / worldPixels;
        const cx = (lon + 180) / 360 * worldPixels, cy = (1 - Math.asinh(Math.tan(latRad)) / PI) / 2 * worldPixels;
        const halfPixels = radius / mpp + 2;
        const x0 = Math.floor((cx - halfPixels) / TILE), x1 = Math.floor((cx + halfPixels) / TILE);
        const y0 = clamp(Math.floor((cy - halfPixels) / TILE), 0, tilesAcross - 1), y1 = clamp(Math.floor((cy + halfPixels) / TILE), 0, tilesAcross - 1);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 36) return null;

        const jobs = [], tiles = new Map();
        for (let ty = y0; ty <= y1; ++ty) for (let tx = x0; tx <= x1; ++tx) {
            const wx = ((tx % tilesAcross) + tilesAcross) % tilesAcross, key = wx + ',' + ty;
            if (tiles.has(key)) continue;
            tiles.set(key, null);
            const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${wx}/${ty}.png`;
            jobs.push(loadTile(this.elevationTiles, url, px => {
                const out = new Float32Array(TILE * TILE);
                for (let i = 0; i < TILE * TILE; ++i) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
                return despikeTile(out, TILE, EARTH / (TILE * 2 ** zoom));
            }).then(t => tiles.set(key, t)));
        }
        await Promise.all(jobs);
        for (const t of tiles.values()) if (t === null) return null;

        const worldPx = Math.floor(worldPixels);
        const pixel = (ix, iy) => {
            iy = clamp(iy, 0, worldPx - 1);
            ix = ((ix % worldPx) + worldPx) % worldPx;
            const tile = tiles.get(Math.floor(ix / TILE) + ',' + Math.floor(iy / TILE));
            return tile ? tile[(iy % TILE) * TILE + (ix % TILE)] : 0;
        };
        const heights = new Float32Array(res * res), spacing = 2 * radius / (res - 1), half = (res - 1) / 2;
        for (let gy = 0; gy < res; ++gy) for (let gx = 0; gx < res; ++gx) {
            const u = cx + (gx - half) * spacing / mpp - 0.5, v = cy + (gy - half) * spacing / mpp - 0.5;
            const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
            const top = pixel(i0, j0) + (pixel(i0 + 1, j0) - pixel(i0, j0)) * fu;
            const bottom = pixel(i0, j0 + 1) + (pixel(i0 + 1, j0 + 1) - pixel(i0, j0 + 1)) * fu;
            heights[gy * res + gx] = top + (bottom - top) * fv;
        }
        return heights;
    }

    // Land cover (Nature / Farmland / Town / Water) on a res x res grid, or null.
    async fetchLandCover(lat, lon, radiusMeters, res) {
        if (res < 2) return null;
        const latRad = clamp(lat, -85, 85) * PI / 180, cosLat = Math.max(0.01, Math.cos(latRad));
        const radius = Math.max(1, radiusMeters), spacing = 2 * radius / (res - 1);
        let zoom = clamp(Math.ceil(Math.log2(EARTH * cosLat / (TILE * Math.max(0.05, spacing / 3)))), 0, 18);
        let worldPixels, tilesAcross, mpp, cx, cy, x0, x1, y0, y1;
        for (;;) {   // a very wide region would need a great many tiles at that zoom: back off to coarser ones
            worldPixels = TILE * 2 ** zoom; tilesAcross = 2 ** zoom; mpp = EARTH * cosLat / worldPixels;
            cx = (lon + 180) / 360 * worldPixels; cy = (1 - Math.asinh(Math.tan(latRad)) / PI) / 2 * worldPixels;
            const halfPixels = radius / mpp + 2;
            x0 = Math.floor((cx - halfPixels) / TILE); x1 = Math.floor((cx + halfPixels) / TILE);
            y0 = clamp(Math.floor((cy - halfPixels) / TILE), 0, tilesAcross - 1); y1 = clamp(Math.floor((cy + halfPixels) / TILE), 0, tilesAcross - 1);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 12 || zoom <= 0) break;
            --zoom;
        }
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16) return null;

        const jobs = [], tiles = new Map();
        for (let ty = y0; ty <= y1; ++ty) for (let tx = x0; tx <= x1; ++tx) {
            const wx = ((tx % tilesAcross) + tilesAcross) % tilesAcross, key = wx + ',' + ty;
            if (tiles.has(key)) continue;
            tiles.set(key, null);
            jobs.push(loadTile(this.mapTiles, `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`, px => {
                const out = new Int8Array(TILE * TILE);   // the class of each pixel, or -1 where it carries no information
                for (let i = 0; i < TILE * TILE; ++i) out[i] = classify(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
                return out;
            }).then(t => tiles.set(key, t)));
        }
        await Promise.all(jobs);
        for (const t of tiles.values()) if (t === null) return null;

        const worldPx = Math.floor(worldPixels);
        const classAt = (ix, iy) => {
            iy = clamp(iy, 0, worldPx - 1);
            ix = ((ix % worldPx) + worldPx) % worldPx;
            const tile = tiles.get(Math.floor(ix / TILE) + ',' + Math.floor(iy / TILE));
            return tile ? tile[(iy % TILE) * TILE + (ix % TILE)] : -1;
        };
        const classes = new Uint8Array(res * res), half = (res - 1) / 2, cellPixels = spacing / mpp;
        const samples = clamp(Math.ceil(cellPixels), 1, 8);
        for (let gy = 0; gy < res; ++gy) for (let gx = 0; gx < res; ++gx) {
            const u0 = cx + (gx - half - 0.5) * cellPixels, v0 = cy + (gy - half - 0.5) * cellPixels;
            const votes = [0, 0, 0, 0];
            let counted = 0;
            for (let sy = 0; sy < samples; ++sy) for (let sx = 0; sx < samples; ++sx) {
                const c = classAt(Math.floor(u0 + (sx + 0.5) * cellPixels / samples), Math.floor(v0 + (sy + 0.5) * cellPixels / samples));
                if (c >= 0) { ++votes[c]; ++counted; }
            }
            if (counted === 0) continue;
            const total = samples * samples, share = c => votes[c] / total;
            let chosen = 0;
            if (share(3) >= 0.15) chosen = 3;
            else if (share(2) >= 0.3) chosen = 2;
            else if (share(1) >= 0.25 && votes[1] >= votes[0]) chosen = 1;
            classes[gy * res + gx] = chosen;
        }
        return classes;
    }
}

// A plausible landscape for when the tiles can't be reached (offline): smooth noise, shaped like the desktop app's fallback.
export function proceduralHeights(lat, lon, radiusMeters, res) {
    const h = new Float32Array(res * res);
    const seed = Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453, s0 = seed - Math.floor(seed);
    const relief = clamp(radiusMeters / 2000, 0.005, 1);
    for (let y = 0; y < res; ++y) for (let x = 0; x < res; ++x) {
        const u = 3 * x / (res - 1), v = 3 * y / (res - 1);
        const n = 0.5 + 0.28 * Math.sin(u * 1.7 + s0 * 6) * Math.cos(v * 1.3 + s0 * 9) + 0.16 * Math.sin(u * 3.9 + v * 2.7 + s0 * 3) + 0.08 * Math.sin(u * 8.1 - v * 6.3);
        h[y * res + x] = (n * 260 + 40 * (x + y) / (2 * res)) * relief;
    }
    return h;
}

export function parseLatLon(text) {
    const parts = text.split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2 || !parts.every(p => /^[+-]?\d+(\.\d+)?$/.test(p))) return null;
    const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export async function geocode(text) {
    const direct = parseLatLon(text);
    if (direct) return direct;
    try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(text));
        const list = await r.json();
        if (list.length) return { lat: parseFloat(list[0].lat), lon: parseFloat(list[0].lon), name: list[0].display_name };
    } catch (e) { /* offline */ }
    return null;
}

export async function fetchWeather(lat, lon) {
    try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=cloud_cover,wind_speed_10m,wind_direction_10m,temperature_2m&wind_speed_unit=ms`);
        const c = (await r.json()).current;
        return { cloudCover: c.cloud_cover / 100, windMetersPerSecond: c.wind_speed_10m, windFromDegrees: c.wind_direction_10m, temperatureC: c.temperature_2m };
    } catch (e) { return null; }
}
