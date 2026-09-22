// Small helpers for building the controls: sliders, menus, switches, and the tabbed pages under the map.

export const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SCALES = ['Major', 'Natural Minor', 'Pentatonic Major', 'Pentatonic Minor', 'Chromatic'];
export const DIVISIONS = ['1/1', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];

// A sideways bar fader: drag anywhere on it to jump there (no thumb to grab), double-click to reset to `spec.default`,
// arrow/Home/End/PageUp/PageDown to nudge it from the keyboard. `spec` says how the bar's length maps to a value
// (min/max/step, optionally a toPos/fromPos curve for a log or skewed control, same convention as before).
// `onChange` is called after every interaction, in addition to the bar repainting itself, so a caller can keep its
// own value read-out in sync. Returns the bar element itself, with a `.refresh()` that repaints it from `get()`.
export function fader(spec, get, set, onChange) {
    const min = spec.min, max = spec.max, step = spec.step ?? 1;
    const toPos = spec.toPos ?? (v => v), fromPos = spec.fromPos ?? (p => p);
    const tmin = toPos(min), tmax = toPos(max);
    const fraction = v => (toPos(v) - tmin) / (tmax - tmin);
    const fromFraction = f => {
        const raw = fromPos(tmin + f * (tmax - tmin));
        return Math.min(max, Math.max(min, +(Math.round(raw / step) * step).toFixed(6)));
    };
    const fill = el('div', { class: 'fader-fill' }, el('div', { class: 'fader-cap' }));
    const track = el('div', { class: 'fader-track', tabindex: '0', role: 'slider' }, fill);
    if (spec.default !== undefined) {
        const tick = el('div', { class: 'fader-default-tick' });
        tick.style.left = (fraction(spec.default) * 100) + '%';
        track.append(tick);
    }
    const commit = v => { set(v); track.refresh(); onChange?.(); };
    const dragTo = clientX => {
        const r = track.getBoundingClientRect();
        commit(fromFraction(Math.min(1, Math.max(0, (clientX - r.left) / r.width))));
    };
    track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); dragTo(e.clientX); });
    track.addEventListener('pointermove', e => { if (e.buttons) dragTo(e.clientX); });
    track.addEventListener('dblclick', () => { if (spec.default !== undefined) commit(spec.default); });
    track.addEventListener('keydown', e => {
        const big = step * 10;
        let v = get();
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = Math.min(max, v + step);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = Math.max(min, v - step);
        else if (e.key === 'PageUp') v = Math.min(max, v + big);
        else if (e.key === 'PageDown') v = Math.max(min, v - big);
        else if (e.key === 'Home') v = min;
        else if (e.key === 'End') v = max;
        else return;
        e.preventDefault(); commit(+v.toFixed(6));
    });
    track.refresh = () => {
        const v = get();
        fill.style.width = (fraction(v) * 100) + '%';
        track.setAttribute('aria-valuenow', v); track.setAttribute('aria-valuemin', min); track.setAttribute('aria-valuemax', max);
    };
    track.refresh(); onChange?.();
    return track;
}

// A slider row: label, fader, and a value read-out. `spec` says how the fader maps to a value.
export function sliderRow(label, spec, get, set) {
    const val = el('span', { class: 'val' });
    const fmt = spec.format ?? (v => String(Math.round(v * 100) / 100));
    const track = fader(spec, get, set, () => { val.textContent = fmt(get()); });
    track.setAttribute('aria-label', label);
    const row = el('div', { class: 'row' }, el('span', { text: label }), track, val);
    row.refresh = () => { track.refresh(); val.textContent = fmt(get()); };
    return row;
}

export function selectRow(label, options, get, set) {
    const select = el('select', {}, options.map((o, i) => el('option', { value: i, text: o })));
    select.value = get();
    select.addEventListener('change', () => set(parseInt(select.value, 10)));
    const row = el('div', { class: 'row' }, el('span', { text: label }), select);
    row.refresh = () => { select.value = get(); };
    return row;
}

export function toggleRow(label, text, get, set) {
    const box = el('input', { type: 'checkbox' });
    box.checked = !!get();
    box.addEventListener('change', () => set(box.checked ? 1 : 0));
    const row = el('div', { class: 'row toggle' }, el('span', { text: label }), el('label', { class: 'switch' }, box, el('span', { text })));
    row.refresh = () => { box.checked = !!get(); };
    return row;
}

export function buttonRow(label, text, onClick) {
    const row = el('div', { class: 'row toggle' }, el('span', { text: label }), el('button', { text, onclick: onClick }));
    return row;
}

export function twoSelectRow(label, optionsA, getA, setA, optionsB, getB, setB) {
    const a = el('select', {}, optionsA.map((o, i) => el('option', { value: i, text: o }))), b = el('select', {}, optionsB.map((o, i) => el('option', { value: i, text: o })));
    a.value = getA(); b.value = getB();
    a.addEventListener('change', () => setA(parseInt(a.value, 10)));
    b.addEventListener('change', () => setB(parseInt(b.value, 10)));
    const wrap = el('div', { style: 'grid-column:2 / span 2;display:grid;grid-template-columns:1.6fr 1fr;gap:6px' }, a, b);
    const row = el('div', { class: 'row' }, el('span', { text: label }), wrap);
    row.refresh = () => { a.value = getA(); b.value = getB(); };
    return row;
}

// Pages of titled columns under the map, with tabs.
export function buildPages(tabsEl, pagesEl, pages, rememberKey = 'harmonyhike.page') {
    const rows = [];
    let current = Math.min(pages.length - 1, parseInt(localStorage.getItem(rememberKey) ?? '0', 10) || 0);
    const buttons = pages.map((p, i) => el('button', { text: p.name, onclick: () => show(i) }));
    tabsEl.replaceChildren(...buttons);
    const show = i => {
        current = i;
        try { localStorage.setItem(rememberKey, String(i)); } catch (e) { /* private window */ }
        buttons.forEach((b, k) => b.classList.toggle('on', k === i));
        pagesEl.replaceChildren(...pages[i].columns.map(col => el('div', { class: 'col' }, el('h4', { text: col.title.toUpperCase() }), col.rows())));
    };
    show(current);
    return { show, refresh: () => pagesEl.querySelectorAll('.row').forEach(r => r.refresh?.()) };
}
