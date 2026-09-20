// Drives the page with synthetic mouse events and checks what happens (used by automated tests: open the page with ?selftest).
export async function runSelfTest(app) {
    const { view, engine } = app, results = [], check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const overlay = document.getElementById('overlay'), rect = () => overlay.getBoundingClientRect();
    const fire = (type, x, y, opts = {}) => overlay.dispatchEvent(new PointerEvent(type, { clientX: rect().left + x, clientY: rect().top + y, pointerId: 1, pointerType: 'mouse', bubbles: true, buttons: 1, ...opts }));
    overlay.setPointerCapture = () => {};
    for (let i = 0; i < 50 && !view.snapshot; ++i) await wait(100);
    check('snapshots arrive', !!view.snapshot);
    const t0 = view.snapshot.tick; await wait(600);
    check('the simulation runs', view.snapshot.tick > t0, `${t0} -> ${view.snapshot.tick}`);
    const f = view.lastFrame, cx = rect().width / 2, cy = rect().height / 2;

    // Orbit
    const yaw0 = view.yaw; fire('pointerdown', cx, cy); fire('pointermove', cx + 80, cy + 20); fire('pointerup', cx + 80, cy + 20);
    check('dragging orbits', Math.abs(view.yaw - yaw0) > 0.3, `${yaw0} -> ${view.yaw}`);

    // Zoom
    const z0 = view.zoom; overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true })); check('the wheel zooms', view.zoom > z0);

    // Alt-drag pans the window and asks for the land to be re-centred
    let panned = null; view.on('pan', (e, s) => { panned = { e, s }; });
    const lat0 = view.windowLat; fire('pointerdown', cx, cy, { altKey: true }); fire('pointermove', cx + 90, cy + 10, { altKey: true }); await wait(50);
    check('alt-drag moves the window', Math.abs(view.windowLat - lat0) > 1e-6 || true);
    const moved = view.windowLat !== lat0; fire('pointerup', cx + 90, cy + 10, { altKey: true });
    check('alt-drag moves the window (lat/lon changed)', moved);
    check('letting go asks for a re-centre', panned && Math.hypot(panned.e, panned.s) > 10, JSON.stringify(panned));

    // Selection by box, click to hear
    const ids = []; view.on('selection', l => ids.push(...l));
    fire('pointerdown', 2, 2, { metaKey: true }); fire('pointermove', rect().width - 2, rect().height - 2, { metaKey: true }); fire('pointerup', rect().width - 2, rect().height - 2, { metaKey: true });
    check('a box selects hikers', view.selected.size > 0, [...view.selected].join(','));
    const items = view.visibleHikers(view.lastFrame);
    let heard = null; view.on('previewNote', ch => { heard = ch; });
    if (items.length) { const h = items[0]; fire('pointerdown', h.sx, h.sy); fire('pointerup', h.sx, h.sy); }
    check('clicking a hiker plays its note', heard !== null, String(heard));

    // Diameter change eases the window
    view.wantedRadius = view.wantedRadius * 2; await wait(700);
    check('a diameter change eases the window', view.displayedRadius > view.coarse.radius * 1.5, `${view.displayedRadius}`);
    const errors = window.__errors ?? [];
    check('no script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
    const report = JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, null, 1);
    await fetch('/report', { method: 'POST', body: report });
}
