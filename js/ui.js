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

// A slider row: label, slider, and a value read-out. `spec` says how the slider maps to a value.
export function sliderRow(label, spec, get, set) {
    const min = spec.min, max = spec.max, step = spec.step ?? 1;
    const toPos = spec.toPos ?? (v => v), fromPos = spec.fromPos ?? (p => p);
    const range = el('input', { type: 'range', min: toPos(min), max: toPos(max), step: spec.posStep ?? (spec.toPos ? 0.001 : step) });
    const val = el('span', { class: 'val' });
    const fmt = spec.format ?? (v => String(Math.round(v * 100) / 100));
    const snap = v => { const s = Math.round(v / step) * step; return Math.min(max, Math.max(min, +s.toFixed(6))); };
    const show = () => { const v = get(); range.value = toPos(v); val.textContent = fmt(v); };
    range.addEventListener('input', () => { const v = snap(fromPos(parseFloat(range.value))); set(v); val.textContent = fmt(v); });
    range.addEventListener('dblclick', () => { if (spec.default !== undefined) { set(spec.default); show(); } });
    show();
    const row = el('div', { class: 'row' }, el('span', { text: label }), range, val);
    row.refresh = show;
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
export function buildPages(tabsEl, pagesEl, pages, rememberKey = 'trailsynth.page') {
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
