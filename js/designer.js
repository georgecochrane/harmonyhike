// The Sound Designer: edit the synth presets (oscillators, envelope, filter, vibrato, reverb and echo), tie sounds to what the hikers
// feel with the modulation grid, tune the shared reverb, audition, and save or load presets as JSON (the same files the desktop app uses).
import { el, fader } from './ui.js';

// Order of the numbers in a preset (matches the core).
const FIELDS = ['wave1', 'wave2', 'mix2', 'ratio2', 'detuneCents', 'noise', 'attack', 'decay', 'sustain', 'release', 'cutoffHz', 'resonance', 'filterEnv',
    'vibratoRate', 'vibratoDepth', 'level', 'reverb', 'echo', 'echoTime', 'echoMountains'];
const SOURCES = ['Slope', 'Tiredness', 'Land type', 'Temperature'];
const TARGETS = ['Cutoff', 'Resonance', 'Vibrato', 'Detune', 'Noise', 'Level', 'Reverb', 'Echo', 'Pan'];
const ROWS = [
    ['Osc 2 level', 'mix2', 0, 1, 0.01, 1, ''], ['Osc 2 pitch x', 'ratio2', 0.25, 12, 0.01, 0.5, ''], ['Osc 2 detune', 'detuneCents', -100, 100, 0.5, 1, ' c'],
    ['Breath noise', 'noise', 0, 1, 0.01, 0.6, ''], ['Attack', 'attack', 0.001, 4, 0.001, 0.35, ' s'], ['Decay', 'decay', 0.005, 6, 0.001, 0.4, ' s'],
    ['Sustain', 'sustain', 0, 1, 0.01, 1, ''], ['Release', 'release', 0.01, 8, 0.001, 0.4, ' s'], ['Filter cutoff', 'cutoffHz', 60, 16000, 1, 0.3, ' Hz'],
    ['Resonance', 'resonance', 0, 0.95, 0.01, 1, ''], ['Filter sweep', 'filterEnv', -4, 6, 0.01, 1, ' oct'], ['Vibrato rate', 'vibratoRate', 0.1, 12, 0.01, 0.6, ' Hz'],
    ['Vibrato depth', 'vibratoDepth', 0, 100, 0.1, 0.6, ' c'], ['Level', 'level', 0, 1, 0.01, 1, ''], ['Reverb', 'reverb', 0, 1, 0.01, 1, ''],
    ['Echo', 'echo', 0, 1, 0.01, 1, ''], ['Echo time', 'echoTime', 0.1, 0.7, 0.01, 1, ' s'], ['Echo in hills', 'echoMountains', 0, 1, 0.01, 1, ''],
];

// A slider with a curve (skew): position 0..1 <-> value.
const skewed = (min, max, skew) => ({ toPos: v => Math.pow((v - min) / (max - min), skew), fromPos: p => min + (max - min) * Math.pow(p, 1 / skew) });

let stored;
let lastReverb = { decay: 2.4, lowpass: 9000, highpass: 120, size: 1 };
// All the sound presets (as they are now) and the shared reverb: what "Copy my settings" hands over, and what a shipped default-sounds file holds.
export function currentSounds(engine) { return { presets: engine.presets.map(p => ({ name: p.name, values: [...p.values] })), reverb: { ...(stored?.reverb ?? lastReverb) } }; }
// `shipped`: the sounds every new visitor starts with (from assets/defaults.json), used when this browser has none of its own saved.
export function loadSavedSounds(engine, shipped = null) {
    try { stored = JSON.parse(localStorage.getItem('harmonyhike.sounds') || 'null'); } catch (e) { stored = null; }
    if (!stored && shipped && Array.isArray(shipped.presets)) stored = shipped;
    if (!stored) return;
    if (stored.reverb) lastReverb = stored.reverb;
    stored.presets.forEach((p, i) => { if (i < engine.presets.length) { engine.send('setPreset', { index: i, values: p.values }); engine.send('renamePreset', { index: i, name: p.name }); engine.presets[i] = p; } else engine.send('addPreset', { values: p.values, name: p.name }); });
    if (stored.reverb) engine.send('reverb', stored.reverb);
}
const persist = (engine, reverb) => { try { localStorage.setItem('harmonyhike.sounds', JSON.stringify({ presets: engine.presets, reverb })); } catch (e) { /* private window */ } };

export function openSoundDesigner(engine) {
    let current = 0;
    const reverb = stored?.reverb ?? lastReverb;
    if (!stored) stored = { presets: [], reverb };
    const root = el('div', { class: 'dialog', onclick: e => { if (e.target === root) close(); } });
    const close = () => { root.remove(); };
    const box = el('div', { class: 'box glass' });
    root.append(box);
    document.getElementById('dialog-root').append(root);

    let saveTimer;
    const changed = () => {
        engine.send('setPreset', { index: current, values: engine.presets[current].values });
        clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(engine, reverb), 300);
    };
    const draw = () => {
        const preset = engine.presets[current], v = preset.values;
        const select = el('select', { onchange: e => { current = +e.target.value; draw(); } }, engine.presets.map((p, i) => el('option', { value: i, text: `${i + 1}.  ${p.name}`, ...(i === current ? { selected: '' } : {}) })));
        const name = el('input', { type: 'text', value: preset.name, oninput: e => { preset.name = e.target.value.slice(0, 40); engine.send('renamePreset', { index: current, name: preset.name }); select.options[current].textContent = `${current + 1}.  ${preset.name}`; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(engine, reverb), 300); } });
        const waveSelect = idx => el('select', { onchange: e => { v[idx] = +e.target.value; changed(); } }, ['Sine', 'Triangle', 'Saw', 'Square'].map((t, i) => el('option', { value: i, text: t, ...(i === v[idx] ? { selected: '' } : {}) })));
        const sliderRow = (label, get, set, min, max, step, skew, suffix) => {
            const c = skewed(min, max, skew);
            const val = el('span', { class: 'val' });
            const fmt = x => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(step < 0.01 ? 3 : 2)) + suffix;
            const track = fader({ min, max, step, toPos: c.toPos, fromPos: c.fromPos }, get, set, () => { val.textContent = fmt(get()); });
            track.setAttribute('aria-label', label);
            return el('div', { class: 'row' }, el('span', { text: label }), track, val);
        };
        const rows = ROWS.map(([label, key, min, max, step, skew, suffix]) => {
            const idx = FIELDS.indexOf(key);
            return sliderRow(label, () => v[idx], x => { v[idx] = x; changed(); }, min, max, step, skew, suffix);
        });
        const verbRows = [
            sliderRow('Decay', () => reverb.decay, x => { reverb.decay = x; sendReverb(); }, 0.2, 40, 0.01, 0.35, ' s'),
            sliderRow('Size', () => reverb.size, x => { reverb.size = x; sendReverb(); }, 0.4, 3, 0.01, 1, ''),
            sliderRow('Low-pass', () => reverb.lowpass, x => { reverb.lowpass = x; sendReverb(); }, 200, 20000, 1, 0.3, ' Hz'),
            sliderRow('High-pass', () => reverb.highpass, x => { reverb.highpass = x; sendReverb(); }, 10, 4000, 1, 0.4, ' Hz'),
        ];
        const sendReverb = () => { engine.send('reverb', reverb); clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(engine, reverb), 300); };

        const auditionButton = el('button', { text: 'Audition', onclick: () => { [60, 64, 67, 72, 67, 64].forEach((note, i) => setTimeout(() => engine.send('audition', { preset: current, note, seconds: 1.6 }), i * 240)); } });
        const grid = modulationGrid(v, changed);

        box.replaceChildren(
            el('h2', { text: 'Sound Designer' }),
            el('div', { style: 'display:grid;grid-template-columns:minmax(360px,1.25fr) minmax(320px,1fr);gap:24px' },
                el('div', {},
                    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px' }, select,
                        el('button', { text: 'Duplicate', onclick: async () => { const copy = { name: preset.name + ' copy', values: [...v] }; if (engine.presets.length >= 32) return; await engine.ask('addPreset', { values: copy.values, name: copy.name }); current = engine.presets.length - 1; draw(); persist(engine, reverb); } }),
                        auditionButton, el('button', { text: 'Delete', title: 'Remove this sound (hikers using it get another)', ...(engine.presets.length <= 1 ? { disabled: '' } : {}), onclick: async () => { if (engine.presets.length <= 1 || !confirm(`Delete "${preset.name}"? Hikers using it will be given another sound.`)) return; const left = await engine.ask('removePreset', { index: current }); if (left < 0) return; await new Promise(r => setTimeout(r, 50)); current = Math.min(current, engine.presets.length - 1); persist(engine, reverb); draw(); } }),
                        name),
                    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px' },
                        el('button', { text: 'Export...', onclick: () => download(engine) }), el('button', { text: 'Import...', onclick: () => upload(engine, () => { current = engine.presets.length - 1; draw(); }) })),
                    el('div', { class: 'row' }, el('span', { text: 'Oscillator 1' }), waveSelect(0)), el('div', { class: 'row' }, el('span', { text: 'Oscillator 2' }), waveSelect(1)),
                    ...rows,
                    el('h4', { text: 'SHARED REVERB', style: 'margin:12px 0 6px;color:var(--dim);letter-spacing:.08em;font-size:11px' }), ...verbRows),
                el('div', {},
                    el('h4', { text: 'MODULATION', style: 'margin:0 0 6px;color:var(--dim);letter-spacing:.08em;font-size:11px' }),
                    el('p', { class: 'small', style: 'color:var(--dim);margin:0 0 8px', text: 'Each square ties a thing about the hiker (down the side) to a part of its sound (across the top). Drag a square up: it lights blue as the sound rises with that thing. Drag down for orange: it falls. Double-click to clear; hold Shift for fine control.' }),
                    grid,
                    el('p', { class: 'small', style: 'color:var(--dim);margin-top:14px', text: 'Changes are heard right away by every hiker using this preset. Pick a hiker on the map and choose its Sound in the side panel; hikers that share a MIDI channel share a sound. Echo in hills: 0 = the echo is always the same, 1 = it only appears when a hiker is up high or on steep ground.' }))),
            el('p', {}, el('button', { text: 'Close', onclick: close })));
    };
    draw();
}

function modulationGrid(values, changed) {
    const OFFSET = 20, W = 400, headerH = 84, labelW = 92, rowH = 62;
    const canvas = el('canvas', { width: W * 2, height: (headerH + rowH * 4) * 2, style: `width:${W}px;height:${headerH + rowH * 4}px;touch-action:none;cursor:ns-resize` });
    const g = canvas.getContext('2d');
    const cellW = (W - labelW) / 9;
    const cell = (s, t) => ({ x: labelW + t * cellW + 2, y: headerH + s * rowH + 2, w: cellW - 4, h: rowH - 4 });
    let hover = null, drag = null;
    const get = (s, t) => values[OFFSET + s * 9 + t], set = (s, t, x) => { values[OFFSET + s * 9 + t] = x; };
    const mixc = (a, b, k) => a.map((c, i) => Math.round(c + (b[i] - c) * k));
    const paint = () => {
        g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, headerH + rowH * 4);
        g.font = '12px system-ui'; g.fillStyle = 'rgba(255,255,255,.7)';
        TARGETS.forEach((name, t) => { const c = cell(0, t); g.save(); g.translate(c.x + c.w / 2 + 4, headerH - 6); g.rotate(-Math.PI / 2); g.textAlign = 'left'; g.fillStyle = hover?.t === t ? '#fff' : 'rgba(255,255,255,.65)'; g.fillText(name, 0, 0); g.restore(); });
        SOURCES.forEach((name, s) => {
            const c0 = cell(s, 0); g.fillStyle = hover?.s === s ? '#fff' : 'rgba(255,255,255,.7)'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(name, labelW - 8, c0.y + c0.h / 2);
            for (let t = 0; t < 9; ++t) {
                const c = cell(s, t), val = get(s, t), fill = mixc([20, 27, 46], val >= 0 ? [168, 216, 255] : [255, 178, 107], Math.min(1, Math.abs(val)) * 0.95);
                g.fillStyle = `rgb(${fill})`; g.beginPath(); g.roundRect(c.x, c.y, c.w, c.h, 6); g.fill();
                g.strokeStyle = (hover?.s === s && hover?.t === t) || (drag?.s === s && drag?.t === t) ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.stroke();
                if (Math.abs(val) > 0.02 || (hover?.s === s && hover?.t === t)) { g.fillStyle = Math.abs(val) > 0.5 ? '#10182a' : 'rgba(255,255,255,.85)'; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(val.toFixed(2), c.x + c.w / 2, c.y + c.h / 2); g.font = '12px system-ui'; }
            }
        });
    };
    const hit = e => { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; for (let s = 0; s < 4; ++s) for (let t = 0; t < 9; ++t) { const c = cell(s, t); if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { s, t }; } return null; };
    canvas.addEventListener('pointerdown', e => { const h = hit(e); if (!h) return; canvas.setPointerCapture(e.pointerId); drag = { ...h, y: e.clientY, start: get(h.s, h.t) }; paint(); });
    canvas.addEventListener('pointermove', e => {
        if (drag) { const per = e.shiftKey ? 360 : 90; let x = Math.min(1, Math.max(-1, drag.start - (e.clientY - drag.y) / per)); if (Math.abs(x) < 0.03) x = 0; set(drag.s, drag.t, x); changed(); paint(); return; }
        const h = hit(e); if (h?.s !== hover?.s || h?.t !== hover?.t) { hover = h; paint(); }
    });
    canvas.addEventListener('pointerup', () => { drag = null; paint(); });
    canvas.addEventListener('pointerleave', () => { hover = null; paint(); });
    canvas.addEventListener('dblclick', e => { const h = hit(e); if (h) { set(h.s, h.t, 0); changed(); paint(); } });
    paint();
    return canvas;
}

// Presets as JSON, the same format as the desktop app's Export / Import.
function toJson(engine) {
    return JSON.stringify(engine.presets.map(p => {
        const o = { name: p.name };
        FIELDS.forEach((k, i) => o[k] = p.values[i]);
        o.mod = p.values.slice(20);
        return o;
    }), null, 1);
}
function fromJson(text) {
    const parsed = JSON.parse(text), list = Array.isArray(parsed) ? parsed : [parsed], out = [];
    for (const o of list) {
        if (typeof o !== 'object' || !o) continue;
        const values = FIELDS.map(k => (typeof o[k] === 'number' ? o[k] : (k === 'ratio2' ? 1 : k === 'sustain' ? 0.6 : k === 'cutoffHz' ? 4000 : k === 'level' ? 0.5 : k === 'echoTime' ? 0.33 : k === 'echoMountains' ? 0.85 : k === 'attack' ? 0.02 : k === 'decay' ? 0.3 : k === 'release' ? 0.5 : k === 'vibratoRate' ? 5 : k === 'reverb' ? 0.3 : k === 'resonance' ? 0.15 : 0)));
        const mod = Array.from({ length: 36 }, (_, i) => (Array.isArray(o.mod) && typeof o.mod[i] === 'number' ? Math.max(-1, Math.min(1, o.mod[i])) : 0));
        out.push({ name: String(o.name ?? 'Preset').slice(0, 40), values: [...values, ...mod] });
    }
    return out;
}
function download(engine) {
    const a = el('a', { href: URL.createObjectURL(new Blob([toJson(engine)], { type: 'application/json' })), download: 'HarmonyHike presets.json' });
    document.body.append(a); a.click(); a.remove();
}
function upload(engine, done) {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
        try {
            for (const p of fromJson(await input.files[0].text())) { if (engine.presets.length >= 32) break; await engine.ask('addPreset', { values: p.values, name: p.name }); }
            done();
        } catch (e) { alert('That file could not be read as presets.'); }
    });
    input.click();
}
