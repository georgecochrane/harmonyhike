// Turning the state of the world into a picture: assembles what the renderer draws each frame, and the 2D overlay on top (hiker numbers,
// selection rings, compass, legend, captions).
import { View, K, clamp, speedFeel, TAU, HALF_PI, sunPosition, daylightFactor } from './view.js';

const SKIES = ['belfast_sunset', 'farm_field', 'kloofendal_48d_partly_cloudy', 'kloofendal_overcast', 'kloppenheim_05', 'qwantani_dusk_2', 'sunflowers', 'wasteland_clouds'];
const LAND_NAMES = ['Nature', 'Farmland', 'Town', 'Water'];
const LAND_COLOURS = ['#5a6e3a', '#b2c45c', '#c4ac94', '#367ac4'];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

import { leafState } from './season.js';
Object.assign(View.prototype, {
    skyNames: SKIES,

    chooseSky(name) { this.skyChoice = name; },

    updateEasing(dt) {
        const wanted = this.wantedRadius > 0 ? this.wantedRadius : this.coarse.radius;
        if (!this.displayedRadius) this.displayedRadius = this.coarse.radius;
        const blend = 1 - Math.exp(-10 * dt);
        this.displayedRadius = Math.exp(Math.log(this.displayedRadius) + (Math.log(wanted) - Math.log(this.displayedRadius)) * blend);
        if (Math.abs(Math.log(wanted / this.displayedRadius)) < 0.0005) this.displayedRadius = wanted;
    },

    draw(now) {
        if (!this.coarse) return;
        const r = this.renderer, dt = this.lastFrameMs ? clamp((now - this.lastFrameMs) / 1000, 0, 0.1) : 0;
        this.lastFrameMs = now;
        const dpr = r.resize();
        const cssW = this.canvas.clientWidth, cssH = this.canvas.clientHeight;
        if (this.overlay.width !== r.canvas.width || this.overlay.height !== r.canvas.height) { this.overlay.width = r.canvas.width; this.overlay.height = r.canvas.height; }
        this.updateEasing(dt);
        this.updateGlide();

        const f = this.frame(cssW, cssH);
        this.lastFrame = f;
        f.cssWidth = cssW;

        // The relief scaling eases to what this ground calls for.
        if (!Number.isFinite(this.shownMid)) { this.shownMid = f.targetMid; this.shownExag = f.targetExag; }
        else {
            const blend = 1 - Math.exp(-6 * dt);
            this.shownMid += (f.targetMid - this.shownMid) * blend; this.shownExag += (f.targetExag - this.shownExag) * blend;
            if (Math.abs(f.targetMid - this.shownMid) < 0.01) this.shownMid = f.targetMid;
            if (Math.abs(f.targetExag - this.shownExag) < 0.001) this.shownExag = f.targetExag;
        }

        // Tell whoever is loading land where the window is.
        this.emit('window', { lat: this.windowLat, lon: this.windowLon, wantedRadius: this.wantedRadius > 0 ? this.wantedRadius : this.coarse.radius });

        r.setSurface({ key: f.surface.key, res: f.surface.res, heights: f.surface.heights, classes: f.surface.classes });

        // Light, and the sky to go with it
        const unix = this.fixedTime ?? Date.now() / 1000;
        let light = [-0.5, 0.75, -0.5], daylight = 1;
        if (this.options.realLight) {
            const sun = sunPosition(this.coarse.lat, this.coarse.lon, unix);
            daylight = daylightFactor(sun.elevation);
            const e = Math.max(sun.elevation, 0.12);
            light = [Math.sin(sun.azimuth) * Math.cos(e), Math.sin(e), -Math.cos(sun.azimuth) * Math.cos(e)];
            const deg = sun.elevation * 57.29578, cover = this.weather.cloudCover;
            const wanted = deg < -3 ? 'qwantani_dusk_2' : deg < 9 ? 'belfast_sunset' : cover > 0.75 ? 'kloofendal_overcast' : cover > 0.35 ? 'kloofendal_48d_partly_cloudy' : 'sunflowers';
            if (r.skyName !== wanted && this.skyLoading !== wanted) { this.skyLoading = wanted; r.loadSky(wanted).then(() => { this.skyLoading = null; }); }
            this.skyFollows = true;
        } else if (this.skyFollows || !r.skyName) {
            const name = this.skyChoice || SKIES[Math.floor(Math.random() * SKIES.length)];
            this.skyChoice = name;
            if (r.skyName !== name && this.skyLoading !== name) { this.skyLoading = name; r.loadSky(name).then(() => { this.skyLoading = null; }); }
            this.skyFollows = false;
        }
        const len = Math.hypot(...light); light = light.map(v => v / len);
        f.light = new Float32Array(light);

        f.window = { centreGX: f.centreGX, centreGY: f.centreGY, gridPerUnit: f.gridPerUnit, spacing: f.spacing, mid: f.mid, exag: f.exag, radius: f.windowRadius, minH: f.minH, range: f.range, baseY: f.baseY };
        f.tint = daylight < 1 ? [8 / 255, 14 / 255, 40 / 255, 0.62 * (1 - daylight)] : null;
        f.camRight = new Float32Array(f.right); f.camUp = new Float32Array(f.up);

        f.trees = this.options.trees === false ? null : this.buildTrees(f, now);
        const items = this.buildFigures(f, dt, now);
        f.hikers = items.hikers; f.animals = items.animals; f.glows = items.glows;
        f.clouds = this.buildClouds(f, dt, light, daylight);
        this.reportWater(f, now);
        r.render(f);
        this.drawOverlay(f, items, dpr);
    },

    // The forest for the land being drawn: per tree, where it stands, how big, and its colours for the season (data for the renderer's instancing).
    buildTrees(f, now) {
        const surface = f.surface;
        if (!surface.classes) return null;
        if (surface.trees === undefined) surface.trees = this.treeGen ? this.treeGen(surface) : null;
        const list = surface.trees;
        if (!list || !list.length) return null;
        const n = list.length / 6, leaves = leafState(this.coarse.lat), w = this.weather || { windMetersPerSecond: 3, windFromDegrees: 270 };
        const toward = (w.windFromDegrees + 180) * Math.PI / 180;
        const sway = clamp(0.03 + 0.012 * w.windMetersPerSecond, 0.03, 0.13);
        const baseH = 1.3 * f.hikerHeight;
        const conifer = new Float32Array(n * 9), broad = new Float32Array(n * 9);
        let nc = 0, nb = 0;
        const mix = (a, b, t) => a + (b - a) * t;
        for (let i = 0; i < n; ++i) {
            const gx = list[i * 6], gy = list[i * 6 + 1], size = list[i * 6 + 2], kind = list[i * 6 + 3], hue = list[i * 6 + 4], phase = list[i * 6 + 5];
            const x = (gx - f.centreGX) / f.gridPerUnit, z = (gy - f.centreGY) / f.gridPerUnit;
            if (x * x + z * z > 0.98) continue;
            let r, g, b, height, radius;
            const bare = kind === 1 ? 0 : 1 - leaves.foliage;
            if (kind === 1) { r = 0.10 + 0.06 * hue; g = 0.30 + 0.08 * hue; b = 0.19 + 0.05 * hue; height = baseH * size * 1.25; radius = height * 0.30; }
            else {
                r = 0.22 + 0.08 * hue; g = 0.48 + 0.10 * hue; b = 0.18;
                const sp = leaves.spring * 0.8; r = mix(r, 0.50, sp); g = mix(g, 0.72, sp); b = mix(b, 0.24, sp);
                const t = hue < 0.4 ? [0.90, 0.70, 0.14] : hue < 0.75 ? [0.85, 0.42, 0.12] : [0.70, 0.20, 0.12];
                r = mix(r, t[0], leaves.autumn); g = mix(g, t[1], leaves.autumn); b = mix(b, t[2], leaves.autumn);
                r = mix(r, 0.40, bare); g = mix(g, 0.34, bare); b = mix(b, 0.28, bare);
                height = baseH * size * (1 - 0.25 * bare); radius = height * 0.36 * (1 - 0.45 * bare);
            }
            const arr = kind === 1 ? conifer : broad, at = (kind === 1 ? nc++ : nb++) * 9;
            arr[at] = x; arr[at + 1] = f.surfaceY(x, z); arr[at + 2] = z; arr[at + 3] = height; arr[at + 4] = radius;
            arr[at + 5] = r; arr[at + 6] = g; arr[at + 7] = b; arr[at + 8] = phase;
        }
        return { conifer: conifer.subarray(0, nc * 9), nConifer: nc, broad: broad.subarray(0, nb * 9), nBroad: nb, sway, windX: Math.sin(toward), windZ: -Math.cos(toward), time: now / 1000 };
    },

    buildFigures(f, dt, now) {
        const s = this.snapshot, hikers = [], animals = [], glows = [], labels = [], model = this.renderer.models;
        if (!s || !model) return { hikers, animals, glows, labels };
        const nowMs = now;
        // Hikers
        for (const h of s.hikers) {
            const g = this.glidePosition(h), w = f.gridToWindow(g.x, g.y);
            const ch = h.channel;
            let head = this.heading.get(ch);
            if (head === undefined) head = h.heading;
            let diff = ((h.heading - head + Math.PI) % TAU + TAU) % TAU - Math.PI;
            head += diff * Math.min(1, dt * 8); this.heading.set(ch, head);
            const cycles = h.speed > 0 ? K.minCycles + (K.maxCycles - K.minCycles) * speedFeel(h.speed) : 0;
            this.stride.set(ch, ((this.stride.get(ch) || 0) + TAU * cycles * dt) % TAU);
            if (w.x * w.x + w.y * w.y > 1.02) continue;
            const groundY = f.surfaceY(w.x, w.y);
            hikers.push({ channel: ch, x: w.x, z: w.y, groundY, yaw: HALF_PI - head, scale: f.hikerHeight / 2.0, swing: K.limbSwing * Math.sin(this.stride.get(ch)) });
            const head3 = f.project(w.x, groundY + f.hikerHeight, w.y);
            labels.push({ channel: ch, x: head3.x, y: head3.y - 10 });
            const age = h.noteAge, length = h.noteSeconds;
            if (this.options.overlays.glows && age < length) {
                const u = age / length;
                glows.push({ x: w.x, y: groundY + 0.003, z: w.y, radius: f.hikerHeight * (1 + 0.45 * u), colour: [1, 0.925, 0.667], intensity: Math.pow(1 - u, 1.6) });
            }
        }
        // Animals
        const hikerH = f.hikerHeight;
        const size = (type, sizeScale = 1) => {
            const m = this.renderer.animals[type]?.model; if (!m) return 0;
            const ratio = m.realHeight / 1.75;
            return sizeScale * Math.max(hikerH * ratio, K.minAnimalHeight * Math.sqrt(ratio)) / m.heightUnits;
        };
        if (this.animalStride.length !== s.animals.length) this.animalStride = new Array(s.animals.length).fill(0);
        s.animals.forEach((a, i) => {
            const moving = a.speed > 0;
            if (moving) this.animalStride[i] = (this.animalStride[i] + dt * (9 + 2 * a.speed)) % TAU;
            const w = f.gridToWindow(a.x, a.y);
            if (w.x * w.x + w.y * w.y > 1.02) return;
            animals.push({ type: a.type, x: w.x, z: w.y, y: f.surfaceY(w.x, w.y), yaw: HALF_PI - a.heading, scale: size(a.type), legSwing: moving ? 0.7 * Math.sin(this.animalStride[i]) : 0 });
        });

        // Birds on the wing: they flap (a quick bob), flap harder just after calling out, and cast no shadow on purpose (they are high up).
        const skyY = f.sceneHeight(f.maxH);   // birds fly in the sky: above the highest ground, not following the hills
        for (const b of s.birds || []) {
            const w = f.gridToWindow(b.x, b.y);
            if (w.x * w.x + w.y * w.y > 1.02) continue;
            const flap = Math.sin(b.phase);
            animals.push({ type: 9, x: w.x, z: w.y, y: skyY + b.altitude + 0.006 * flap, yaw: HALF_PI - b.heading, scale: size(9) * (0.6 + 0.14 * b.excitement), legSwing: 0.9 * flap, tilt: (0.18 + 0.22 * b.excitement) * flap });
        }

        // Fish that leap from the water now and then
        this.updateWaterCells();
        if (this.waterCells.length && nowMs / 1000 >= this.nextFish && this.fish.length < 3) {
            const cell = this.waterCells[Math.floor(Math.random() * this.waterCells.length)], jitter = 2 / Math.max(1, this.coarse.res - 1);
            this.fish.push({ x: cell.x + (Math.random() - 0.5) * jitter, z: cell.y + (Math.random() - 0.5) * jitter, heading: Math.random() * TAU, start: nowMs / 1000, hue: Math.random(), brightness: 0.75 + 0.5 * Math.random(), landed: false });
            this.nextFish = nowMs / 1000 + 3.5 + Math.random() * 3;
        }
        const fishModel = this.renderer.animals[10]?.model;
        if (fishModel) {
            const fishRatio = fishModel.realHeight / 1.75;
            const fishHeight = K.fishScale * Math.max(hikerH * fishRatio, K.minAnimalHeight * Math.sqrt(fishRatio));
            for (let i = this.fish.length - 1; i >= 0; --i) {
                const j = this.fish[i], age = nowMs / 1000 - j.start;
                if (age > 0.95 + 0.6) { this.fish.splice(i, 1); continue; }
                const fp = f.simToWindow(j.x, j.z);
                if (fp.x * fp.x + fp.y * fp.y > 1.1) continue;
                const travel = 3 * fishHeight, jump = 2.4 * fishHeight, dx = Math.cos(j.heading) * travel * 0.5, dz = Math.sin(j.heading) * travel * 0.5;
                const surface = f.surfaceY(fp.x, fp.y);
                if (age <= 0.95) {
                    const t = age / 0.95, lift = jump * 4 * t * (1 - t), tilt = Math.atan2(4 * jump * (1 - 2 * t), travel);
                    animals.push({ type: 10, x: fp.x + dx * (2 * t - 1), z: fp.y + dz * (2 * t - 1), y: surface + lift, yaw: HALF_PI - j.heading, scale: K.fishScale * fishHeight / K.fishScale / fishModel.heightUnits, tilt, hue: j.hue, brightness: j.brightness });
                }
                if (age >= 0.95 && !j.landed) {
                    j.landed = true;
                    const where = f.project(fp.x + dx, surface, fp.y + dz);
                    this.emit('splash', clamp((where.x - f.cssW / 2) / Math.max(1, f.cssW / 2), -1, 1));
                }
                const ring = (cx, cz, since) => {
                    if (since < 0 || since > 0.55) return;
                    const u = since / 0.55;
                    glows.push({ x: cx, y: surface + 0.003, z: cz, radius: (0.5 + 1.1 * u) * fishHeight, colour: [0.88, 0.94, 1], intensity: (1 - u) * 0.9 });
                };
                ring(fp.x - dx, fp.y - dz, age); ring(fp.x + dx, fp.y + dz, age - 0.95);
            }
        }
        return { hikers, animals, glows, labels };
    },

    updateWaterCells() {
        const c = this.coarse;
        if (!c.classes) { this.waterCells = []; this.waterKey = ''; return; }
        const key = c.key + '|' + c.res;
        if (key === this.waterKey) return;
        this.waterKey = key;
        this.waterCells = [];
        this.fish = [];
        const half = (c.res - 1) / 2;
        for (let y = 0; y < c.res; ++y) for (let x = 0; x < c.res; ++x)
            if ((x - half) ** 2 + (y - half) ** 2 <= half * half && c.classes[y * c.res + x] === 3) this.waterCells.push({ x: (x - half) / half, y: (y - half) / half });
    },

    reportWater(f, now) {
        if (now - (this.lastWaterReport || 0) < 100) return;
        this.lastWaterReport = now;
        const c = this.coarse, cellSize = 2 / Math.max(1, c.res - 1) * f.simRadius / f.windowRadius;
        let coverage = 0, sumX = 0, weight = 0;
        for (const wc of this.waterCells) {
            const w = f.simToWindow(wc.x, wc.y);
            if (w.x * w.x + w.y * w.y > 1) continue;
            const p = f.projectSurface(w.x, w.y);
            if (p.x < 0 || p.x > f.cssW || p.y < 0 || p.y > f.cssH) continue;
            const size = cellSize * f.focal / p.depth, area = size * size;
            coverage += area; sumX += p.x * area; weight += area;
        }
        const amount = clamp(Math.sqrt(coverage / (f.cssW * f.cssH)) * 1.8, 0, 1);
        const pan = weight > 0 ? clamp((sumX / weight - f.cssW / 2) / (f.cssW / 2), -1, 1) : 0;
        const share = this.waterCells.length / Math.max(1, 0.785 * c.res * c.res);
        this.emit('water', amount, pan, clamp((share - 0.03) / 0.1, 0, 1));
        if (this.snapshot) {
            const pans = [];
            for (const h of this.snapshot.hikers) { const g = this.glidePosition(h), w = f.gridToWindow(g.x, g.y), p = f.projectSurface(w.x, w.y); pans.push([h.channel, (p.x - f.cssW / 2) / Math.max(1, f.cssW / 2)]); }
            this.emit('hikerPans', pans);
        }
    },

    buildClouds(f, dt, light, daylight) {
        const opacity = clamp(this.options.cloudOpacity, 0, 1);
        const empty = { count: 0 };
        if (opacity <= 0) return empty;
        const HALF = 1.5, COUNT = 60;
        if (!this.cloudLayout) {
            let seed = 20260919; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
            this.cloudLayout = [];
            for (let i = 0; i < COUNT; ++i) {
                const c = { x: (rnd() - 0.5) * 2 * HALF, z: (rnd() - 0.5) * 2 * HALF, altitude: 0.32 + 0.5 * rnd(), puffs: [] };
                const size = 0.10 + 0.15 * rnd();
                for (let k = 0; k < 9; ++k) {
                    const angle = TAU * rnd(), reach = size * 1.6 * Math.sqrt(rnd()), rise = size * (0.9 * (1 - reach / (size * 1.6)) + 0.25 * rnd());
                    c.puffs.push({ x: Math.cos(angle) * reach, z: Math.sin(angle) * reach, altitude: rise - 0.2 * size, radius: size * (0.55 + 0.45 * rnd()) });
                }
                this.cloudLayout.push(c);
            }
        }
        const w = this.weather, toward = (w.windFromDegrees + 180) * Math.PI / 180;
        const speed = clamp(w.windMetersPerSecond / f.windowRadius * 10, 0.004, 0.06);
        this.cloudDrift.x += Math.sin(toward) * speed * dt; this.cloudDrift.y += -Math.cos(toward) * speed * dt;
        const visible = Math.round(w.cloudCover * COUNT);
        const wrap = v => ((v + HALF) % (2 * HALF) + 2 * HALF) % (2 * HALF) - HALF;
        const puffs = [];
        for (let i = 0; i < visible; ++i) {
            const c = this.cloudLayout[i], cx = wrap(c.x + this.cloudDrift.x), cz = wrap(c.z + this.cloudDrift.y);
            if (cx * cx + cz * cz > 2.56) continue;
            for (const p of c.puffs) {
                const x = cx + p.x, y = c.altitude + p.altitude, z = cz + p.z;
                const depth = f.distance - (y * f.forward[1] + x * f.forward[0] + z * f.forward[2]);
                puffs.push({ x, y, z, r: p.radius, depth, height: clamp((p.altitude / (0.5 * p.radius) + 1) * 0.5, 0, 1) });
            }
        }
        puffs.sort((a, b) => b.depth - a.depth);
        const data = new Float32Array(puffs.length * 6 * 10), corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
        const lx = light[0] * f.right[0] + light[1] * f.right[1] + light[2] * f.right[2], ly = light[0] * f.up[0] + light[1] * f.up[1] + light[2] * f.up[2];
        let n = 0;
        for (const p of puffs) for (const [cx, cz] of corners) { data.set([cx, cz, p.x, p.y, p.z, p.r, lx * 0.6, ly * 0.6, p.height, 0], n); n += 10; }
        const lit = mix([240, 244, 255], [96, 108, 140], 1 - daylight).map(v => v / 255), shade = mix([128, 140, 170], [36, 44, 70], 1 - daylight).map(v => v / 255);
        return { count: puffs.length, data, lit: new Float32Array(lit), shade: new Float32Array(shade), opacity, topY: 1.25 };
    },

    animalStride: [],

    drawOverlay(f, items, dpr) {
        const g = this.overlay.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, f.cssW, f.cssH);
        const o = this.options.overlays;

        if (o.numbers) for (const l of items.labels) {
            g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(l.x, l.y, 7, 0, TAU); g.fill();
            g.fillStyle = '#000'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(l.channel), l.x, l.y + 0.5);
        }
        for (const h of this.visibleHikers(f)) {
            const sel = this.selected.has(h.channel), hovering = this.hover?.hiker === h.channel;
            if (!sel && !hovering) continue;
            g.strokeStyle = hovering && !sel ? '#ff6b6b' : '#4da3ff'; g.lineWidth = sel ? 2.5 : 1.8;
            g.beginPath(); g.arc(h.sx, h.sy, h.reach, 0, TAU); g.stroke();
        }
        if (this.hover?.ground && this.mode === 'manage') { const p = f.projectSurface(this.hover.ground.x, this.hover.ground.z, 0.005); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 9, 0, TAU); g.stroke(); }
        if (this.marquee) {
            const { a, b } = this.marquee;
            g.fillStyle = 'rgba(77,163,255,0.15)'; g.strokeStyle = 'rgba(77,163,255,0.9)'; g.lineWidth = 1;
            g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        }

        if (o.compass) {
            const ins = this.inset || { top: 0, right: 0, bottom: 0, left: 0 };
            const c = { x: f.cssW - 34 - ins.right, y: 34 + ins.top }, origin = f.project(0, 0, 0), north = f.project(0, 0, -0.4);
            let dx = north.x - origin.x, dy = north.y - origin.y; const len = Math.max(1e-3, Math.hypot(dx, dy)); dx /= len; dy /= len;
            g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(c.x, c.y, 22, 0, TAU); g.fill();
            g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.stroke();
            g.strokeStyle = '#ff8a80'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(c.x + dx * 15, c.y + dy * 15); g.stroke();
            g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', c.x + dx * 8 - dy * 9, c.y + dy * 8 + dx * 9 - 2);
        }

        if (o.legend && this.coarse.classes) {
            const present = [false, false, false, false], c = this.coarse, half = (c.res - 1) / 2;
            for (let y = 0; y < c.res - 1; ++y) for (let x = 0; x < c.res - 1; ++x) { if ((x + 0.5 - half) ** 2 + (y + 0.5 - half) ** 2 <= half * half) present[c.classes[y * c.res + x]] = true; }
            const shown = present.map((p, i) => p ? i : -1).filter(i => i >= 0);
            const ins = this.inset || { top: 0, right: 0, bottom: 0, left: 0 };
            const w = 96, hgt = 8 + shown.length * 17, x0 = f.cssW - w - 8 - ins.right, y0 = f.cssH - hgt - 8 - ins.bottom - (this.touch ? 26 : 0);
            g.fillStyle = 'rgba(0,0,0,0.42)'; g.beginPath(); g.roundRect(x0, y0, w, hgt, 6); g.fill();
            shown.forEach((i, k) => { g.fillStyle = LAND_COLOURS[i]; g.fillRect(x0 + 8, y0 + 8 + k * 17, 11, 11); g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '11px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(LAND_NAMES[i], x0 + 26, y0 + 13.5 + k * 17); });
        }

        if (o.captions) {
            const feet = 2 * f.windowRadius * 3.28084, diameter = feet >= 5280 ? (feet / 5280).toFixed(2) + ' mi' : Math.round(feet) + ' ft';
            const reliefFeet = (f.maxH - f.minH) * 3.28084;
            const caption = (text, x, y, alpha) => {
                g.font = '12px system-ui'; const w = g.measureText(text).width + 14;
                g.fillStyle = 'rgba(0,0,0,0.42)'; g.beginPath(); g.roundRect(x, y, w, 18, 5); g.fill();
                g.fillStyle = `rgba(255,255,255,${alpha})`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x + 7, y + 9.5);
            };
            caption(`Diameter ${diameter}   |   relief ${Math.round(reliefFeet)} ft   |   vertical x${f.exag.toFixed(1)}`, 8 + (this.inset?.left || 0), f.cssH - 26 - (this.inset?.bottom || 0), 0.85);
            caption(this.touch
                ? (this.mode === 'rotate' ? 'Drag turns - pinch zooms - 2 fingers slide'
                    : 'Tap a hiker to remove it - drag to move it - tap ground to add')
                : this.mode === 'rotate' ? 'Drag to rotate - scroll or pinch to zoom - Option-drag to pan - click a hiker to hear it - Cmd-click to pick one, Cmd-drag to pick several'
                : 'Click a hiker to remove it, drag it to move it, click the ground to add one - Cmd-click to pick one, Cmd-drag to pick several', 8 + (this.inset?.left || 0), 6 + (this.inset?.top || 0), 0.75);
        }
    },
});

export { SKIES };
