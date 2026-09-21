// The map view: the camera and the circular window on the land (a port of the desktop TerrainView's maths), turning what the simulation
// reports into something for the renderer to draw, and the mouse handling. Window coordinates are -1..1 across the map; x is east, z
// is south, y is up.
import { flattenWater } from './terrain.js';

const TAU = Math.PI * 2, HALF_PI = Math.PI / 2;
const K = {
    baseCameraDistance: 2.9, tanHalfFov: 0.41421356, minPitch: 0.2, maxPitch: HALF_PI, defaultPitch: 0.9,
    hikerHeightAtReference: 0.22, referenceRadius: 7.62, minHikerHeight: 0.07, minAnimalHeight: 0.06,
    limbSwing: 0.65, minCycles: 0.45, maxCycles: 1.7, reliefTarget: 0.45, maxExaggeration: 8, skirtDepth: 0.14, fishScale: 0.4,
    metresPerDegree: 111320,
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const speedFeel = rps => clamp(Math.pow(Math.max(rps, 1e-6), 0.35), 0, 1);

export const metresBetween = (lat0, lon0, lat1, lon1) => {
    const cosLat = Math.max(0.01, Math.cos(lat0 * Math.PI / 180));
    return { x: (lon1 - lon0) * K.metresPerDegree * cosLat, y: -(lat1 - lat0) * K.metresPerDegree };
};
export const offsetLatLon = (lat, lon, east, south) => {
    const cosLat = Math.max(0.01, Math.cos(lat * Math.PI / 180));
    return { lat: lat - south / K.metresPerDegree, lon: lon + east / (K.metresPerDegree * cosLat) };
};

// Solar position (low-precision), the same formulae as the desktop app. Returns { elevation, azimuth } in radians.
export function sunPosition(latDeg, lonDeg, unixSeconds) {
    const rad = Math.PI / 180, d = unixSeconds / 86400 + 2440587.5 - 2451545;
    const meanLon = 280.46 + 0.9856474 * d, meanAnomaly = (357.528 + 0.9856003 * d) * rad;
    const lambda = (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad, obliquity = (23.439 - 4e-7 * d) * rad;
    const ra = Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda)), dec = Math.asin(Math.sin(obliquity) * Math.sin(lambda));
    const hour = ((280.46061837 + 360.98564736629 * d) + lonDeg) * rad - ra, phi = latDeg * rad;
    const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hour);
    const az = Math.atan2(Math.sin(hour), Math.cos(hour) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
    return { elevation: Math.asin(clamp(sinEl, -1, 1)), azimuth: az };
}
export const daylightFactor = el => { const t = clamp((el * 57.29578 + 6) / 18, 0, 1); return t * t * (3 - 2 * t); };

export class View {
    constructor(canvas, overlay, renderer) {
        this.canvas = canvas; this.overlay = overlay; this.renderer = renderer;
        this.yaw = 0; this.pitch = K.defaultPitch; this.zoom = 1;
        this.mode = 'rotate';                       // 'rotate' | 'manage'
        this.coarse = null; this.world = null;      // land surfaces: { key, res, heights, classes, lat, lon, radius, spacing, minH, maxH }
        this.windowLat = null; this.windowLon = null;
        this.displayedRadius = 0; this.wantedRadius = 0;
        this.commitPending = false; this.sentLat = 0; this.sentLon = 0;
        this.shownMid = NaN; this.shownExag = NaN;
        this.snapshot = null; this.snapshotAt = 0; this.tickInterval = 50; this.lastTick = -1;
        this.glide = new Map(); this.stride = new Map(); this.heading = new Map();
        this.selected = new Set();
        this.hover = null; this.marquee = null; this.dragging = null;
        this.weather = { cloudCover: 0.4, windMetersPerSecond: 3, windFromDegrees: 270, temperatureC: 12 };
        this.options = { realLight: false, cloudOpacity: 0.5, overlays: { glows: true, numbers: true, compass: true, legend: true, captions: true }, detail: 'high' };
        this.fixedTime = null;
        this.fish = []; this.nextFish = 0; this.waterCells = []; this.waterKey = '';
        this.clouds = null; this.cloudDrift = { x: 0, y: 0 }; this.lastFrameMs = 0;
        this.callbacks = {};
        this.attach();
    }

    on(name, fn) { (this.callbacks[name] ||= []).push(fn); }
    emit(name, ...args) { for (const fn of this.callbacks[name] || []) fn(...args); }

    // ---------------------------------------------------------------- data in
    setCoarse(surface) {
        this.coarse = { ...surface, spacing: 2 * surface.radius / (surface.res - 1) };
        this.coarse.minH = Math.min(...this.sampleRange(surface)); this.coarse.maxH = Math.max(...this.sampleRange(surface));
        if (this.windowLat === null) { this.windowLat = surface.lat; this.windowLon = surface.lon; }
        if (!this.displayedRadius) this.displayedRadius = surface.radius;
        if (this.commitPending) {
            const off = metresBetween(surface.lat, surface.lon, this.sentLat, this.sentLon);
            if (Math.hypot(off.x, off.y) < 2) this.commitPending = false;
        }
        const away = metresBetween(surface.lat, surface.lon, this.windowLat, this.windowLon);
        if (!this.follow && !this.dragging?.pan && !this.commitPending && Math.hypot(away.x, away.y) > 0.6 * this.displayedRadius) { this.windowLat = surface.lat; this.windowLon = surface.lon; }
        this.waterKey = '';
    }
    setWorld(surface) {
        this.world = { ...surface, heights: flattenWater(surface.heights, surface.classes, surface.res), spacing: 2 * surface.radius / (surface.res - 1) };
    }
    sampleRange(s) {
        let lo = Infinity, hi = -Infinity;
        const half = (s.res - 1) / 2;
        for (let y = 0; y < s.res; ++y) for (let x = 0; x < s.res; ++x) {
            if ((x - half) ** 2 + (y - half) ** 2 > half * half) continue;
            const h = s.heights[y * s.res + x]; if (h < lo) lo = h; if (h > hi) hi = h;
        }
        return [lo, hi];
    }
    setSnapshot(snap) {
        const now = performance.now();
        if (this.snapshot && snap.tick !== this.lastTick && this.lastTick >= 0) {
            const steps = Math.max(1, snap.tick - this.lastTick), measured = clamp((now - this.snapshotAt) / steps, 5, 1000);
            this.tickInterval += 0.25 * (measured - this.tickInterval);
        }
        if (!this.snapshot || snap.tick !== this.lastTick) { this.tickAt = now; }
        this.lastTick = snap.tick;
        this.snapshot = snap; this.snapshotAt = now;
    }
    setWeather(w) { if (w) this.weather = w; }

    // ---------------------------------------------------------------- the window and camera
    windowRadius() { return this.displayedRadius > 0 ? this.displayedRadius : (this.coarse?.radius || 1); }
    pan() { return this.windowLat === null || !this.coarse ? { x: 0, y: 0 } : metresBetween(this.coarse.lat, this.coarse.lon, this.windowLat, this.windowLon); }

    frame(cssW, cssH) {
        const c = this.coarse;
        const f = { cssW, cssH, yaw: this.yaw, pitch: this.pitch };
        const wide = this.world && (this.world.classes || !c.classes) && this.options.detail !== null ? this.world : null;
        const surface = wide || c;
        f.surface = surface;
        f.simRadius = c.radius; f.windowRadius = this.windowRadius(); f.pan = this.pan();
        const half = (surface.res - 1) / 2;
        let offset = { x: 0, y: 0 };
        if (wide) offset = metresBetween(surface.lat, surface.lon, c.lat, c.lon);
        f.centreGX = half + (offset.x + f.pan.x) / surface.spacing;
        f.centreGY = half + (offset.y + f.pan.y) / surface.spacing;
        f.gridPerUnit = f.windowRadius / surface.spacing;
        f.spacing = surface.spacing;
        f.res = surface.res;

        // The highest and lowest ground in the window (sampled).
        let lo = Infinity, hi = -Infinity;
        for (let iy = -10; iy <= 10; ++iy) for (let ix = -10; ix <= 10; ++ix) {
            const nx = ix * 0.1, nz = iy * 0.1;
            if (nx * nx + nz * nz > 1) continue;
            const gx = f.centreGX + nx * f.gridPerUnit, gy = f.centreGY + nz * f.gridPerUnit;
            if (gx < 0 || gy < 0 || gx > surface.res - 1 || gy > surface.res - 1) continue;
            const h = this.heightAt(surface, gx, gy); if (h < lo) lo = h; if (h > hi) hi = h;
        }
        if (lo > hi) { lo = c.minH; hi = c.maxH; }
        f.minH = lo; f.maxH = hi; f.range = Math.max(0.01, hi - lo);
        f.targetMid = 0.5 * (lo + hi);
        f.targetExag = clamp(K.reliefTarget * f.windowRadius / f.range, 1, K.maxExaggeration);
        f.mid = Number.isFinite(this.shownMid) ? this.shownMid : f.targetMid;
        f.exag = Number.isFinite(this.shownExag) ? this.shownExag : f.targetExag;
        f.sceneHeight = m => (m - f.mid) / f.windowRadius * f.exag;
        f.baseY = f.sceneHeight(f.minH) - K.skirtDepth;
        f.hikerHeight = Math.max(K.minHikerHeight, K.hikerHeightAtReference * Math.sqrt(K.referenceRadius / f.windowRadius));

        // Camera
        const d = K.baseCameraDistance / this.zoom, sp = Math.sin(this.pitch), cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        f.distance = d;
        f.right = [cy, 0, sy]; f.up = [sp * sy, cp, -sp * cy]; f.forward = [-sy * cp, sp, cy * cp];
        f.focal = 0.5 * Math.min(cssW, cssH) / K.tanHalfFov;
        f.eye = f.forward.map(v => v * d);
        f.focalSky = f.focal;
        const near = 0.05, far = 60, A = -(far + near) / (far - near), B = -2 * far * near / (far - near);
        const sx = f.focal / (cssW / 2), syy = f.focal / (cssH / 2);
        const rows = [
            [f.right[0] * sx, f.right[1] * sx, f.right[2] * sx, 0],
            [f.up[0] * syy, f.up[1] * syy, f.up[2] * syy, 0],
            [f.forward[0] * A, f.forward[1] * A, f.forward[2] * A, -A * d + B],
            [-f.forward[0], -f.forward[1], -f.forward[2], d],
        ];
        f.viewProj = new Float32Array(16);
        for (let r = 0; r < 4; ++r) for (let col = 0; col < 4; ++col) f.viewProj[col * 4 + r] = rows[r][col];

        f.heightAt = (nx, nz) => this.heightAt(surface, f.centreGX + nx * f.gridPerUnit, f.centreGY + nz * f.gridPerUnit);
        f.surfaceY = (nx, nz) => f.sceneHeight(f.heightAt(nx, nz));
        f.project = (x, y, z) => {
            const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
            const depth = Math.max(0.05, d - y * sp - z1 * cp), cyv = y * cp - z1 * sp, s = f.focal / depth;
            return { x: cssW / 2 + x1 * s, y: cssH / 2 - cyv * s, depth };
        };
        f.projectSurface = (nx, nz, lift = 0) => f.project(nx, f.surfaceY(nx, nz) + lift, nz);
        f.simToWindow = (sx2, sy2) => ({ x: (sx2 * f.simRadius - f.pan.x) / f.windowRadius, y: (sy2 * f.simRadius - f.pan.y) / f.windowRadius });
        f.windowToSim = (wx, wz) => ({ x: (wx * f.windowRadius + f.pan.x) / f.simRadius, y: (wz * f.windowRadius + f.pan.y) / f.simRadius });
        const simHalf = (c.res - 1) / 2;
        f.gridToWindow = (gx, gy) => f.simToWindow((gx - simHalf) / simHalf, (gy - simHalf) / simHalf);
        return f;
    }

    heightAt(s, gx, gy) {
        const res = s.res;
        gx = clamp(gx, 0, res - 1); gy = clamp(gy, 0, res - 1);
        const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(x0 + 1, res - 1), y1 = Math.min(y0 + 1, res - 1), fx = gx - x0, fy = gy - y0, h = s.heights;
        const a = h[y0 * res + x0], b = h[y0 * res + x1], c = h[y1 * res + x0], d = h[y1 * res + x1];
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }

    // ---------------------------------------------------------------- mouse
    attach() {
        const el = this.overlay;
        el.addEventListener('pointerdown', e => this.pointerDown(e));
        el.addEventListener('pointermove', e => this.pointerMove(e));
        el.addEventListener('pointerup', e => this.pointerUp(e));
        el.addEventListener('pointerleave', () => { this.hover = null; });
        el.addEventListener('wheel', e => { this.lastInteraction = performance.now(); e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
        el.addEventListener('dblclick', () => this.resetView());
        el.addEventListener('contextmenu', e => e.preventDefault());
        this.pointers = new Map();
    }
    isPanning() { const d = this.dragging; return !!d && (d.pan || (d.pinch && d.moved)); }
    zoomBy(factor) { this.zoom = clamp(this.zoom * factor, 0.5, 3); }
    resetView() { this.yaw = 0; this.pitch = K.defaultPitch; this.zoom = 1; }
    local(e) { const r = this.overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    pointerDown(e) {
        this.lastInteraction = performance.now();
        this.overlay.setPointerCapture(e.pointerId);
        const p = this.local(e);
        this.pointers.set(e.pointerId, p);
        const f = this.lastFrame;
        if (this.pointers.size === 2) {
            // Two fingers: pinch to zoom, twist to turn, and drag to slide the map (moves the window over the land, like Option-drag).
            if (this.dragging?.pan) this.commitPan();
            const c = this.pinchCentre(), g = f && this.windowLat !== null ? this.pickPlane(f, c) : null;
            this.marquee = null;
            this.dragging = { pinch: true, dist: this.pinchDistance(), zoom: this.zoom, angle: this.pinchAngle(), yaw: this.yaw, moved: false };
            if (g) { const grab = offsetLatLon(this.windowLat, this.windowLon, g.x * f.windowRadius, g.y * f.windowRadius); this.dragging.grabLat = grab.lat; this.dragging.grabLon = grab.lon; }
            return;
        }
        if (this.pointers.size > 2) return;
        if (!f) return;
        const base = { start: p, last: p, moved: false, travel: 0 };
        if (e.altKey) {
            const g = this.pickPlane(f, p);
            if (g) {
                const centre = { lat: this.windowLat, lon: this.windowLon };
                const grab = offsetLatLon(centre.lat, centre.lon, g.x * f.windowRadius, g.y * f.windowRadius);
                this.stopFollow?.();
                this.dragging = { ...base, pan: true, grabLat: grab.lat, grabLon: grab.lon };
            }
            return;
        }
        if (e.metaKey || e.ctrlKey || this.selectMode) { this.dragging = { ...base, marquee: true, additive: e.shiftKey || this.selectMode }; this.marquee = { a: p, b: p }; return; }
        const hit = this.hikerAt(f, p);
        if (this.mode === 'manage') {
            if (hit) this.dragging = { ...base, hiker: hit };
            else {
                const g = this.pickGround(f, p);
                if (g) this.emit('addHiker', f.windowToSim(g.x, g.z));
            }
            return;
        }
        if (hit && this.selected.has(hit)) { this.dragging = { ...base, hiker: hit, fromRotate: true }; return; }   // a selected hiker can be dragged, even here
        this.dragging = { ...base, orbit: true, clickedHiker: hit };
    }

    pinchDistance() { const [a, b] = [...this.pointers.values()]; return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); }
    pinchAngle() { const [a, b] = [...this.pointers.values()]; return Math.atan2(b.y - a.y, b.x - a.x); }
    pinchCentre() { const [a, b] = [...this.pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

    pointerMove(e) {
        if (this.pointers.size) this.lastInteraction = performance.now();
        const p = this.local(e);
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
        const f = this.lastFrame;
        const d = this.dragging;
        if (d?.pinch && this.pointers.size === 2) {
            this.zoom = clamp(d.zoom * this.pinchDistance() / d.dist, 0.5, 3);
            let turn = this.pinchAngle() - d.angle; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
            if (Math.abs(turn) > 0.05 || d.turning) { d.turning = true; this.yaw = d.yaw - turn; }   // ignore tiny twists so a plain pinch stays steady
            if (f && d.grabLat !== undefined && !this.follow) {
                const g = this.pickPlane(f, this.pinchCentre());
                if (g) { d.moved = true; this.limitWindow(offsetLatLon(d.grabLat, d.grabLon, -g.x * f.windowRadius, -g.y * f.windowRadius)); }
            }
            return;
        }
        if (!d) {
            if (f && this.mode === 'manage') { const hit = this.hikerAt(f, p); this.hover = hit ? { hiker: hit } : { ground: this.pickGround(f, p) }; }
            return;
        }
        d.travel += Math.abs(p.x - d.last.x) + Math.abs(p.y - d.last.y);
        if (d.travel > 4) d.moved = true;
        if (d.pan && f) {
            const g = this.pickPlane(f, p);
            if (g) {
                const centre = offsetLatLon(d.grabLat, d.grabLon, -g.x * f.windowRadius, -g.y * f.windowRadius);
                this.limitWindow(centre);
            }
        } else if (d.marquee) {
            this.marquee.b = p;
        } else if (d.hiker) {
            if (d.moved) { const g = this.pickGround(f, p); if (g) { const s = f.windowToSim(g.x, g.z); this.emit('moveHiker', d.hiker, s.x, s.y); } }
        } else if (d.orbit) {
            this.yaw += (p.x - d.last.x) * 0.008;
            this.pitch = clamp(this.pitch + (p.y - d.last.y) * 0.008, K.minPitch, K.maxPitch);
        }
        d.last = p;
    }

    // Keep the window on the wide copy of the land.
    limitWindow(centre) {
        const w = this.world, c = this.coarse;
        if (w) {
            const rel = metresBetween(w.lat, w.lon, centre.lat, centre.lon), longest = Math.max(0, 0.97 * w.radius - this.windowRadius()), len = Math.hypot(rel.x, rel.y);
            if (len > longest) { const s = longest / len; const o = offsetLatLon(w.lat, w.lon, rel.x * s, rel.y * s); centre = o; }
        } else {
            const rel = metresBetween(c.lat, c.lon, centre.lat, centre.lon), longest = 2.2 * this.windowRadius(), len = Math.hypot(rel.x, rel.y);
            if (len > longest) { const s = longest / len; centre = offsetLatLon(c.lat, c.lon, rel.x * s, rel.y * s); }
        }
        this.windowLat = centre.lat; this.windowLon = centre.lon;
    }

    pointerUp(e) {
        this.pointers.delete(e.pointerId);
        const d = this.dragging, f = this.lastFrame;
        if (!d) return;
        if (d.pinch) { if (this.pointers.size < 2) { if (d.moved) this.commitPan(); this.dragging = null; } return; }
        if (d.pan) this.commitPan();
        else if (d.marquee) {
            const box = this.marquee, x0 = Math.min(box.a.x, box.b.x), x1 = Math.max(box.a.x, box.b.x), y0 = Math.min(box.a.y, box.b.y), y1 = Math.max(box.a.y, box.b.y);
            const hits = new Set();
            if (x1 - x0 < 4 && y1 - y0 < 4) { const h = this.hikerAt(f, d.start); if (h) hits.add(h); }
            else for (const h of this.visibleHikers(f)) if (h.sx >= x0 && h.sx <= x1 && h.sy >= y0 && h.sy <= y1) hits.add(h.channel);
            if (this.selectMode && hits.size === 0 && x1 - x0 < 4 && y1 - y0 < 4) { this.selected = new Set(); this.emit('selection', []); this.marquee = null; this.dragging = null; return; }
            let next = d.additive ? new Set(this.selected) : new Set();
            if (d.additive && hits.size === 1 && x1 - x0 < 4) { const h = [...hits][0]; if (next.has(h)) next.delete(h); else next.add(h); }
            else for (const h of hits) next.add(h);
            this.selected = next; this.emit('selection', [...next]);
            this.marquee = null;
        } else if (d.hiker) {
            if (!d.moved) { if (d.fromRotate) this.emit('previewNote', d.hiker); else this.emit('removeHiker', d.hiker); }
        } else if (d.orbit && !d.moved && d.clickedHiker) {
            this.emit('previewNote', d.clickedHiker);
            if (this.touch) { this.selected = new Set([d.clickedHiker]); this.emit('selection', [d.clickedHiker]); }   // a tap on a hiker also picks it
        } else if (d.orbit && !d.moved) this.emit('tap');
        this.dragging = null;
    }

    commitPan() {
        const c = this.coarse;
        if (this.windowLat === null || !c) return;
        const from = this.commitPending ? { lat: this.sentLat, lon: this.sentLon } : { lat: c.lat, lon: c.lon };
        const move = metresBetween(from.lat, from.lon, this.windowLat, this.windowLon);
        if (Math.hypot(move.x, move.y) < 0.5) return;
        this.sentLat = this.windowLat; this.sentLon = this.windowLon; this.commitPending = true;
        this.emit('pan', move.x, move.y);
    }

    // ---------------------------------------------------------------- picking
    ray(f, p) {
        const a = (p.x - f.cssW / 2) / f.focal, b = (f.cssH / 2 - p.y) / f.focal;
        // camera-space direction (right, up, toward the scene) -> world
        const dir = [0, 1, 2].map(i => f.right[i] * a + f.up[i] * b - f.forward[i]);
        const len = Math.hypot(...dir);
        return { o: f.eye, d: dir.map(v => v / len) };
    }
    pickPlane(f, p) {
        const r = this.ray(f, p);
        if (r.d[1] > -0.02) return null;
        const t = -r.o[1] / r.d[1];
        return { x: r.o[0] + r.d[0] * t, y: r.o[2] + r.d[2] * t };
    }
    pickGround(f, p) {
        const r = this.ray(f, p);
        let prev = null;
        for (let t = 0.05; t < f.distance + 3; t += 0.02) {
            const x = r.o[0] + r.d[0] * t, y = r.o[1] + r.d[1] * t, z = r.o[2] + r.d[2] * t;
            if (x * x + z * z > 1) { prev = null; continue; }
            const above = y - f.surfaceY(x, z);
            if (prev !== null && prev > 0 && above <= 0) return { x, z };
            prev = above;
        }
        return null;
    }
    visibleHikers(f) {
        const out = [];
        if (!this.snapshot) return out;
        for (const h of this.snapshot.hikers) {
            const g = this.glidePosition(h);
            const w = f.gridToWindow(g.x, g.y);
            if (w.x * w.x + w.y * w.y > 1.02) continue;
            const b = f.projectSurface(w.x, w.y, f.hikerHeight * 0.5);
            out.push({ channel: h.channel, sx: b.x, sy: b.y, depth: b.depth, reach: Math.max(12, f.hikerHeight * 0.6 * f.focal / b.depth), w });
        }
        return out;
    }
    hikerAt(f, p) {
        let best = null, bestD = Infinity;
        for (const h of this.visibleHikers(f)) { const d = Math.hypot(h.sx - p.x, h.sy - p.y); if (d <= h.reach && d < bestD) { best = h.channel; bestD = d; } }
        return best;
    }

    glidePosition(h) {
        const g = this.glide.get(h.channel);
        if (!g) return { x: h.x, y: h.y };
        const t = clamp((performance.now() - this.tickAt) / Math.max(5, this.tickInterval), 0, 1);
        return { x: g.prev.x + (g.last.x - g.prev.x) * t, y: g.prev.y + (g.last.y - g.prev.y) * t };
    }
    updateGlide() {
        const s = this.snapshot; if (!s) return;
        if (this.glideTick === s.tick) return;
        this.glideTick = s.tick;
        const jump = 0.2 * this.coarse.res;
        const live = new Set();
        for (const h of s.hikers) {
            live.add(h.channel);
            const g = this.glide.get(h.channel);
            if (!g || Math.hypot(h.x - g.last.x, h.y - g.last.y) > jump) this.glide.set(h.channel, { prev: { x: h.x, y: h.y }, last: { x: h.x, y: h.y } });
            else { g.prev = g.last; g.last = { x: h.x, y: h.y }; }
        }
        for (const ch of [...this.glide.keys()]) if (!live.has(ch)) this.glide.delete(ch);
    }
}

export { K, clamp, speedFeel, TAU, HALF_PI };
