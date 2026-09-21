// What the trees' leaves are doing at a place and time of year (the same rule as the desktop app's Source/Terrain/Season.h).
// foliage: 0 bare .. 1 full. autumn: 0 green .. 1 turned. spring: 1 = the pale green of new leaves. Evergreen in the tropics; the south is half a year behind.
export function leafState(latitude, date = new Date()) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0), day = Math.floor((date.getTime() - start) / 86400000) - 1;
    if (Math.abs(latitude) < 23) return { foliage: 1, autumn: 0, spring: 0 };
    let d = latitude < 0 ? (day + 182) % 365 : day;
    const ramp = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    if (d < 95 || d > 345) return { foliage: 0, autumn: 0, spring: 0 };
    return { foliage: Math.min(ramp(d, 95, 140), 1 - ramp(d, 305, 345)), autumn: ramp(d, 255, 310), spring: 1 - ramp(d, 120, 185) };
}
