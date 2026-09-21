// Phone layout: the map fills the screen. Tap the map to bring up a dock of buttons; each raises a sheet from the bottom (a side panel when the
// phone is on its side) with that group of settings. Tap the map again (or the grip above the sheet) to put the sheet away; tap once more to hide the dock.
// The layout follows the *visible* screen (below the browser's toolbars, above the keyboard) and keeps clear of notches and the home bar.
import { el } from './ui.js';

const $ = id => document.getElementById(id);

export function initPhone(view, { onView } = {}) {
    const small = matchMedia('(max-width: 820px), (max-height: 520px) and (pointer: coarse)');
    const touch = matchMedia('(pointer: coarse)');
    const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)');
    const vv = window.visualViewport;
    let sheetView = null;            // null, 'place', 'view', 'pages' or 'hiker'
    let built = false, homes = [];

    // Never let the page itself zoom (it can push the controls out of reach): iOS ignores the viewport tag, so stop its gestures too.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, e => e.preventDefault());
    document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    let lastTap = 0;
    document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTap < 320 && !e.target.closest?.('input, textarea, select')) e.preventDefault(); lastTap = now; }, { passive: false });

    const dockEl = () => $('dock');
    const isDockOpen = () => document.body.classList.contains('dock-open');

    // The size and place of the visible area, kept in CSS variables (the toolbar can slide in and out, or the keyboard can open).
    const syncViewport = () => {
        const r = document.documentElement.style;
        r.setProperty('--vv-h', (vv ? vv.height : window.innerHeight) + 'px');
        r.setProperty('--vv-w', (vv ? vv.width : window.innerWidth) + 'px');
        r.setProperty('--vv-top', (vv ? vv.offsetTop : 0) + 'px');
        r.setProperty('--vv-left', (vv ? vv.offsetLeft : 0) + 'px');
        fit();
    };

    // Safe-area sizes (notch, camera pill, home bar), measured from a probe element.
    let probe = null;
    const safeInsets = () => {
        if (!probe) { probe = el('div', { style: 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' }); document.body.append(probe); }
        const s = getComputedStyle(probe);
        return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
    };

    // While something is up, the map shrinks to the part of the screen left over, so the hikers stay in view.
    const fit = () => requestAnimationFrame(() => {
        const app = $('app'); if (!app) return;
        const root = document.documentElement.style, safe = safeInsets();
        let bottom = 0, right = 0;
        const dock = dockEl(), sheet = $('sheet'), a = app.getBoundingClientRect();
        if (small.matches && isDockOpen() && dock) {
            bottom = Math.max(0, a.bottom - dock.getBoundingClientRect().top + 4);
            if (sheetView && sheet) {
                const s = sheet.getBoundingClientRect();
                if (landscape.matches) right = Math.max(0, a.right - s.left + 4); else bottom = Math.max(bottom, a.bottom - s.top + 4);
            }
        }
        root.setProperty('--map-bottom', bottom + 'px'); root.setProperty('--map-right', right + 'px');
        view.inset = small.matches ? { top: safe.top, left: safe.left, right: right ? 0 : safe.right, bottom: bottom ? 0 : safe.bottom } : { top: 0, left: 0, right: 0, bottom: 0 };
    });

    const setView = v => {
        sheetView = v;
        document.body.dataset.view = v || '';
        for (const b of document.querySelectorAll('#dock [data-view]')) b.classList.toggle('on', b.dataset.view === v);
        onView?.(v);
        fit();
    };
    const dock = open => { document.body.classList.toggle('dock-open', open); fit(); };

    function build() {
        if (built) return; built = true;
        document.body.dataset.view = '';
        const sheet = el('div', { id: 'sheet' }, el('div', { id: 'grip', title: 'Put the panel away' }, el('i')));
        const dockNode = el('div', { id: 'dock', class: 'glass' });
        const extras = el('div', { id: 'dock-extra' },
            el('button', { 'data-view': 'place', text: 'Place', onclick: () => setView(sheetView === 'place' ? null : 'place') }),
            el('button', { 'data-view': 'view', text: 'View', onclick: () => setView(sheetView === 'view' ? null : 'view') }),
            el('button', { 'data-view': 'hiker', text: 'Hiker', onclick: () => setView(sheetView === 'hiker' ? null : 'hiker') }));
        const select = el('button', { id: 'select-btn', text: 'Select', onclick: () => { view.selectMode = !view.selectMode; select.classList.toggle('on', view.selectMode); } });
        const follow = el('button', { id: 'follow-map', class: 'follow-btn', text: 'Follow', onclick: () => window.toggleFollowCamera?.() });
        $('map').append(select, follow);
        const grip = sheet.firstChild;
        // Move the desktop pieces into the sheet and dock; they are moved back if the window grows.
        const move = (node, to) => { homes.push({ node, parent: node.parentNode, next: node.nextSibling }); to.append(node); };
        move($('pause'), $('map'));   // Pause / Resume lives in the map's top left corner, always in reach
        move($('tabs'), dockNode);
        dockNode.prepend(extras);
        for (const id of ['top', 'modes', 'pages', 'hiker-panel']) move($(id), sheet);
        $('app').append(sheet, dockNode);
        if (window.ResizeObserver) { const ro = new ResizeObserver(fit); ro.observe(sheet); ro.observe(dockNode); }
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
        $('sheet')?.remove(); $('dock')?.remove(); $('select-btn')?.remove(); $('follow-map')?.remove();
        document.body.classList.remove('dock-open');
        setView(null);
    }

    const apply = () => {
        document.body.classList.toggle('phone', small.matches);
        document.body.classList.toggle('touch', touch.matches);
        document.body.classList.toggle('landscape', landscape.matches);
        document.body.classList.toggle('standalone', !!(navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches));
        view.touch = touch.matches;
        if (small.matches) build(); else unbuild();
        syncViewport();
        window.dispatchEvent(new Event('resize'));
    };
    for (const m of [small, touch, landscape]) m.addEventListener('change', apply);
    if (vv) { vv.addEventListener('resize', syncViewport); vv.addEventListener('scroll', syncViewport); }
    window.addEventListener('resize', syncViewport); window.addEventListener('orientationchange', () => setTimeout(apply, 250));
    apply();
    return { setView, showDock: dock };
}
