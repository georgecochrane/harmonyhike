// Web MIDI: send the hikers' notes to a MIDI output (Chrome and Edge; Safari and Firefox don't offer MIDI output), and follow MIDI clock
// from an input, if the browser allows it.
export class MidiBridge {
    constructor() {
        this.access = null; this.output = null; this.input = null; this.supported = typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
        this.pulses = 0; this.lastPulse = 0; this.bpm = 0; this.onTempo = null;
    }

    async enable() {
        if (!this.supported) return false;
        try { this.access = await navigator.requestMIDIAccess({ sysex: false }); } catch (e) { return false; }
        this.access.onstatechange = () => this.onChange?.();
        return true;
    }
    outputs() { return this.access ? [...this.access.outputs.values()] : []; }
    inputs() { return this.access ? [...this.access.inputs.values()] : []; }

    selectOutput(id) { this.output = this.access?.outputs.get(id) ?? null; }
    selectInput(id) {
        if (this.input) this.input.onmidimessage = null;
        this.input = this.access?.inputs.get(id) ?? null;
        if (this.input) this.input.onmidimessage = e => this.message(e);
    }

    // Events from the audio thread: { time (audio-context seconds at the start of the block), sampleRate, events: [{ sample, status, data1, data2 }] }.
    send(m, context) {
        if (!this.output) return;
        const stamp = context.getOutputTimestamp();
        for (const e of m.events) {
            const contextTime = m.time + e.sample / m.sampleRate;
            const when = stamp.performanceTime + (contextTime - stamp.contextTime) * 1000 + 15;
            try { this.output.send([e.status, e.data1, e.data2], when); } catch (err) { /* port went away */ }
        }
    }
    allNotesOff() { if (this.output) for (let c = 0; c < 16; ++c) try { this.output.send([0xB0 | c, 123, 0]); } catch (e) { /* gone */ } }

    message(e) {
        const now = performance.now(), d = e.data;
        if (d[0] === 0xF8) {
            if (this.lastPulse > 0) {
                const period = (now - this.lastPulse) / 1000;
                if (period > 0.002 && period < 0.2) { const instant = 60 / (period * 24); this.bpm = this.bpm <= 0 ? instant : this.bpm + 0.02 * (instant - this.bpm); }
            }
            this.lastPulse = now; ++this.pulses;
        } else if (d[0] === 0xFA) { this.pulses = 0; this.lastPulse = now; }
        else if (d[0] === 0xF2 && d.length >= 3) this.pulses = (d[1] | (d[2] << 7)) * 6;
    }

    // The clock's tempo and position now (invalid if pulses stopped coming).
    tempo() {
        const now = performance.now();
        if (this.lastPulse <= 0 || this.bpm <= 0 || now - this.lastPulse > 500) return { valid: false, bpm: 120, ppq: 0 };
        return { valid: true, bpm: this.bpm, ppq: this.pulses / 24 + Math.min((now - this.lastPulse) / 1000, 2 * 60 / (this.bpm * 24)) * this.bpm / 60 };
    }
}
