// What the audio thread does with a command from the page. Shared by the AudioWorklet and by the main-thread stand-in used when there is
// no audio device (automated tests).
export function presetList(core) {
    const list = [];
    for (let i = 0; i < core.numPresets(); ++i) list.push({ name: core.presetName(i), values: core.getPreset(i) });
    return list;
}

export function applyCommand(core, m, post) {
    const c = core, x = c.exports, reply = data => post({ type: 'reply', id: m.id, data });
    switch (m.cmd) {
        case 'param': c.setParam(m.name, m.value); break;
        case 'params': for (const [k, v] of Object.entries(m.values)) c.setParam(k, v); break;
        case 'terrain': c.installTerrain(m.lat, m.lon, m.radius, m.res, m.heights, m.classes, m.density, m.panEast || 0, m.panSouth || 0); break;
        case 'addHiker': reply(x.ts_add_hiker(m.x, m.y)); break;
        case 'removeHiker': reply(x.ts_remove_hiker(m.channel)); break;
        case 'moveHiker': x.ts_move_hiker(m.channel, m.x, m.y); break;
        case 'clearHikers': x.ts_clear_hikers(); break;
        case 'previewNote': x.ts_preview_note(m.channel); break;
        case 'getProfile': reply(c.getProfile(m.channel)); break;
        case 'setProfiles': for (const ch of m.channels) { const p = { ...c.getProfile(ch), ...m.changes }; c.setProfile(ch, p); } break;
        case 'presets': reply(presetList(c)); break;
        case 'setPreset': c.setPreset(m.index, m.values); break;
        case 'addPreset': reply(c.addPreset(m.values, m.name)); post({ type: 'presets', presets: presetList(c) }); break;
        case 'removePreset': reply(c.removePreset(m.index)); post({ type: 'presets', presets: presetList(c) }); break;
        case 'renamePreset': c.renamePreset(m.index, m.name); break;
        case 'reverb': x.ts_set_reverb(m.decay, m.lowpass, m.highpass, m.size); break;
        case 'audition': x.ts_audition(m.preset, m.note, m.seconds); break;
        case 'waterInView': x.ts_set_water_in_view(m.amount, m.pan, m.waves); break;
        case 'hikerPans': for (const [ch, pan] of m.pans) x.ts_set_hiker_screen_pan(ch, pan); break;
        case 'splash': x.ts_push_splash(m.pan); break;
        case 'treeDensity': x.ts_set_tree_density(m.value); break;
        case 'ambient': x.ts_set_ambient_temperature(m.celsius); break;
        case 'tempo': x.ts_set_tempo(m.valid ? 1 : 0, m.bpm, m.ppq); break;
        case 'exportHikers': reply(c.exportHikers()); break;
        case 'importHikers': c.importHikers(m.records); break;
    }
}
