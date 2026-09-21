// Phone layout: the map fills the screen. Tap the map to bring up a dock of buttons; each raises a sheet from the bottom with that group of
// settings. Tap the map again (or the grip above the sheet) to put the sheet away; tap once more to hide the dock.
import { el } from './ui.js';

const $ = id => document.getElementById(id);

export function initPhone(view, { onView } = {}) {
    const small = matchMedia('(max-width: 820px), (max-height: 520px) and (pointer: coarse)');
    const touch = matchMedia('(pointer: coarse)');
    let sheetView = null;            // null, 'place', 'view', 'pages' or 'hiker'
    let built = false, homes = [];

    const setView = v => {
        sheetView = v;
        document.body.dataset.view = v || '';
        for (const b of document.querySelectorAll('#dock [data-view]')) b.classList.toggle('on', b.dataset.view === v);
        onView?.(v);
        fit();
    };
    // While a sheet is up, the map shrinks to the strip above it so the hikers stay in view.
    const fit = () => requestAnimationFrame(() => {
        const sheet = $('sheet'); let h = 0;
        if (sheet && sheetView && isDockOpen()) h = Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top - 4);
        document.documentElement.style.setProperty('--sheet-h', h + 'px');
    });
    const dock = (open) => { document.body.classList.toggle('dock-open', open); fit(); };
    const isDockOpen = () => document.body.classList.contains('dock-open');

    function build() {
        if (built) return; built = true;
        document.body.dataset.view = '';
        const sheet = el('div', { id: 'sheet' }, el('div', { id: 'grip', title: 'Put the panel away' }, el('i')));
        const dockEl = el('div', { id: 'dock', class: 'glass' });
        const extras = el('div', { id: 'dock-extra' },
            el('button', { 'data-view': 'place', text: 'Place', onclick: () => setView(sheetView === 'place' ? null : 'place') }),
            el('button', { 'data-view': 'view', text: 'View', onclick: () => setView(sheetView === 'view' ? null : 'view') }),
            el('button', { 'data-view': 'hiker', text: 'Hiker', onclick: () => setView(sheetView === 'hiker' ? null : 'hiker') }));
        const select = el('button', { id: 'select-btn', text: 'Select', onclick: () => { view.selectMode = !view.selectMode; select.classList.toggle('on', view.selectMode); } });
        $('map').append(select);
        const grip = sheet.firstChild;
        // Move the desktop pieces into the sheet and dock; they are moved back if the window grows.
        const move = (node, to) => { homes.push({ node, parent: node.parentNode, next: node.nextSibling }); to.append(node); };
        move($('tabs'), dockEl);
        dockEl.prepend(extras);
        for (const id of ['top', 'modes', 'pages', 'hiker-panel']) move($(id), sheet);
        document.body.append(sheet, dockEl);
        if (window.ResizeObserver) new ResizeObserver(fit).observe(sheet);
        // Tabs from the desktop layout open the settings sheet.
        $('tabs').addEventListener('click', e => { if (e.target.closest('button')) setView(sheetView === 'pages' && e.target.classList.contains('was-on') ? null : 'pages'); }, true);
        $('tabs').addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (b) b.classList.toggle('was-on', sheetView === 'pages' && b.classList.contains('on')); }, true);
        // Swipe the grip down (or tap it) to put the sheet away.
        let startY = null;
        grip.addEventListener('pointerdown', e => { startY = e.clientY; grip.setPointerCapture(e.pointerId); });
        grip.addEventListener('pointerup', e => { if (startY !== null && (Math.abs(e.clientY - startY) < 8 || e.clientY - startY > 24)) setView(null); startY = null; });
        view.on('tap', () => { if (!small.matches) return; if (sheetView) setView(null); else dock(!isDockOpen()); if (!isDockOpen()) setView(null); });
        view.on('selection', list => { if (!small.matches) return; if (list.length) { dock(true); setView('hiker'); } else if (sheetView === 'hiker') setView(null); });
    }

    function unbuild() {
        if (!built) return; built = false;
        for (const h of homes.reverse()) h.parent.insertBefore(h.node, h.next);
        homes = [];
        $('sheet')?.remove(); $('dock')?.remove(); $('select-btn')?.remove();
        setView(null);
    }

    const apply = () => {
        document.body.classList.toggle('phone', small.matches);
        document.body.classList.toggle('touch', touch.matches);
        view.touch = touch.matches;
        if (small.matches) build(); else unbuild();
        window.dispatchEvent(new Event('resize'));
    };
    small.addEventListener('change', apply); touch.addEventListener('change', apply);
    apply();
    return { setView, showDock: dock };
}
