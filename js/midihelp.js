// A plain-language guide to sending HarmonyHike's MIDI from the browser into music software.
import { el } from './ui.js';

export function openMidiHelp(midi) {
    const ua = navigator.userAgent, mac = /Mac/.test(ua) && !/iPhone|iPad/.test(ua), win = /Windows/.test(ua), ios = /iPhone|iPad|iPod/.test(ua) || (mac && navigator.maxTouchPoints > 1);
    const firefox = /Firefox/.test(ua), safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
    const status = ios ? ['warn', 'This browser cannot send MIDI. iPhones and iPads do not allow web pages to use MIDI ports. Use Chrome or Edge on a computer, or the HarmonyHike desktop app.']
        : !midi.supported ? ['warn', safari ? 'Safari cannot send MIDI from web pages. Open this page in Chrome or Edge.' : firefox ? 'Firefox asks for a MIDI add-on permission and is not fully supported here. Chrome or Edge work best.' : 'This browser cannot send MIDI. Try Chrome or Edge on a computer.']
        : ['ok', 'This browser can send MIDI (Chrome and Edge are the ones that can). You need one virtual MIDI port on your computer, set up once - steps below.'];
    const step = (...lines) => el('ol', {}, ...lines.map(t => el('li', { text: t })));
    const section = (title, body) => el('div', {}, el('h3', { text: title }), ...body);
    const parts = [
        el('h2', { text: 'Sending MIDI to your music software' }),
        el('p', { class: 'help-' + status[0], text: status[1] }),
        el('p', {}, 'The idea: the browser sends notes into a virtual MIDI cable on your computer, and your music software (Ableton Live, Logic, GarageBand, a synth app) listens to that cable. Then set Sound > Output to "MIDI" or "MIDI + internal sound", click "Enable MIDI", and choose the cable in "MIDI out".'),
    ];
    if (!ios) {
        if (mac || !win) parts.push(section('Mac: turn on the IAC Driver (once)', [step(
            'Open Audio MIDI Setup (in Applications > Utilities).',
            'Choose Window > Show MIDI Studio.',
            'Double-click the IAC Driver icon and tick "Device is online".',
            'A port called "IAC Driver Bus 1" now exists. Choose it in "MIDI out" here.',
            'In your music software, enable that port as a MIDI input (in Live: Settings > Link, Tempo & MIDI, turn on Track for it) and arm a MIDI track that plays a synth or sampler.')]));
        if (win || !mac) parts.push(section('Windows: install a virtual MIDI cable (once)', [step(
            'Install the free loopMIDI from Tobias Erichsen (search for "loopMIDI").',
            'Open it and click the + button to create a port (for example "loopMIDI Port").',
            'Choose that port in "MIDI out" here.',
            'In your music software, enable the same port as a MIDI input and arm a MIDI track.')]));
        parts.push(section('Playing from the other direction (tempo)', [el('p', {}, 'To follow your music software\'s tempo, turn on "Follow MIDI clock" on the Sync page, choose the clock input, and have your software send MIDI clock out to the same kind of virtual port.')]));
        parts.push(section('If nothing happens', [step(
            'The first time, the browser asks permission to use MIDI: choose Allow. If you said no, click the lock icon by the address bar to change it.',
            'Check the port is switched on (IAC "Device is online") and picked in both places.',
            'Many notes come out on different MIDI channels (one per hiker); set the software track to receive all channels.',
            'Reload the page after creating a new virtual port.')]));
        parts.push(el('p', { class: 'small' }, 'The desktop app is easier: it makes its own MIDI port called "HarmonyHike" with no setup.'));
    }
    parts.push(el('p', {}, el('button', { text: 'Close', onclick: () => root.remove() })));
    const root = el('div', { class: 'dialog', onclick: e => { if (e.target === root) root.remove(); } }, el('div', { class: 'box glass midihelp' }, ...parts));
    document.getElementById('dialog-root').append(root);
}
