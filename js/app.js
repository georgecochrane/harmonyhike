// HarmonyHike for the web: wires the land, the simulation (in the audio thread), the picture and the controls together.
import { Engine } from './audio.js';
import { Renderer } from './render.js';
import { View, metresBetween, offsetLatLon } from './view.js';
import './scene.js';
import { TerrainSource, proceduralHeights, geocode, fetchWeather, parseLatLon } from './terrain.js';
import { MidiBridge } from './midi.js';
import { el, buildPages, sliderRow, selectRow, toggleRow, buttonRow, twoSelectRow, NOTE_NAMES, SCALES, DIVISIONS } from './ui.js';
import { openSoundDesigner, loadSavedSounds } from './designer.js';
import { openAbout, openTip } from './about.js';
import { runSelfTest } from './selftest.js';
import { initPhone } from './phone.js';
import { randomPlace } from './places.js';

const $ = id => document.getElementById(id);
const FEET = 0.3048;
const WORLD_MARGIN = 5;

const DEFAULTS = {
    numHikers: 6, speed: 35, noteSpeed: 0, gaitMatch: 15, simulationRate: 20, animalDensity: 0.3, scaleType: 3, rootNote: 0, minOctave: 3, maxOctave: 4,
    noteLength: 100, noteLengthRandom: 0, favorRoot: 0, velocity: 100, velocityRandom: 0, paused: 0, arpOn: 0, arpPattern: 0, arpRandom: 0, arpRate: 4,
    arpGate: 70, arpDivision: 5, syncOn: 0, gaitSync: 0, gaitDivision: 5, outputMode: 1, soundVolume: 70, animalLevel: 60, waterLevel: 60,
    // (web only)
    diameterFeet: 5280, terrainDetail: 2, realLight: 0, cloudOpacity: 50,
    overlayGlows: 1, overlayNumbers: 1, overlayCompass: 1, overlayLegend: 1, overlayCaptions: 1,
    location: 'Yosemite Valley', lat: 37.7456, lon: -119.5936,
};
const CORE_PARAMS = ['numHikers', 'speed', 'noteSpeed', 'gaitMatch', 'simulationRate', 'animalDensity', 'scaleType', 'rootNote', 'minOctave', 'maxOctave', 'noteLength', 'noteLengthRandom',
    'favorRoot', 'velocity', 'velocityRandom', 'paused', 'arpOn', 'arpPattern', 'arpRandom', 'arpRate', 'arpGate', 'arpDivision', 'syncOn', 'gaitSync', 'gaitDivision', 'outputMode',
    'soundVolume', 'animalLevel', 'waterLevel'];

window.__errors = []; window.addEventListener('error', e => window.__errors.push(e.message)); window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
const settings = { ...DEFAULTS };
let firstRun = true;
try { const stored = localStorage.getItem('harmonyhike.settings'); if (stored) { Object.assign(settings, JSON.parse(stored)); firstRun = false; } } catch (e) { /* first run */ }
if (firstRun) Object.assign(settings, randomPlace());   // a named, lovely place to begin with
const save = () => { try { localStorage.setItem('harmonyhike.settings', JSON.stringify(settings)); } catch (e) { /* private window */ } };

const engine = new Engine(), midi = new MidiBridge(), terrain = new TerrainSource();
let renderer, view;

// ------------------------------------------------------------------------------------------------ setting things
function setSetting(name, value) {
    settings[name] = value;
    save();
    if (CORE_PARAMS.includes(name)) engine.setParam(name, value);
    switch (name) {
        case 'diameterFeet': view.wantedRadius = 0.5 * value * FEET; scheduleLandReload(); break;
        case 'realLight': view.options.realLight = !!value; break;
        case 'cloudOpacity': view.options.cloudOpacity = value / 100; break;
        case 'terrainDetail': view.world = null; world.pending = false; world.failedAt = -1e9; break;
        case 'overlayGlows': case 'overlayNumbers': case 'overlayCompass': case 'overlayLegend': case 'overlayCaptions':
            view.options.overlays[name.slice(7).toLowerCase()] = !!value; break;
        case 'outputMode': if (value === 1) midi.allNotesOff(); break;
        case 'paused': $('pause').textContent = value ? 'Resume' : 'Pause'; $('pause').classList.toggle('on', !!value); break;
    }
}

// ------------------------------------------------------------------------------------------------ loading land
let landGen = 0, requested = null, pendingPan = { x: 0, y: 0 }, reloadTimer = null;

async function loadLand(lat, lon, radius, { announce = true } = {}) {
    const gen = ++landGen;
    if (announce) $('status').textContent = 'Loading terrain...';
    const res = 65;
    const [heightsReal, classes] = await Promise.all([terrain.fetchElevation(lat, lon, radius, res), terrain.fetchLandCover(lat, lon, radius, res)]);
    if (gen !== landGen) return; // a newer request replaced this one
    const real = !!heightsReal;
    const heights = heightsReal ?? proceduralHeights(lat, lon, radius, res);
    const pan = pendingPan; pendingPan = { x: 0, y: 0 };
    engine.installTerrain({ lat, lon, radius, res, heights, classes: classes ?? null, density: settings.animalDensity, panEast: pan.x, panSouth: pan.y });
    view.setCoarse({ key: `c${gen}`, res, heights, classes, lat, lon, radius });
    requested = { lat, lon, radius };
    $('status').textContent = real ? (classes ? 'Real elevation + OpenStreetMap land cover' : 'Real elevation data') : 'Offline - simulated terrain';
}

function scheduleLandReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (requested) loadLand(requested.lat, requested.lon, 0.5 * settings.diameterFeet * FEET, { announce: false }); }, 350);
}

// The wide, fine copy of the land the window is cut from (see the desktop app's Simulation::requestWorld).
const world = { pending: false, failedAt: -1e9, requestedAt: 0, req: null, gen: 0 };
async function maybeLoadWorld(w) {
    const c = view.coarse; if (!c || w.lat == null || world.pending && performance.now() - world.requestedAt < 400) return;
    const res = settings.terrainDetail === 0 ? 321 : 641;
    const now = performance.now();
    if (now - world.failedAt < 8000) return;
    const cur = view.world;
    if (cur) {
        const off = metresBetween(cur.lat, cur.lon, w.lat, w.lon), basis = cur.radius / WORLD_MARGIN;
        const covered = Math.hypot(off.x, off.y) + w.wantedRadius * 1.05 <= 0.6 * cur.radius, fineEnough = w.wantedRadius >= 0.4 * basis;
        if (covered && fineEnough && cur.res === res) return;
    }
    if (world.pending && world.req) {
        const moved = metresBetween(world.req.lat, world.req.lon, w.lat, w.lon);
        if (Math.abs(world.req.radius - w.wantedRadius) < 0.05 * w.wantedRadius && Math.hypot(moved.x, moved.y) < 0.2 * w.wantedRadius) return;
    }
    const gen = ++world.gen;
    world.pending = true; world.requestedAt = now; world.req = { lat: w.lat, lon: w.lon, radius: w.wantedRadius };
    const radius = WORLD_MARGIN * Math.max(w.wantedRadius, 20);
    const heights = await terrain.fetchElevation(w.lat, w.lon, radius, res);
    if (gen !== world.gen) return;
    if (!heights || !consistentWithCoarse(heights, res, w.lat, w.lon, radius)) { world.pending = false; world.failedAt = performance.now(); return; }
    const classes = await terrain.fetchLandCover(w.lat, w.lon, radius, res);
    if (gen !== world.gen) return;
    view.setWorld({ key: `w${gen}`, res, heights, classes, lat: w.lat, lon: w.lon, radius });
    world.pending = false;
}

// A failed download can come back as made-up terrain: only use the wide copy if it agrees with the land the hikers walk on.
function consistentWithCoarse(heights, res, lat, lon, radius) {
    const c = view.coarse; if (!c) return false;
    const off = metresBetween(lat, lon, c.lat, c.lon), halfW = (res - 1) / 2, halfC = (c.res - 1) / 2, spacingW = 2 * radius / (res - 1);
    let diff = 0, n = 0;
    for (let y = 4; y < c.res - 4; y += 6) for (let x = 4; x < c.res - 4; x += 6) {
        const gx = halfW + ((x - halfC) * c.spacing + off.x) / spacingW, gy = halfW + ((y - halfC) * c.spacing + off.y) / spacingW;
        if (gx < 1 || gy < 1 || gx > res - 2 || gy > res - 2) continue;
        diff += Math.abs(view.heightAt({ res, heights }, gx, gy) - c.heights[y * c.res + x]); ++n;
    }
    const relief = c.maxH - c.minH;
    return n < 9 || diff / n <= Math.max(4, 0.15 * relief);
}

// ------------------------------------------------------------------------------------------------ the controls
let pages, hikerPanel;
const S = name => () => settings[name];
const P = name => v => setSetting(name, v);
const pct = v => Math.round(v) + '%';
const noteName = o => NOTE_NAMES[0] + (o);
const octaveName = v => `C${v}`;
const offOr = unit => v => v < 0.5 ? 'Off' : Math.round(v) + unit;
const logSlider = (lo, hi) => ({ toPos: v => Math.log(v / lo) / Math.log(hi / lo), fromPos: p => lo * Math.pow(hi / lo, p) });

function buildControls() {
    const R = (label, spec, name) => () => sliderRow(label, { default: DEFAULTS[name], ...spec }, S(name), P(name));
    const feet = v => v >= 5280 ? (v / 5280).toFixed(2) + ' mi' : Math.round(v) + ' ft';
    const pageSpecs = [
        { name: 'Hikers', columns: [
            { title: 'Walking', rows: () => [
                sliderRow('Hikers', { min: 0, max: 16, default: 6 }, S('numHikers'), v => { setSetting('numHikers', v); }),
                R('Speed', { min: 1, max: 100 }, 'speed')(),
                R('Sim Rate (Hz)', { min: 0.5, max: 60, step: 0.1, ...logSlider(0.5, 60), format: v => v.toFixed(1) }, 'simulationRate')()] },
            { title: 'Rhythm of their notes', rows: () => [
                R('Note Speed', { min: 0, max: 100, format: v => v < 0.5 ? 'Follow' : String(Math.round(v)) }, 'noteSpeed')(),
                R('Gait Match', { min: 0, max: 100, format: pct }, 'gaitMatch')()] }] },
        { name: 'Music', columns: [
            { title: 'Notes', rows: () => [
                twoSelectRow('Scale / Root', SCALES, S('scaleType'), P('scaleType'), NOTE_NAMES, S('rootNote'), P('rootNote')),
                R('Favor Root', { min: 0, max: 100, format: offOr('%') }, 'favorRoot')(),
                R('Min Octave', { min: -1, max: 9, format: octaveName }, 'minOctave')(),
                R('Max Octave', { min: -1, max: 9, format: octaveName }, 'maxOctave')()] },
            { title: 'Expression', rows: () => [
                R('Note Length', { min: 5, max: 100, format: v => v >= 100 ? 'Legato' : Math.round(v) + '%' }, 'noteLength')(),
                R('Length Random', { min: 0, max: 100, format: offOr('%') }, 'noteLengthRandom')(),
                R('Velocity', { min: 0, max: 100, format: pct }, 'velocity')(),
                R('Vel Random', { min: 0, max: 100, format: pct }, 'velocityRandom')()] },
            { title: 'Arpeggiator', rows: () => [
                toggleRow('', 'Arpeggiator', S('arpOn'), P('arpOn')),
                selectRow('Pattern', ['Up', 'Down', 'Up/Down'], S('arpPattern'), P('arpPattern')),
                R('Randomness', { min: 0, max: 100, format: pct }, 'arpRandom')(),
                R('Rate (Hz)', { min: 0.5, max: 16, step: 0.01, ...logSlider(0.5, 16), format: v => v.toFixed(2) }, 'arpRate')(),
                R('Gate', { min: 10, max: 100, format: pct }, 'arpGate')()] }] },
        { name: 'Map', columns: [
            { title: 'Land', rows: () => [
                sliderRow('Diameter', { min: 50, max: 52800, step: 1, default: 5280, ...logSlider(50, 52800), format: feet }, S('diameterFeet'), P('diameterFeet')),
                selectRow('Terrain detail', ['Low (blocky, light)', 'High (detailed)', 'Auto (as smooth as it can)'], S('terrainDetail'), P('terrainDetail')),
                R('Animal Density', { min: 0, max: 1, step: 0.01 }, 'animalDensity')()] },
            { title: 'Sky', rows: () => [
                toggleRow('', 'Light by time of day', S('realLight'), P('realLight')),
                R('Clouds', { min: 0, max: 100, format: offOr('%') }, 'cloudOpacity')()] },
            { title: 'On the map', rows: () => [
                toggleRow('', 'Note glows', S('overlayGlows'), P('overlayGlows')), toggleRow('', 'Hiker numbers', S('overlayNumbers'), P('overlayNumbers')),
                toggleRow('', 'Compass', S('overlayCompass'), P('overlayCompass')), toggleRow('', 'Land-type legend', S('overlayLegend'), P('overlayLegend')),
                toggleRow('', 'Size readout and hints', S('overlayCaptions'), P('overlayCaptions'))] },
            { title: 'Defaults', rows: () => [
                buttonRow('', 'Copy my settings', async () => {
                    const { hikers, lat, lon, location, midiOut, ...mine } = settings;
                    const text = JSON.stringify({ settings: mine, sounds: (() => { try { return JSON.parse(localStorage.getItem('harmonyhike.sounds') || 'null'); } catch (e) { return null; } })() });
                    try { await navigator.clipboard.writeText(text); $('status').textContent = 'Settings copied - paste them to whoever sets the defaults'; } catch (e) { prompt('Copy these settings:', text); }
                }),
                buttonRow('', 'Reset everything', () => { if (confirm('Put every setting and sound back to how HarmonyHike first starts?')) { try { localStorage.removeItem('harmonyhike.settings'); localStorage.removeItem('harmonyhike.sounds'); } catch (e) { /* private window */ } location.reload(); } }),
                el('div', { class: 'row toggle' }, el('span'), el('span', { class: 'small', text: 'Your settings are remembered in this browser.' }))] }] },
        { name: 'Sound', columns: [
            { title: 'Output', rows: () => {
                const rows = [selectRow('Output', ['MIDI', 'Internal sound', 'MIDI + internal'], S('outputMode'), v => { setSetting('outputMode', v); pages.show(3); }),
                    R('Volume', { min: 0, max: 100, format: offOr('%') }, 'soundVolume')(), buttonRow('', 'Sound Designer...', () => openSoundDesigner(engine))];
                if (settings.outputMode !== 1) rows.push(midiOutputRow());
                return rows;
            } },
            { title: 'Nature', rows: () => [R('Animals', { min: 0, max: 100, format: offOr('%') }, 'animalLevel')(), R('Water', { min: 0, max: 100, format: offOr('%') }, 'waterLevel')()] }] },
        { name: 'Sync', columns: [
            { title: 'Clock', rows: () => [toggleRow('', 'Follow MIDI clock', S('syncOn'), v => { setSetting('syncOn', v); if (v) enableMidi(); }), midiInputRow(),
                el('div', { class: 'row toggle' }, el('span'), el('span', { id: 'sync-status', class: 'small', style: 'color:var(--dim)' }))] },
            { title: 'Arpeggiator', rows: () => [selectRow('Arp note', DIVISIONS, S('arpDivision'), P('arpDivision'))] },
            { title: 'Hikers', rows: () => [R('Gait Sync', { min: 0, max: 100, format: offOr('%') }, 'gaitSync')(), selectRow('Snap to note', DIVISIONS, S('gaitDivision'), P('gaitDivision'))] }] },
    ];
    pages = buildPages($('tabs'), $('pages'), pageSpecs);
}

function midiOutputRow() {
    const names = ['(none)'], ids = [null];
    for (const o of midi.outputs()) { names.push(o.name); ids.push(o.id); }
    const row = selectRow('MIDI out', names, () => Math.max(0, ids.indexOf(settings.midiOut ?? null)), i => { settings.midiOut = ids[i]; save(); midi.selectOutput(ids[i]); });
    if (!midi.supported) return el('div', { class: 'row toggle' }, el('span', { text: 'MIDI out' }), el('span', { text: 'Not available in this browser (try Chrome or Edge)', style: 'color:var(--dim)' }));
    if (!midi.access) return buttonRow('MIDI out', 'Enable MIDI...', async () => { await enableMidi(); pages.show(3); });
    return row;
}
function midiInputRow() {
    const names = ['(none)'], ids = [null];
    for (const o of midi.inputs()) { names.push(o.name); ids.push(o.id); }
    if (!midi.supported) return el('div', { class: 'row toggle' }, el('span', { text: 'Clock in' }), el('span', { text: 'MIDI not available in this browser', style: 'color:var(--dim)' }));
    if (!midi.access) return buttonRow('Clock in', 'Enable MIDI...', async () => { await enableMidi(); pages.show(4); });
    return selectRow('Clock in', names, () => Math.max(0, ids.indexOf(settings.midiIn ?? null)), i => { settings.midiIn = ids[i]; save(); midi.selectInput(ids[i]); });
}
async function enableMidi() {
    if (!midi.access && !(await midi.enable())) return;
    if (settings.midiOut) midi.selectOutput(settings.midiOut);
    if (settings.midiIn) midi.selectInput(settings.midiIn);
}

// ------------------------------------------------------------------------------------------------ the hiker panel
let selected = [];
function renderHikerPanel() {
    const panel = $('hiker-panel');
    const info = el('div', { class: 'info' });
    const scroll = el('div', { id: 'hiker-scroll' });
    panel.replaceChildren(el('h3', { text: 'Selected hikers' }), info, scroll, el('button', { text: 'Reset to global', onclick: async () => {
        engine.send('setProfiles', { channels: selected, changes: { speed: -1, noteSpeed: -1, scaleType: -1, rootNote: -1, minOctave: -99, maxOctave: -99, velocityScale: -1, velocityRandom: -1, favorRoot: -1, midiChannel: -1, soundPreset: -1, daring: 0.5, linearity: 1, preference: 0 } });
        setTimeout(renderHikerPanel, 60);
    } }));
    if (!selected.length) { info.textContent = 'Nothing selected. ' + (view.touch ? 'Tap a hiker, or use Select on the map, to edit it here.' : 'Cmd-click a hiker (or Cmd-drag a box) to edit it here.') + ''; return; }
    info.textContent = `${selected.length} ${selected.length === 1 ? 'hiker' : 'hikers'} selected (${selected.join(', ')}).` + (selected.length > 1 ? '\nChanges apply to all.' : '');
    engine.ask('getProfile', { channel: selected[0] }).then(p => {
        const edit = changes => engine.send('setProfiles', { channels: selected, changes });
        const field = (label, node) => el('div', { class: 'field' }, el('label', { text: label }), node);
        const slider = (min, max, value, fmt, onChange, step = 1) => {
            const range = el('input', { type: 'range', min, max, step, value });
            const val = el('span', { class: 'val', text: fmt(value) });
            range.addEventListener('input', () => { val.textContent = fmt(+range.value); onChange(+range.value); });
            return el('div', { class: 'hs' }, range, val);
        };
        const sect = t => el('div', { class: 'sect', text: t });
        const g = k => settings[k];
        const opt = (v, fallback) => v < -50 || v < 0 ? fallback : v;
        scroll.replaceChildren(
            sect('MOVEMENT'),
            field('Speed', slider(1, 100, opt(p.speed, g('speed')), v => String(Math.round(v)), v => edit({ speed: v }))),
            field('Daring', slider(0, 100, p.daring * 100, pct, v => edit({ daring: v / 100 }))),
            field('Linearity', slider(0, 100, p.linearity * 100, pct, v => edit({ linearity: v / 100 }))),
            field('Likes to walk', el('select', { onchange: e => edit({ preference: +e.target.value }) }, ['Anywhere', 'In nature', 'In town', 'By the water', 'In the mountains'].map((t, i) => el('option', { value: i, text: t, ...(i === p.preference ? { selected: '' } : {}) })))),
            sect('NOTES'),
            field('Note Speed', slider(0, 100, opt(p.noteSpeed, g('noteSpeed')), v => v < 0.5 ? 'Follow' : String(Math.round(v)), v => edit({ noteSpeed: v }))),
            field('Scale / Root', el('div', { style: 'display:grid;grid-template-columns:1.6fr 1fr;gap:6px' },
                el('select', { onchange: e => edit({ scaleType: +e.target.value }) }, SCALES.map((t, i) => el('option', { value: i, text: t, ...(i === opt(p.scaleType, g('scaleType')) ? { selected: '' } : {}) }))),
                el('select', { onchange: e => edit({ rootNote: +e.target.value }) }, NOTE_NAMES.map((t, i) => el('option', { value: i, text: t, ...(i === opt(p.rootNote, g('rootNote')) ? { selected: '' } : {}) }))))),
            field('Favor Root', slider(0, 100, opt(p.favorRoot, g('favorRoot') / 100) * (p.favorRoot < 0 ? 1 : 100), offOr('%'), v => edit({ favorRoot: v / 100 }))),
            field('Min Octave', slider(-1, 9, opt(p.minOctave, g('minOctave')), octaveName, v => edit({ minOctave: v }))),
            field('Max Octave', slider(-1, 9, opt(p.maxOctave, g('maxOctave')), octaveName, v => edit({ maxOctave: v }))),
            field('Velocity', slider(0, 100, opt(p.velocityScale, g('velocity') / 100) * (p.velocityScale < 0 ? 1 : 100), pct, v => edit({ velocityScale: v / 100 }))),
            field('Vel Random', slider(0, 100, opt(p.velocityRandom, g('velocityRandom') / 100) * (p.velocityRandom < 0 ? 1 : 100), pct, v => edit({ velocityRandom: v / 100 }))),
            sect('SOUND AND CHANNEL'),
            field('Sound', el('select', { onchange: e => edit({ soundPreset: +e.target.value }) }, engine.presets.map((pr, i) => el('option', { value: i, text: pr.name, ...(i === Math.max(0, p.soundPreset) ? { selected: '' } : {}) })))),
            field('MIDI Channel', el('select', { onchange: e => edit({ midiChannel: +e.target.value }) }, [el('option', { value: -1, text: 'Own (its slot number)' }), ...Array.from({ length: 16 }, (_, i) => el('option', { value: i + 1, text: `Channel ${i + 1}`, ...(i + 1 === p.midiChannel ? { selected: '' } : {}) }))])),
        );
    });
}

// ------------------------------------------------------------------------------------------------ start up
async function boot() {
    renderer = new Renderer($('gl'));
    view = new View($('gl'), $('overlay'), renderer);
    view.options.realLight = !!settings.realLight; view.options.cloudOpacity = settings.cloudOpacity / 100;
    // Test hooks: ?clouds=0&diameter=800&zoom=2&yaw=0.5&pitch=0.6&realLight=1&hikers=10
    const q = new URLSearchParams(location.search);
    for (const [key, name] of [['clouds', 'cloudOpacity'], ['diameter', 'diameterFeet'], ['realLight', 'realLight'], ['hikers', 'numHikers'], ['detail', 'terrainDetail'], ['output', 'outputMode']])
        if (q.has(key)) settings[name] = parseFloat(q.get(key));
    if (q.has('zoom')) view.zoom = parseFloat(q.get('zoom'));
    if (q.has('yaw')) view.yaw = parseFloat(q.get('yaw'));
    if (q.has('pitch')) view.pitch = parseFloat(q.get('pitch'));
    view.options.realLight = !!settings.realLight; view.options.cloudOpacity = settings.cloudOpacity / 100;
    view.wantedRadius = 0.5 * settings.diameterFeet * FEET;
    for (const k of ['Glows', 'Numbers', 'Compass', 'Legend', 'Captions']) view.options.overlays[k.toLowerCase()] = !!settings['overlay' + k];
    await renderer.loadAssets();

    initPhone(view);
    view.on('window', maybeLoadWorld);
    view.on('selection', list => { selected = list; renderHikerPanel(); });
    view.on('addHiker', async s => { await engine.ask('addHiker', { x: s.x, y: s.y }); syncHikerCount(); });
    view.on('removeHiker', async ch => { await engine.ask('removeHiker', { channel: ch }); syncHikerCount(); });
    view.on('moveHiker', (ch, x, y) => engine.send('moveHiker', { channel: ch, x, y }));
    view.on('previewNote', ch => engine.send('previewNote', { channel: ch }));
    view.on('water', (amount, pan, waves) => engine.send('waterInView', { amount, pan, waves }));
    view.on('hikerPans', pans => engine.send('hikerPans', { pans }));
    view.on('splash', pan => engine.send('splash', { pan }));
    view.on('pan', (east, south) => {
        pendingPan = { x: pendingPan.x + east, y: pendingPan.y + south };
        if (!/^(near |-?\d)/.test(settings.location)) { settings.location = 'near ' + settings.location; $('location').value = settings.location; save(); }
        if (!requested) return;
        const c = offsetLatLon(requested.lat, requested.lon, east, south);
        loadLand(c.lat, c.lon, 0.5 * settings.diameterFeet * FEET, { announce: false });
    });

    engine.on('snapshot', s => view.setSnapshot(s));
    setInterval(async () => { if (engine.ready && view.snapshot) { try { settings.hikers = await engine.ask('exportHikers'); save(); } catch (e) { /* not ready */ } } }, 5000);
    engine.on('midi', m => { if (settings.outputMode !== 1) midi.send(m, engine.context); });

    buildControls();
    $('location').value = settings.location;
    wireButtons();
    requestAnimationFrame(function frame(now) { try { view.draw(now); } catch (e) { console.error(e); } requestAnimationFrame(frame); });

    // A few things done on a timer: tempo from MIDI clock, the sync status, the weather.
    setInterval(() => {
        if (settings.syncOn) { const t = midi.tempo(); engine.send('tempo', { valid: t.valid, bpm: t.bpm, ppq: t.ppq }); const s = $('sync-status'); if (s) s.textContent = t.valid ? `Following MIDI clock, ${t.bpm.toFixed(1)} BPM` : 'Waiting for a clock...'; }
    }, 40);
    refreshWeather();
    setInterval(refreshWeather, 15 * 60 * 1000);
}

async function refreshWeather() {
    if (!requested) { setTimeout(refreshWeather, 3000); return; }
    const w = await fetchWeather(requested.lat, requested.lon);
    if (w) { view.setWeather(w); engine.send('ambient', { celsius: w.temperatureC }); }
}

function syncHikerCount() {
    setTimeout(() => { const n = view.snapshot?.hikers.length ?? 0; settings.numHikers = n; engine.setParam('numHikers', n); pages?.refresh(); }, 120);
}

function wireButtons() {
    $('mode-rotate').onclick = () => { view.mode = 'rotate'; $('mode-rotate').classList.add('on'); $('mode-manage').classList.remove('on'); };
    $('mode-manage').onclick = () => { view.mode = 'manage'; $('mode-manage').classList.add('on'); $('mode-rotate').classList.remove('on'); };
    $('reset-view').onclick = () => view.resetView();
    $('zoom-in').onclick = () => view.zoomBy(1.25); $('zoom-out').onclick = () => view.zoomBy(0.8);
    $('pause').onclick = () => { setSetting('paused', settings.paused ? 0 : 1); };
    $('pause').textContent = settings.paused ? 'Resume' : 'Pause'; $('pause').classList.toggle('on', !!settings.paused);
    $('fullscreen').onclick = async () => {
        const root = document.documentElement, on = document.fullscreenElement || document.webkitFullscreenElement;
        const request = root.requestFullscreen || root.webkitRequestFullscreen, exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (on) { exit?.call(document); return; }
        if (request) { try { await request.call(root, { navigationUI: 'hide' }); try { await screen.orientation?.unlock?.(); } catch (e) { /* not needed */ } return; } catch (e) { /* fall through to the tip */ } }
        // iPhone browsers have no full-screen mode for web pages: the way to lose the toolbars is to add the page to the Home Screen.
        openTip('Full screen on this phone', ['Safari on iPhone cannot make a web page full screen. To lose the toolbars:', '1. Tap the Share button (the square with an arrow).', '2. Choose Add to Home Screen.', '3. Open HarmonyHike from that new icon - it runs full screen, with no browser bars.']);
    };
    $('panel-toggle').onclick = () => $('hiker-panel').classList.toggle('hidden');
    $('clear-hikers').onclick = () => { engine.send('clearHikers'); settings.numHikers = 0; pages?.refresh(); selected = []; view.selected = new Set(); renderHikerPanel(); };
    $('about-btn').onclick = () => openAbout();
    const go = async () => {
        const text = $('location').value.trim().replace(/^near /i, ''); if (!text) return;
        $('status').textContent = 'Looking up ' + text + '...';
        const found = await geocode(text);
        if (!found) { $('status').textContent = 'Place not found - showing previous terrain'; return; }
        settings.location = text; settings.lat = found.lat; settings.lon = found.lon; save();
        view.windowLat = null; view.world = null; world.pending = false;
        pendingPan = { x: 0, y: 0 };
        await loadLand(found.lat, found.lon, 0.5 * settings.diameterFeet * FEET);
        view.windowLat = found.lat; view.windowLon = found.lon;
        refreshWeather();
    };
    $('go').onclick = go;
    $('surprise').onclick = async () => {
        const p = randomPlace(settings.location.replace(/^near /, ''));
        $('location').value = p.location; Object.assign(settings, p); save();
        view.windowLat = null; view.world = null; world.pending = false; pendingPan = { x: 0, y: 0 };
        await loadLand(p.lat, p.lon, 0.5 * settings.diameterFeet * FEET);
        view.windowLat = p.lat; view.windowLon = p.lon;
        refreshWeather();
    };
    $('location').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    window.addEventListener('keydown', e => { if (e.key === ' ' && e.target === document.body) { e.preventDefault(); $('pause').click(); } });
}

$('start-btn').addEventListener('click', async () => {
    $('start-btn').disabled = true; $('start-btn').textContent = 'Starting...';
    try {
        await boot();
        const params = {}; for (const k of CORE_PARAMS) params[k] = settings[k];
        await engine.start(params);
        loadSavedSounds(engine);
        await loadLand(settings.lat, settings.lon, 0.5 * settings.diameterFeet * FEET);
        if (Array.isArray(settings.hikers) && settings.hikers.length && !new URLSearchParams(location.search).has('hikers')) { engine.send('importHikers', { records: settings.hikers }); settings.numHikers = settings.hikers.length; engine.setParam('numHikers', settings.numHikers); }
        else engine.setParam('numHikers', settings.numHikers);
        $('start').classList.add('hidden');
        renderHikerPanel();
        const q = new URLSearchParams(location.search);
        if (q.has('page')) pages.show(parseInt(q.get('page'), 10));
        if (q.has('selftest')) runSelfTest({ view, engine });
        if (q.has('designer')) openSoundDesigner(engine);
        if (q.has('select')) { const chans = q.get('select').split(',').map(Number); view.selected = new Set(chans); selected = chans; renderHikerPanel(); }
    } catch (e) {
        console.error(e);
        $('start-btn').disabled = false; $('start-btn').textContent = 'Start';
        $('start-note').textContent = 'Something went wrong starting up: ' + (e.message || e).toString().slice(0, 160);
    }
});

window.harmonyhike = { engine, settings, get view() { return view; }, loadLand };

if (new URLSearchParams(location.search).has('autostart')) setTimeout(() => $('start-btn').click(), 100);
