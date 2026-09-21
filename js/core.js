// Loads the HarmonyHike WebAssembly core (simulation, note-making, sound engine) and wraps its C interface.
// Works in a browser main thread, an AudioWorklet, or Node: it needs only WebAssembly, no fetch, no TextDecoder.

export const PARAMS = ['numHikers', 'speed', 'noteSpeed', 'gaitMatch', 'simulationRate', 'animalDensity', 'scaleType', 'rootNote', 'minOctave', 'maxOctave',
    'noteLength', 'noteLengthRandom', 'favorRoot', 'velocity', 'velocityRandom', 'paused', 'arpOn', 'arpPattern', 'arpRandom', 'arpRate',
    'arpGate', 'arpDivision', 'syncOn', 'gaitSync', 'gaitDivision', 'outputMode', 'soundVolume', 'animalLevel', 'waterLevel', 'keyMode', 'keyMinutes'];

export const PROFILE_FIELDS = ['speed', 'noteSpeed', 'scaleType', 'rootNote', 'minOctave', 'maxOctave', 'velocityScale', 'velocityRandom',
    'favorRoot', 'midiChannel', 'soundPreset', 'daring', 'linearity', 'preference'];

export async function createCore (wasmBytes, sampleRate) {
    let memory = null;
    const view = () => new DataView (memory.buffer);
    const module = await WebAssembly.compile (wasmBytes);

    // The module was built without an operating system: give it the few things it asks for.
    const imports = {};
    for (const { module: m, name, kind } of WebAssembly.Module.imports (module)) {
        imports[m] ??= {};
        if (kind !== 'function') continue;
        imports[m][name] = (...args) => 0;
    }
    if (imports.wasi_snapshot_preview1) {
        const wasi = imports.wasi_snapshot_preview1;
        wasi.clock_time_get = (id, precision, outPtr) => { view().setBigUint64 (outPtr, BigInt (Math.round ((typeof performance !== 'undefined' ? performance.now() : Date.now())) * 1e6), true); return 0; };
        wasi.fd_write = (fd, iovs, count, outPtr) => { let n = 0; for (let i = 0; i < count; ++i) n += view().getUint32 (iovs + i * 8 + 4, true); view().setUint32 (outPtr, n, true); return 0; };
        wasi.environ_sizes_get = (a, b) => { view().setUint32 (a, 0, true); view().setUint32 (b, 0, true); return 0; };
        wasi.args_sizes_get = (a, b) => { view().setUint32 (a, 0, true); view().setUint32 (b, 0, true); return 0; };
        wasi.proc_exit = () => { throw new Error ('the core exited'); };
    }

    const instance = await WebAssembly.instantiate (module, imports);
    const x = instance.exports;
    memory = x.memory;
    if (x._initialize) x._initialize();

    x.ts_create (sampleRate);

    const f32 = (ptr, n) => new Float32Array (memory.buffer, ptr, n);
    const u8 = (ptr, n) => new Uint8Array (memory.buffer, ptr, n);
    const i32 = (ptr, n) => new Int32Array (memory.buffer, ptr, n);

    const scratch = { blockCapacity: 0, left: 0, right: 0, midi: x.ts_alloc (16), snapshot: 0, snapshotCapacity: 0, profile: x.ts_alloc (14 * 4), preset: 0 };
    const presetFloats = x.ts_preset_floats();
    scratch.preset = x.ts_alloc (presetFloats * 4);
    const ensureBlock = n => {
        if (scratch.blockCapacity >= n) return;
        if (scratch.left) { x.ts_free (scratch.left); x.ts_free (scratch.right); }
        scratch.left = x.ts_alloc (n * 4); scratch.right = x.ts_alloc (n * 4); scratch.blockCapacity = n;
    };
    const readCString = ptr => { const b = u8 (ptr, 256); let s = ''; for (let i = 0; i < 256 && b[i]; ++i) s += String.fromCharCode (b[i]); return s; };
    const writeCString = str => { const p = x.ts_alloc (str.length + 1); const b = u8 (p, str.length + 1); for (let i = 0; i < str.length; ++i) b[i] = str.charCodeAt (i) & 127; b[str.length] = 0; return p; };

    return {
        exports: x,
        setParam (name, value) { const id = PARAMS.indexOf (name); if (id >= 0) x.ts_set_param (id, value); },

        // Renders a block of stereo audio into the given arrays, and returns the MIDI it produced: [{ sample, status, data1, data2 }].
        process (left, right) {
            const n = left.length;
            ensureBlock (n);
            x.ts_process (n, scratch.left, scratch.right);
            left.set (f32 (scratch.left, n)); right.set (f32 (scratch.right, n));
            const count = x.ts_midi_count(), events = [];
            for (let i = 0; i < count; ++i) { x.ts_midi_get (i, scratch.midi); const v = i32 (scratch.midi, 4); events.push ({ sample: v[0], status: v[1], data1: v[2], data2: v[3] }); }
            return events;
        },

        // Where the trees go on a land: a Float32Array of 6 numbers per tree (gridX, gridY, size, kind, hue, phase). Same code the simulation walks around.
        generateTrees (lat, lon, radiusMeters, res, heights, classes, minH, maxH, density = 0.6, windowGX = 0, windowGY = 0, windowRadiusGrid = 0, latticeRadiusMeters = 0) {
            const hp = x.ts_alloc (heights.length * 4); f32 (hp, heights.length).set (heights);
            const cp = x.ts_alloc (classes.length); u8 (cp, classes.length).set (classes);
            let capacity = 3000, result = null;
            for (;;) {
                const op = x.ts_alloc (capacity * 6 * 4);
                const n = x.ts_generate_trees (lat, lon, radiusMeters, res, hp, cp, minH, maxH, density, windowGX, windowGY, windowRadiusGrid, latticeRadiusMeters, op, capacity);
                if (n >= 0) result = Float32Array.from (f32 (op, n * 6));
                x.ts_free (op);
                if (n >= 0) break;
                capacity = -n + 16;
            }
            x.ts_free (hp); x.ts_free (cp);
            return result;
        },

        installTerrain (lat, lon, radiusMeters, res, heights, classes, animalDensity, panEast = 0, panSouth = 0) {
            const hp = x.ts_alloc (heights.length * 4); f32 (hp, heights.length).set (heights);
            let cp = 0;
            if (classes) { cp = x.ts_alloc (classes.length); u8 (cp, classes.length).set (classes); }
            x.ts_install_terrain (lat, lon, radiusMeters, res, hp, cp, animalDensity, panEast, panSouth);
            x.ts_free (hp); if (cp) x.ts_free (cp);
        },

        // The state to draw: { tick, radius, resolution, spacing, paused, hikers: [...], animals: [...] }.
        snapshot () {
            let need = 10 + 16 * 11 + 40 * 6 + 10 * 6;
            for (;;) {
                if (scratch.snapshotCapacity < need) { if (scratch.snapshot) x.ts_free (scratch.snapshot); scratch.snapshot = x.ts_alloc (need * 4); scratch.snapshotCapacity = need; }
                const got = x.ts_snapshot (scratch.snapshot, scratch.snapshotCapacity);
                if (got < 0) { need = -got; continue; }
                const a = f32 (scratch.snapshot, got);
                const hikers = [], animals = [], birds = [];
                let at = 10;
                for (let i = 0; i < a[1]; ++i, at += 11)
                    hikers.push ({ channel: a[at], x: a[at + 1], y: a[at + 2], heading: a[at + 3], speed: a[at + 4], noteAge: a[at + 5], noteSeconds: a[at + 6], tiredness: a[at + 7], midiChannel: a[at + 8], soundPreset: a[at + 9] });
                for (let i = 0; i < a[2]; ++i, at += 6)
                    animals.push ({ type: a[at], x: a[at + 1], y: a[at + 2], heading: a[at + 3], speed: a[at + 4], encounterRadius: a[at + 5] });
                for (let i = 0; i < a[9]; ++i, at += 6)
                    birds.push ({ x: a[at], y: a[at + 1], heading: a[at + 2], phase: a[at + 3], excitement: a[at + 4], altitude: a[at + 5] });
                return { tick: a[0], radius: a[3], resolution: a[4], spacing: a[5], paused: a[6] > 0.5, arpOn: a[7] > 0.5, syncBpm: a[8], hikers, animals, birds };
            }
        },

        getProfile (channel) { x.ts_get_profile (channel, scratch.profile); const v = f32 (scratch.profile, 14), o = {}; PROFILE_FIELDS.forEach ((k, i) => o[k] = v[i]); return o; },
        setProfile (channel, profile) { const v = f32 (scratch.profile, 14); PROFILE_FIELDS.forEach ((k, i) => v[i] = profile[k]); x.ts_set_profile (channel, scratch.profile); },

        numPresets: () => x.ts_num_presets(),
        presetName: index => readCString (x.ts_preset_name (index)),
        getPreset (index) { x.ts_get_preset (index, scratch.preset); return Array.from (f32 (scratch.preset, presetFloats)); },
        setPreset (index, values) { f32 (scratch.preset, presetFloats).set (values); x.ts_set_preset (index, scratch.preset); },
        addPreset (values, name) { f32 (scratch.preset, presetFloats).set (values); const i = x.ts_add_preset (scratch.preset); if (i >= 0 && name) { const p = writeCString (name); x.ts_set_preset_name (i, p); x.ts_free (p); } return i; },
        removePreset (index) { return x.ts_remove_preset (index); },
        renamePreset (index, name) { const p = writeCString (name); x.ts_set_preset_name (index, p); x.ts_free (p); },
        presetFloats,

        exportHikers () {
            const per = 3 + 14, ptr = x.ts_alloc (16 * per * 4), n = x.ts_export_hikers (ptr, 16), a = Array.from (f32 (ptr, n * per));
            x.ts_free (ptr);
            const out = [];
            for (let i = 0; i < n; ++i) { const v = a.slice (i * per, (i + 1) * per); out.push ({ channel: v[0], x: v[1], y: v[2], profile: v.slice (3) }); }
            return out;
        },
        importHikers (records) {
            const per = 3 + 14, ptr = x.ts_alloc (Math.max (1, records.length) * per * 4), v = f32 (ptr, Math.max (1, records.length) * per);
            records.forEach ((r, i) => { v[i * per] = r.channel; v[i * per + 1] = r.x; v[i * per + 2] = r.y; r.profile.forEach ((p, k) => v[i * per + 3 + k] = p); });
            x.ts_import_hikers (ptr, records.length); x.ts_free (ptr);
        },
    };
}
