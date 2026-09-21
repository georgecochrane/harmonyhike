// The main-thread side of the sound and simulation: starts the audio thread and talks to it.
import { createCore } from './core.js';
import { applyCommand, presetList } from './commands.js';

export class Engine {
    constructor() {
        this.context = null;
        this.node = null;
        this.nextId = 1;
        this.replies = new Map();
        this.listeners = { snapshot: [], midi: [], presets: [], state: [] };
        this.presets = [];
        this.ready = false;
    }

    on(type, fn) { this.listeners[type].push(fn); }
    emit(type, ...args) { for (const fn of this.listeners[type]) fn(...args); }

    // Phones only let a page start sound from inside the tap itself, before anything is awaited, so this is called first thing in the Start click:
    // it makes the audio context, wakes it, plays a moment of silence (which unlocks iOS), and asks iOS to play even with the silent switch on.
    prepare() {
        if (this.context || new URLSearchParams(location.search).has('nodevice')) return;
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.context = new Ctx({ latencyHint: 'interactive' });
        this.context.resume?.().catch(() => {});
        try { const b = this.context.createBuffer(1, 1, 22050), s = this.context.createBufferSource(); s.buffer = b; s.connect(this.context.destination); s.start(0); } catch (e) { /* fine */ }
        // If the browser suspends it again (a call, the screen locking, a tab switch), the next touch wakes it.
        const wake = () => { if (this.context && this.context.state !== 'running') this.context.resume?.().catch(() => {}); };
        for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(type, wake, { passive: true });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
        this.context.onstatechange = () => this.emit('state', this.context.state);
    }

    // Must be called from a click or key press (browsers won't start audio otherwise).
    async start(params) {
        if (new URLSearchParams(location.search).has('nodevice')) return this.startWithoutDevice(params);
        this.prepare();
        await this.context.audioWorklet.addModule('js/audio-worklet.bundle.js');
        this.node = new AudioWorkletNode(this.context, 'harmonyhike', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.node.connect(this.context.destination);
        const ready = new Promise(resolve => { this.resolveReady = resolve; });
        this.node.port.onmessage = e => this.receive(e.data);
        const wasm = await (await fetch('harmonyhike-core.wasm')).arrayBuffer();
        this.node.port.postMessage({ cmd: 'init', wasm: wasm.slice(0), params });
        await ready;
        try { this.treeCore = await createCore(wasm, 44100); } catch (e) { this.treeCore = null; }   // (a second copy here on the main thread, only to lay out the forests)
        this.ready = true;
    }

    // For automated tests on a machine with no audio device: the same core, run from a timer on this thread (nothing is played).
    async startWithoutDevice(params) {
        const wasm = await (await fetch('harmonyhike-core.wasm')).arrayBuffer();
        this.core = await createCore(wasm, 44100);
        for (const [k, v] of Object.entries(params)) this.core.setParam(k, v);
        this.context = { currentTime: 0, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: performance.now() }) };
        const left = new Float32Array(128), right = new Float32Array(128);
        let block = 0, last = performance.now();
        this.post = m => queueMicrotask(() => this.receive(m));
        setInterval(() => {
            const now = performance.now(); let blocks = Math.min(60, Math.floor((now - last) / 1000 * 44100 / 128)); last += blocks * 128 / 44100 * 1000;
            while (blocks-- > 0) {
                const events = this.core.process(left, right);
                this.context.currentTime = block * 128 / 44100;
                if (events.length) this.receive({ type: 'midi', time: this.context.currentTime, sampleRate: 44100, events });
                if (++block % 12 === 0) this.receive({ type: 'snapshot', time: this.context.currentTime, snapshot: this.core.snapshot() });
            }
        }, 20);
        this.node = { port: { postMessage: m => applyCommand(this.core, m, this.post) } };
        this.presets = presetList(this.core);
        this.ready = true;
        this.emit('presets', this.presets);
    }

    // The forest for a land surface ({ lat, lon, radius, res, heights, classes, minH, maxH }): 6 numbers per tree, or null when it cannot be made yet.
    // `area` (optional): { density 0..1, gx, gy, radiusGrid, latticeRadius }: only the trees in that circle of the grid, laid out as for a land latticeRadius metres across.
    generateTrees(s, area = {}) {
        const core = this.treeCore || this.core;
        if (!core || !s.classes || !s.heights) return null;
        if (s.minMax === undefined) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < s.heights.length; i += 7) { const h = s.heights[i]; if (h < lo) lo = h; if (h > hi) hi = h; } s.minMax = [lo, hi]; }
        return core.generateTrees(s.lat, s.lon, s.radius, s.res, s.heights, s.classes, s.minMax[0], s.minMax[1], area.density ?? 0.6, area.gx ?? 0, area.gy ?? 0, area.radiusGrid ?? 0, area.latticeRadius ?? 0);
    }

    receive(m) {
        if (m.type === 'reply') { this.replies.get(m.id)?.(m.data); this.replies.delete(m.id); }
        else if (m.type === 'snapshot') this.emit('snapshot', m.snapshot, m.time);
        else if (m.type === 'midi') this.emit('midi', m);
        else if (m.type === 'ready') { this.presets = m.presets; this.resolveReady?.(); this.emit('presets', m.presets); }
        else if (m.type === 'presets') { this.presets = m.presets; this.emit('presets', m.presets); }
    }

    send(cmd, data = {}, transfer) { this.node?.port.postMessage({ cmd, ...data }, transfer || []); }
    ask(cmd, data = {}) {
        return new Promise(resolve => { const id = this.nextId++; this.replies.set(id, resolve); this.node.port.postMessage({ cmd, id, ...data }); });
    }

    setParam(name, value) { this.send('param', { name, value }); }
    setParams(values) { this.send('params', { values }); }
    installTerrain(t) { this.send('terrain', t); }
}
