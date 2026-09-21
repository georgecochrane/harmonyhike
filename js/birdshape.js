// A bird in flight: a small body, tail and beak, and two wings that flap. Local coordinates: x forward (the beak), y up, z to the left; the body is 1 long.
// `flap` is the wing angle in radians (positive: wings up). The wing bends a little more towards its tip, so the tips lag the shoulders as they beat.
const BODY = [78, 122, 190], WING = [58, 96, 164], WING_LIGHT = [92, 138, 206], BEAK = [232, 152, 60];

export function birdTriangles(flap) {
    const t = [];
    const add = (colour, a, b, c) => t.push({ p: [a, b, c], c: colour.map(v => v / 255) });
    const N = [0.5, 0, 0], T = [-0.35, 0, 0], U = [0.05, 0.13, 0], D = [0.05, -0.11, 0], L = [0.05, 0, 0.11], R = [0.05, 0, -0.11];
    for (const [a, b] of [[U, L], [L, D], [D, R], [R, U]]) add(BODY, N, a, b);
    for (const [a, b] of [[L, U], [D, L], [R, D], [U, R]]) add(BODY, T, a, b);
    add(BEAK, N, [0.63, -0.03, 0], [0.5, -0.06, 0]);
    add(WING, [-0.35, 0, 0.07], [-0.35, 0, -0.07], [-0.62, 0.01, 0]);
    for (const s of [1, -1]) {
        const hinge = [0, 0.05, s * 0.09], a1 = flap, a2 = flap * 1.5;
        const inner = 0.4, outer = 0.45;
        const at = (x, r1, r2) => {   // a point on the wing: r1 out along the inner part, r2 out along the outer part
            let y = hinge[1] + r1 * Math.sin(a1), z = hinge[2] + s * r1 * Math.cos(a1);
            y += r2 * Math.sin(a2); z += s * r2 * Math.cos(a2);
            return [x, y, z];
        };
        const A0 = at(0.2, 0, 0), A1 = at(-0.2, 0, 0), B0 = at(0.12, inner, 0), B1 = at(-0.12, inner, 0), C0 = at(0.0, inner, outer), C1 = at(-0.16, inner, outer);
        add(WING, A0, A1, B1); add(WING, A0, B1, B0);
        add(WING_LIGHT, B0, B1, C1); add(WING_LIGHT, B0, C1, C0);
    }
    return t;
}
