// The audio thread: runs the TrailSynth core (simulation, note-making, sound) and hands back audio, MIDI, and pictures of the world.
import { createCore } from './core.js';
import { applyCommand, presetList } from './commands.js';

class TrailSynthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.core = null;
        this.blocks = 0;
        this.pending = [];
        this.port.onmessage = e => this.handle(e.data);
        this.left = new Float32Array(128);
        this.right = new Float32Array(128);
    }

    async handle(m) {
        if (m.cmd === 'init') {
            this.core = await createCore(m.wasm, sampleRate);
            for (const [k, v] of Object.entries(m.params || {})) this.core.setParam(k, v);
            this.port.postMessage({ type: 'ready', presets: presetList(this.core) });
            for (const queued of this.pending.splice(0)) this.handle(queued);
            return;
        }
        if (!this.core) { this.pending.push(m); return; }
        applyCommand(this.core, m, data => this.port.postMessage(data));
    }

    process(inputs, outputs) {
        const out = outputs[0];
        if (!this.core || !out || out.length < 1) return true;
        const n = out[0].length;
        if (this.left.length !== n) { this.left = new Float32Array(n); this.right = new Float32Array(n); }
        const events = this.core.process(this.left, this.right);
        out[0].set(this.left);
        if (out[1]) out[1].set(this.right);

        if (events.length) this.port.postMessage({ type: 'midi', time: currentTime, sampleRate, events });
        if (++this.blocks % 12 === 0) this.port.postMessage({ type: 'snapshot', time: currentTime, snapshot: this.core.snapshot() });
        return true;
    }
}

registerProcessor('trailsynth', TrailSynthProcessor);
