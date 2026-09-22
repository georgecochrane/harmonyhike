// The WebGL renderer: sky, the circular window of land, hikers, animals, glows and clouds. The window/camera maths is in view.js; this
// file draws whatever it is handed.

const TAU = Math.PI * 2;

const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) + '\n' + source);
    return shader;
};
const program = (gl, vertex, fragment) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; ++i) { const info = gl.getActiveUniform(p, i); uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u: uniforms };
};

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp usampler2D;\n';

// ------------------------------------------------------------------------------------------------ terrain
const TERRAIN_VS = HEADER + `
uniform mat4 uViewProj;
uniform sampler2D uHeights;
uniform usampler2D uClasses;
uniform float uTime;
uniform int uRes;
uniform int uHasClasses;
uniform vec2 uCentreG;
uniform float uGridPerUnit, uSpacing, uMid, uExag, uRadius, uMinH, uRange, uCells;
uniform vec3 uLight;
in vec2 aCell, aCorner;
flat out vec3 vColour;
flat out float vValid;
out vec2 vWin;

float hAt(vec2 g) {
    vec2 gg = clamp(g, vec2(0.0), vec2(float(uRes - 1)));
    ivec2 i0 = ivec2(floor(gg));
    vec2 f = gg - vec2(i0);
    ivec2 i1 = min(i0 + 1, ivec2(uRes - 1));
    float a = texelFetch(uHeights, ivec2(i0.x, i0.y), 0).r, b = texelFetch(uHeights, ivec2(i1.x, i0.y), 0).r;
    float c = texelFetch(uHeights, ivec2(i0.x, i1.y), 0).r, d = texelFetch(uHeights, ivec2(i1.x, i1.y), 0).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 elevationColour(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 low = vec3(46., 110., 58.) / 255., mid = vec3(150., 122., 76.) / 255., high = vec3(238., 238., 240.) / 255.;
    return t < 0.5 ? mix(low, mid, t / 0.5) : mix(mid, high, (t - 0.5) / 0.5);
}
void main() {
    vec2 winC = -1.0 + 2.0 * (aCell + 0.5) / uCells;
    vec2 winV = -1.0 + 2.0 * (aCell + aCorner) / uCells;
    vec2 gc = uCentreG + winC * uGridPerUnit;
    vValid = (gc.x >= 0.0 && gc.y >= 0.0 && gc.x <= float(uRes - 1) && gc.y <= float(uRes - 1)) ? 1.0 : 0.0;

    // The ground under the cell centre: its slope lights the whole cell, its class colours it.
    float hx = hAt(gc + vec2(1.0, 0.0)) - hAt(gc - vec2(1.0, 0.0));
    float hz = hAt(gc + vec2(0.0, 1.0)) - hAt(gc - vec2(0.0, 1.0));
    float dhdx = hx / (2.0 * uSpacing) * uExag, dhdz = hz / (2.0 * uSpacing) * uExag;
    float nLen = sqrt(dhdx * dhdx + 1.0 + dhdz * dhdz);
    float diffuse = max(0.0, (-dhdx * uLight.x + uLight.y - dhdz * uLight.z) / nLen);
    float elev = (hAt(gc) - uMinH) / uRange;
    uint cls = 0u;
    bool flatWater = false;
    if (uHasClasses == 1) {
        // Blue only where the water really is flat: all four surrounding vertices are water. Anywhere else the land colour shows (shores, islands, rocks).
        ivec2 g0 = ivec2(clamp(floor(gc), vec2(0.0), vec2(float(uRes - 2))));
        uint c00 = texelFetch(uClasses, g0, 0).r, c10 = texelFetch(uClasses, g0 + ivec2(1, 0), 0).r, c01 = texelFetch(uClasses, g0 + ivec2(0, 1), 0).r, c11 = texelFetch(uClasses, g0 + ivec2(1, 1), 0).r;
        if (c00 == 3u && c10 == 3u && c01 == 3u && c11 == 3u) { cls = 3u; flatWater = true; }
        else {
            uint near = texelFetch(uClasses, ivec2(clamp(round(gc), vec2(0.0), vec2(float(uRes - 1)))), 0).r;
            cls = near != 3u ? near : (c00 != 3u ? c00 : c10 != 3u ? c10 : c01 != 3u ? c01 : c11);
        }
    }
    vec3 base = cls == 3u ? vec3(54., 122., 196.) / 255. : cls == 2u ? vec3(196., 172., 148.) / 255. : cls == 1u ? vec3(178., 196., 92.) / 255. : elevationColour(elev);
    float shade = clamp(0.4 + 0.75 * diffuse, 0.0, 1.4);
    if (flatWater) {
        // Water shimmers: slow ripples of light and dark drifting across it, and now and then a cell flashes bright like sun on a wave.
        vec2 cellId = floor(gc);
        float ripple = 0.5 + 0.25 * sin(dot(cellId, vec2(0.55, 0.32)) + uTime * 0.9) + 0.25 * sin(dot(cellId, vec2(-0.31, 0.63)) - uTime * 1.3);
        float phase = fract(sin(dot(cellId, vec2(12.9898, 78.233))) * 43758.5453);
        float glint = pow(max(0.0, sin(uTime * (1.4 + 1.6 * phase) + phase * 40.0)), 24.0) * step(0.85, fract(phase * 7.31));
        base = mix(base * vec3(0.86, 0.93, 1.0), base * vec3(1.12, 1.12, 1.1), ripple) + vec3(0.9, 0.95, 1.0) * glint * 0.6;
        shade = 0.95 + 0.15 * shade;   // water is lit evenly: it is flat
    }
    vColour = min(vec3(1.0), base * shade);

    float h = hAt(uCentreG + winV * uGridPerUnit);
    float y = (h - uMid) / uRadius * uExag;
    vWin = winV;
    gl_Position = uViewProj * vec4(winV.x, y, winV.y, 1.0);
}`;
const TERRAIN_FS = HEADER + `
flat in vec3 vColour;
flat in float vValid;
in vec2 vWin;
out vec4 o;
void main() {
    if (vValid < 0.5 || dot(vWin, vWin) > 1.0) discard;
    o = vec4(vColour, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ trees
// Instanced: one small mesh per kind of tree (its shape in units of the tree's own height and radius), drawn once per tree with its place, size and colour.
// The top of a tree sways in the wind (more the higher up it is).
const TREE_VS = HEADER + `
uniform mat4 uViewProj;
uniform vec3 uLight;
uniform float uTime, uSway;
uniform vec2 uWind;
in vec3 aPos, aNormal;
in vec2 aBendPart;                 // how far up the tree (sway), and which part (0 crown, 1 trunk, 2 upper crown)
in vec3 iBase;                     // where it stands (window x, ground y, window z)
in vec2 iSize;                     // height, radius
in vec3 iColour;
in float iPhase;
flat out vec3 vColour;
void main() {
    float height = iSize.x, radius = iSize.y;
    float swing = uSway * height * (sin(uTime * 1.6 + iPhase) + 0.25 * sin(uTime * 3.1 + 2.0 * iPhase));
    float bend = aBendPart.x * aBendPart.x;
    vec3 world = iBase + vec3(aPos.x * radius, aPos.y * height, aPos.z * radius) + vec3(uWind.x, 0.0, uWind.y) * swing * bend;
    gl_Position = uViewProj * vec4(world, 1.0);
    float lit = max(0.0, dot(normalize(aNormal), uLight));
    vec3 base = aBendPart.y > 0.5 && aBendPart.y < 1.5 ? vec3(0.30, 0.21, 0.14) : iColour * (aBendPart.y > 1.5 ? 1.07 : 1.0);
    vColour = min(vec3(1.0), base * (0.5 + 0.65 * lit));
}`;
const TREE_FS = HEADER + `
flat in vec3 vColour;
out vec4 o;
void main() { o = vec4(vColour, 1.0); }`;

// The shapes: [x, y, z, bend, part] per vertex, three vertices per triangle; normals are worked out (pointing away from the trunk's axis).
function treeShape(kind) {
    const tris = [];
    const pyramid = (y0, y1, r, bend0, bend1, part) => {
        const b = [[-r, y0, -r], [r, y0, -r], [r, y0, r], [-r, y0, r]], top = [0, y1, 0];
        for (let i = 0; i < 4; ++i) tris.push([[...b[i], bend0, part], [...b[(i + 1) % 4], bend0, part], [...top, bend1, part]]);
    };
    if (kind === 1) { pyramid(0.14, 0.62, 1, 0.10, 0.55, 0); pyramid(0.42, 1.0, 0.66, 0.40, 1.0, 2); }
    else {
        const w = 0.14;
        const a = [[-w, 0, -w], [w, 0, -w], [w, 0, w], [-w, 0, w]], c = a.map(p => [p[0], 0.42, p[2]]);
        for (let i = 0; i < 4; ++i) { const j = (i + 1) % 4; tris.push([[...a[i], 0, 1], [...a[j], 0, 1], [...c[j], 0.4, 1]]); tris.push([[...a[i], 0, 1], [...c[j], 0.4, 1], [...c[i], 0.4, 1]]); }
        pyramid(0.66, 0.36, 1, 0.6, 0.35, 0);  // the lower half of the crown points down...
        pyramid(0.66, 1.0, 0.85, 0.6, 1.0, 2); // ...the upper half points up
    }
    const data = [];
    for (const t of tris) {
        const e1 = t[1].slice(0, 3).map((v, i) => v - t[0][i]), e2 = t[2].slice(0, 3).map((v, i) => v - t[0][i]);
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
        const yAxis = t[0][5] === 1 ? cy : kind === 1 ? 0.5 : 0.66;
        if (n[0] * cx + n[1] * (cy - yAxis) + n[2] * cz < 0) n = n.map(v => -v);
        const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
        for (const v of t) data.push(v[0], v[1], v[2], n[0], n[1], n[2], v[3], v[4]);
    }
    return new Float32Array(data);
}

// Birds: plain lit triangles, drawn from both sides (wings are thin).
const BIRD_VS = HEADER + `
uniform mat4 uViewProj;
in vec3 aPos, aColour;
flat out vec3 vColour;
void main() { vColour = aColour; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const BIRD_FS = HEADER + `
flat in vec3 vColour;
out vec4 o;
void main() { o = vec4(vColour, 1.0); }`;

// The rock wall round the edge and the disc under the land.
const SKIRT_VS = HEADER + `
uniform mat4 uViewProj;
uniform sampler2D uHeights;
uniform int uRes;
uniform vec2 uCentreG;
uniform float uGridPerUnit, uMid, uExag, uRadius, uBaseY;
uniform vec3 uLight;
in float aAngle, aTop;
out vec3 vColour;
float hAt(vec2 g) {
    vec2 gg = clamp(g, vec2(0.0), vec2(float(uRes - 1)));
    ivec2 i0 = ivec2(floor(gg)); vec2 f = gg - vec2(i0); ivec2 i1 = min(i0 + 1, ivec2(uRes - 1));
    float a = texelFetch(uHeights, i0, 0).r, b = texelFetch(uHeights, ivec2(i1.x, i0.y), 0).r;
    float c = texelFetch(uHeights, ivec2(i0.x, i1.y), 0).r, d = texelFetch(uHeights, i1, 0).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
    vec2 w = vec2(cos(aAngle), sin(aAngle));
    float y = aTop > 0.5 ? (hAt(uCentreG + w * uGridPerUnit) - uMid) / uRadius * uExag : uBaseY;
    float facing = max(0.0, w.x * uLight.x + w.y * uLight.z) ; // (the wall's normal points out along w)
    vColour = min(vec3(1.0), vec3(92., 72., 54.) / 255. * (0.55 + 0.7 * facing));
    gl_Position = uViewProj * vec4(w.x, y, w.y, 1.0);
}`;
const SKIRT_FS = HEADER + `
in vec3 vColour;
out vec4 o;
void main() { o = vec4(vColour, 1.0); }`;

// ------------------------------------------------------------------------------------------------ figures (hikers and animals)
const FIGURE_VS = HEADER + `
uniform mat4 uViewProj;
uniform vec3 uBase;          // where it stands: window x, ground height, window z
uniform vec2 uYaw;           // cos, sin of the turn to its heading
uniform float uScale;
uniform float uSwing;        // radians: hiker limbs swing by this (times each part's sign)
uniform int uKind;           // 0 hiker, 1 animal
uniform vec3 uPivot[5];
uniform float uPartSign[5];  // hiker: swing sign; animal: 1 if the part is a leg that swings (per its diagonal pair), else 0
uniform float uTilt, uMidY;
in vec3 aPos;
in float aPart;
in vec3 aColour;
out vec3 vWorld;
out vec3 vColour;
void main() {
    int part = int(aPart + 0.5);
    vec3 p = aPos;
    float angle = uKind == 0 ? uPartSign[part] * uSwing : uPartSign[part] * uSwing;
    if (angle != 0.0) {
        vec3 pv = uPivot[part];
        float dy = p.y - pv.y, dz = p.z - pv.z;
        p.y = pv.y + dy * cos(angle) - dz * sin(angle);
        p.z = pv.z + dy * sin(angle) + dz * cos(angle);
    }
    if (uTilt != 0.0) {
        float dy = p.y - uMidY;
        float y = uMidY + dy * cos(uTilt) + p.z * sin(uTilt);
        float z = -dy * sin(uTilt) + p.z * cos(uTilt);
        p.y = y; p.z = z;
    }
    vec3 w = vec3((p.x * uYaw.x + p.z * uYaw.y) * uScale + uBase.x, p.y * uScale + uBase.y, (-p.x * uYaw.y + p.z * uYaw.x) * uScale + uBase.z);
    vWorld = w;
    vColour = aColour;
    gl_Position = uViewProj * vec4(w, 1.0);
}`;
const FIGURE_FS = HEADER + `
uniform vec3 uLight;
uniform int uKind;
uniform vec3 uPalette[7];
uniform float uHue, uBright, uAmbient, uGain;
in vec3 vWorld;
in vec3 vColour;
out vec4 o;
vec3 hueRotate(vec3 c, float turns) {
    float a = turns * 6.2831853, cs = cos(a), sn = sin(a);
    mat3 m = mat3(0.299 + 0.701 * cs + 0.168 * sn, 0.299 - 0.299 * cs - 0.328 * sn, 0.299 - 0.300 * cs + 1.250 * sn,
                  0.587 - 0.587 * cs + 0.330 * sn, 0.587 + 0.413 * cs + 0.035 * sn, 0.587 - 0.588 * cs - 1.050 * sn,
                  0.114 - 0.114 * cs - 0.497 * sn, 0.114 - 0.114 * cs + 0.292 * sn, 0.114 + 0.886 * cs - 0.203 * sn);
    return clamp(m * c, 0.0, 1.0);
}
void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float lit = max(0.0, dot(n, uLight));
    vec3 base = uKind == 0 ? uPalette[int(vColour.x + 0.5)] : vColour;
    if (uKind == 1 && uHue != 0.0) base = hueRotate(base, uHue) * uBright;
    o = vec4(min(vec3(1.0), base * (uAmbient + uGain * lit)), 1.0);
}`;

// ------------------------------------------------------------------------------------------------ glows on the ground
const GLOW_VS = HEADER + `
uniform mat4 uViewProj;
in vec3 aPos;
in vec2 aUV;
in vec4 aColour;
out vec2 vUV;
out vec4 vColour;
void main() { vUV = aUV; vColour = aColour; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const GLOW_FS = HEADER + `
in vec2 vUV;
in vec4 vColour;
out vec4 o;
void main() {
    float r = length(vUV);
    if (r > 1.0) discard;
    float ring = smoothstep(0.42, 0.74, r) * (1.0 - smoothstep(0.80, 1.0, r));
    float a = vColour.a * (0.85 * ring + 0.10 * (1.0 - r));
    o = vec4(vColour.rgb * a, a);   // (added to what is there)
}`;

// ------------------------------------------------------------------------------------------------ clouds
const CLOUD_VS = HEADER + `
uniform mat4 uViewProj;
uniform vec3 uRight, uUp;
in vec2 aCorner;
in vec4 aCentreRadius;   // world centre, radius
in vec4 aLight;          // highlight offset (x, y in sprite units), height factor, unused
out vec2 vUV;
out vec3 vWorld;
out vec3 vLight;
void main() {
    vec3 w = aCentreRadius.xyz + (uRight * aCorner.x + uUp * aCorner.y) * aCentreRadius.w;
    vUV = aCorner; vWorld = w; vLight = aLight.xyz;
    gl_Position = uViewProj * vec4(w, 1.0);
}`;
const CLOUD_FS = HEADER + `
uniform vec3 uLit, uShade;
uniform float uOpacity, uTopY;
in vec2 vUV;
in vec3 vWorld;
in vec3 vLight;
out vec4 o;
void main() {
    float r = length(vUV);
    if (r > 1.0) discard;
    float wall = 1.0 - smoothstep(0.985, 1.02, length(vWorld.xz));   // cut off at the cylinder over the map
    float roof = 1.0 - smoothstep(uTopY - 0.02, uTopY, vWorld.y);
    vec2 hl = vLight.xy;
    float d = length(vUV - hl) / 1.3;   // distance from the bright spot
    vec3 belly = mix(uShade, uLit, 0.35 + 0.65 * vLight.z);
    vec3 col = mix(uLit, belly, smoothstep(0.0, 0.85, d));
    float alpha = (0.42 * (1.0 - smoothstep(0.0, 0.35, d)) + 0.25 * smoothstep(0.0, 0.5, d) * (1.0 - smoothstep(0.7, 1.0, r))) * uOpacity;
    alpha *= 1.0 - smoothstep(0.75, 1.0, r);
    alpha *= wall * roof;
    o = vec4(col * alpha, alpha);   // premultiplied
}`;

// ------------------------------------------------------------------------------------------------ sky and screen tint
const SKY_VS = HEADER + `
out vec2 vScreen;
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vScreen = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.999, 1.0);
}`;
const SKY_FS = HEADER + `
uniform sampler2D uSky;
uniform vec2 uSize;
uniform float uFocal, uYaw, uPitch;
in vec2 vScreen;
out vec4 o;
void main() {
    vec2 px = vec2(vScreen.x * uSize.x, (1.0 - vScreen.y) * uSize.y);
    float a = (px.x - uSize.x * 0.5) / uFocal, b = (uSize.y * 0.5 - px.y) / uFocal;
    float sp = sin(uPitch), cp = cos(uPitch), cy = cos(uYaw), sy = sin(uYaw);
    float dx = a, dy = -sp + b * cp, dz = -cp - b * sp;
    float wx = dx * cy - dz * sy, wz = dx * sy + dz * cy;
    float len = sqrt(dx * dx + dy * dy + dz * dz);
    float lon = atan(wx, -wz), lat = asin(clamp(dy / len, -1.0, 1.0));
    vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);
    vec3 c = texture(uSky, uv).rgb;
    float dim = lat < 0.0 ? 1.0 - min(0.3, -lat * 0.8) : 1.0;
    o = vec4(c * dim, 1.0);
}`;
const TINT_FS = HEADER + `
uniform vec4 uColour;
in vec2 vScreen;
out vec4 o;
void main() { o = uColour; }`;

export class Renderer {
    constructor(canvas) {
        const gl = this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error('WebGL 2 is not available in this browser');
        this.canvas = canvas;
        this.programs = {
            terrain: program(gl, TERRAIN_VS, TERRAIN_FS), skirt: program(gl, SKIRT_VS, SKIRT_FS), figure: program(gl, FIGURE_VS, FIGURE_FS),
            glow: program(gl, GLOW_VS, GLOW_FS), tree: program(gl, TREE_VS, TREE_FS), bird: program(gl, BIRD_VS, BIRD_FS), cloud: program(gl, CLOUD_VS, CLOUD_FS), sky: program(gl, SKY_VS, SKY_FS), tint: program(gl, SKY_VS, TINT_FS),
        };
        this.models = null;
        this.skies = new Map();
        this.skyTexture = null;
        this.surface = { heights: null, classes: null, res: 0, key: null };
        this.buildMeshes();
        this.trees = [1, 0].map(kind => this.makeTreeMesh(kind));
        {   // birds: a buffer refilled every frame
            const p = this.programs.bird, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
            const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            for (const [name, offset] of [['aPos', 0], ['aColour', 3]]) { const l = gl.getAttribLocation(p.p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 24, offset * 4); }
            gl.bindVertexArray(null);
            this.birdMesh = { vao, buf };
        }
        this.emptyVao = gl.createVertexArray();
    }

    makeTreeMesh(kind) {
        const gl = this.gl, p = this.programs.tree, data = treeShape(kind);
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const mesh = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const at = (name, size, offset) => { const l = gl.getAttribLocation(p.p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 32, offset * 4); return l; };
        at('aPos', 3, 0); at('aNormal', 3, 3); at('aBendPart', 2, 6);
        const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        const ia = (name, size, offset) => { const l = gl.getAttribLocation(p.p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 36, offset * 4); gl.vertexAttribDivisor(l, 1); };
        ia('iBase', 3, 0); ia('iSize', 2, 3); ia('iColour', 3, 5); ia('iPhase', 1, 8);
        gl.bindVertexArray(null);
        return { vao, inst, count: data.length / 8 };
    }

    drawBirds(f) {
        if (!f.birds) return;
        const gl = this.gl, p = this.programs.bird;
        gl.useProgram(p.p); gl.uniformMatrix4fv(p.u.uViewProj, false, f.viewProj);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(this.birdMesh.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.birdMesh.buf);
        gl.bufferData(gl.ARRAY_BUFFER, f.birds, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, f.birds.length / 6);
        gl.bindVertexArray(null);
    }

    drawTrees(f) {
        const t = f.trees; if (!t) return;
        const gl = this.gl, p = this.programs.tree;
        gl.useProgram(p.p);
        gl.uniformMatrix4fv(p.u.uViewProj, false, f.viewProj);
        gl.uniform3fv(p.u.uLight, f.light);
        gl.uniform1f(p.u.uTime, t.time % 100000); gl.uniform1f(p.u.uSway, t.sway); gl.uniform2f(p.u.uWind, t.windX, t.windZ);
        gl.disable(gl.CULL_FACE);
        [[this.trees[0], t.conifer, t.nConifer], [this.trees[1], t.broad, t.nBroad]].forEach(([mesh, data, n]) => {
            if (!n) return;
            gl.bindVertexArray(mesh.vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.inst); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n);
        });
        gl.bindVertexArray(null);
    }

    buildMeshes() {
        const gl = this.gl;
        // The window's grid of cells (six vertices each so a cell can be lit and coloured as one).
        const N = this.cells = 128;
        const cell = new Float32Array(N * N * 6 * 2), corner = new Float32Array(N * N * 6 * 2);
        const corners = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
        let k = 0;
        for (let j = 0; j < N; ++j) for (let i = 0; i < N; ++i) for (const c of corners) { cell[k] = i; cell[k + 1] = j; corner[k] = c[0]; corner[k + 1] = c[1]; k += 2; }
        this.terrainVao = gl.createVertexArray();
        gl.bindVertexArray(this.terrainVao);
        this.attribute(this.programs.terrain, 'aCell', cell, 2);
        this.attribute(this.programs.terrain, 'aCorner', corner, 2);
        this.terrainVertices = N * N * 6;

        // The wall round the edge.
        const S = this.skirtSegments = 256, ang = new Float32Array((S + 1) * 2), top = new Float32Array((S + 1) * 2);
        for (let s = 0; s <= S; ++s) { ang[s * 2] = ang[s * 2 + 1] = s / S * TAU; top[s * 2] = 1; top[s * 2 + 1] = 0; }
        this.skirtVao = gl.createVertexArray();
        gl.bindVertexArray(this.skirtVao);
        this.attribute(this.programs.skirt, 'aAngle', ang, 1);
        this.attribute(this.programs.skirt, 'aTop', top, 1);

        // Glows (dynamic), clouds (dynamic).
        this.glowBuffer = gl.createBuffer();
        this.glowVao = gl.createVertexArray();
        gl.bindVertexArray(this.glowVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuffer);
        const stride = 9 * 4, glow = this.programs.glow.p;
        for (const [name, size, offset] of [['aPos', 3, 0], ['aUV', 2, 12], ['aColour', 4, 20]]) {
            const loc = gl.getAttribLocation(glow, name);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
        }

        this.cloudBuffer = gl.createBuffer();
        this.cloudVao = gl.createVertexArray();
        gl.bindVertexArray(this.cloudVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuffer);
        const cstride = 10 * 4, cloud = this.programs.cloud.p;
        for (const [name, size, offset] of [['aCorner', 2, 0], ['aCentreRadius', 4, 8], ['aLight', 4, 24]]) {
            const loc = gl.getAttribLocation(cloud, name);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, cstride, offset);
        }
        gl.bindVertexArray(null);
    }

    attribute(prog, name, data, size) {
        const gl = this.gl, loc = gl.getAttribLocation(prog.p, name), buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }

    async loadAssets(base = '') {
        const gl = this.gl;
        const models = await (await fetch(base + 'assets/models.json')).json();
        const makeFigure = (positions, parts, colours) => {
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            this.attribute(this.programs.figure, 'aPos', new Float32Array(positions), 3);
            this.attribute(this.programs.figure, 'aPart', new Float32Array(parts), 1);
            this.attribute(this.programs.figure, 'aColour', new Float32Array(colours), 3);
            gl.bindVertexArray(null);
            return { vao, count: parts.length };
        };
        this.animals = {};
        for (const m of models.animals) {
            const pos = [], part = [], col = [];
            for (let t = 0; t < m.triangles.length; t += 7) {
                for (let c = 0; c < 3; ++c) {
                    const v = m.triangles[t + c] * 3;
                    pos.push(m.vertices[v], m.vertices[v + 1], m.vertices[v + 2]);
                    part.push(m.triangles[t + 3]);
                    col.push(m.triangles[t + 4] / 255, m.triangles[t + 5] / 255, m.triangles[t + 6] / 255);
                }
            }
            this.animals[m.type] = { ...makeFigure(pos, part, col), model: m };
        }
        const h = models.hiker, pos = [], part = [], col = [];
        for (let t = 0; t < h.triangles.length; t += 5) {
            for (let c = 0; c < 3; ++c) {
                const v = h.triangles[t + c] * 3;
                pos.push(h.vertices[v], h.vertices[v + 1], h.vertices[v + 2]);
                part.push(h.triangles[t + 3]);
                col.push(h.triangles[t + 4], 0, 0);
            }
        }
        this.hiker = { ...makeFigure(pos, part, col), model: h };
        this.models = models;
    }

    async loadSky(name, base = '') {
        const gl = this.gl;
        if (!this.skies.has(name)) {
            const image = await createImageBitmap(await (await fetch(`${base}assets/skies/${name}.jpg`)).blob());
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.skies.set(name, tex);
        }
        this.skyTexture = this.skies.get(name);
        this.skyName = name;
    }

    // The land the window is cut from: heights (metres) on a res x res grid, and classes (0..3) if known.
    setSurface(surface) {
        const gl = this.gl;
        if (this.surface.key === surface.key && this.surface.hasClasses === !!surface.classes) return;
        if (!this.heightTexture) {
            this.heightTexture = gl.createTexture();
            this.classTexture = gl.createTexture();
        }
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, surface.res, surface.res, 0, gl.RED, gl.FLOAT, surface.heights);
        for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.classTexture);
        const classes = surface.classes || new Uint8Array(surface.res * surface.res);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, surface.res, surface.res, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, classes);
        for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
        this.surface = { key: surface.key, res: surface.res, hasClasses: !!surface.classes };
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        return dpr;
    }

    // frame: { viewProj (Float32Array 16), size, focal, yaw, pitch, window: {...}, light, daylight, hikers, animals, glows, clouds, ... }
    render(f) {
        const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
        gl.viewport(0, 0, W, H);
        gl.disable(gl.BLEND);
        gl.clearColor(0.05, 0.07, 0.1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Sky
        if (this.skyTexture) {
            gl.disable(gl.DEPTH_TEST);
            const s = this.programs.sky;
            gl.useProgram(s.p);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
            gl.uniform1i(s.u.uSky, 0);
            gl.uniform2f(s.u.uSize, W, H);
            gl.uniform1f(s.u.uFocal, f.focalSky * (W / f.cssWidth));
            gl.uniform1f(s.u.uYaw, f.yaw);
            gl.uniform1f(s.u.uPitch, f.pitch * 0.25);
            gl.bindVertexArray(this.emptyVao);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        const w = f.window;

        if (this.surface.res > 0) {
            // Terrain
            const t = this.programs.terrain;
            gl.disable(gl.CULL_FACE);
            gl.useProgram(t.p);
            gl.uniformMatrix4fv(t.u.uViewProj, false, f.viewProj);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.heightTexture); gl.uniform1i(t.u.uHeights, 1);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.classTexture); gl.uniform1i(t.u.uClasses, 2);
            gl.uniform1f(t.u.uTime, (performance.now() % 100000) / 1000);
            gl.uniform1i(t.u.uRes, this.surface.res);
            gl.uniform1i(t.u.uHasClasses, this.surface.hasClasses ? 1 : 0);
            gl.uniform2f(t.u.uCentreG, w.centreGX, w.centreGY);
            gl.uniform1f(t.u.uGridPerUnit, w.gridPerUnit);
            gl.uniform1f(t.u.uSpacing, w.spacing);
            gl.uniform1f(t.u.uMid, w.mid); gl.uniform1f(t.u.uExag, w.exag); gl.uniform1f(t.u.uRadius, w.radius);
            gl.uniform1f(t.u.uMinH, w.minH); gl.uniform1f(t.u.uRange, w.range);
            gl.uniform1f(t.u.uCells, this.cells);
            gl.uniform3fv(t.u.uLight, f.light);
            gl.bindVertexArray(this.terrainVao);
            gl.drawArrays(gl.TRIANGLES, 0, this.terrainVertices);

            // The rock wall
            const k = this.programs.skirt;
            gl.useProgram(k.p);
            gl.uniformMatrix4fv(k.u.uViewProj, false, f.viewProj);
            gl.activeTexture(gl.TEXTURE1); gl.uniform1i(k.u.uHeights, 1);
            gl.uniform1i(k.u.uRes, this.surface.res);
            gl.uniform2f(k.u.uCentreG, w.centreGX, w.centreGY);
            gl.uniform1f(k.u.uGridPerUnit, w.gridPerUnit);
            gl.uniform1f(k.u.uMid, w.mid); gl.uniform1f(k.u.uExag, w.exag); gl.uniform1f(k.u.uRadius, w.radius);
            gl.uniform1f(k.u.uBaseY, w.baseY);
            gl.uniform3fv(k.u.uLight, f.light);
            gl.bindVertexArray(this.skirtVao);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, (this.skirtSegments + 1) * 2);
            gl.enable(gl.CULL_FACE);
        }

        // Trees
        this.drawTrees(f);
        this.drawBirds(f);

        // Figures
        if (this.models) {
            const p = this.programs.figure;
            gl.useProgram(p.p);
            gl.uniformMatrix4fv(p.u.uViewProj, false, f.viewProj);
            gl.uniform3fv(p.u.uLight, f.light);
            for (const a of f.animals) this.drawAnimal(a, f);
            for (const h of f.hikers) this.drawHiker(h, f);
        }

        // Glows
        if (f.glows.length) {
            const g = this.programs.glow;
            const data = new Float32Array(f.glows.length * 6 * 9);
            let n = 0;
            for (const r of f.glows) {
                const c = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
                for (const [cx, cz] of c) {
                    data.set([r.x + cx * r.radius, r.y, r.z + cz * r.radius, cx, cz, r.colour[0], r.colour[1], r.colour[2], r.intensity], n); n += 9;
                }
            }
            gl.useProgram(g.p);
            gl.uniformMatrix4fv(g.u.uViewProj, false, f.viewProj);
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false); gl.disable(gl.CULL_FACE);
            gl.bindVertexArray(this.glowVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, f.glows.length * 6);
            gl.depthMask(true);
        }

        // Clouds (back to front)
        if (f.clouds.count > 0) {
            const c = this.programs.cloud;
            gl.useProgram(c.p);
            gl.uniformMatrix4fv(c.u.uViewProj, false, f.viewProj);
            gl.uniform3fv(c.u.uRight, f.camRight); gl.uniform3fv(c.u.uUp, f.camUp);
            gl.uniform3fv(c.u.uLit, f.clouds.lit); gl.uniform3fv(c.u.uShade, f.clouds.shade);
            gl.uniform1f(c.u.uOpacity, f.clouds.opacity); gl.uniform1f(c.u.uTopY, f.clouds.topY);
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false); gl.disable(gl.CULL_FACE);
            gl.bindVertexArray(this.cloudVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, f.clouds.data, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, f.clouds.count * 6);
            gl.depthMask(true);
        }

        // Night, over everything.
        if (f.tint) {
            const t = this.programs.tint;
            gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.useProgram(t.p);
            gl.uniform4fv(t.u.uColour, f.tint);
            gl.bindVertexArray(this.emptyVao);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
    }

    drawHiker(h, f) {
        const gl = this.gl, p = this.programs.figure, m = this.hiker.model;
        gl.uniform1i(p.u.uKind, 0);
        gl.uniform3f(p.u.uBase, h.x, h.groundY, h.z);
        gl.uniform2f(p.u.uYaw, Math.cos(h.yaw), Math.sin(h.yaw));
        gl.uniform1f(p.u.uScale, h.scale);
        gl.uniform1f(p.u.uSwing, h.swing);
        gl.uniform1f(p.u.uTilt, 0); gl.uniform1f(p.u.uMidY, 0);
        const pivots = new Float32Array(15), signs = new Float32Array(5);
        m.parts.forEach((part, i) => { pivots.set(part.pivot, i * 3); signs[i] = part.swing; });
        gl.uniform3fv(p.u.uPivot, pivots);
        gl.uniform1fv(p.u.uPartSign, signs);
        const palette = m.palettes[((h.channel - 1) % m.palettes.length + m.palettes.length) % m.palettes.length];
        gl.uniform3fv(p.u.uPalette, new Float32Array(palette.map(v => v / 255)));
        gl.uniform1f(p.u.uAmbient, 0.6); gl.uniform1f(p.u.uGain, 0.55); gl.uniform1f(p.u.uHue, 0); gl.uniform1f(p.u.uBright, 1);
        gl.enable(gl.CULL_FACE);
        gl.bindVertexArray(this.hiker.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.hiker.count);
    }

    drawAnimal(a, f) {
        const entry = this.animals[a.type];
        if (!entry) return;
        const gl = this.gl, p = this.programs.figure, m = entry.model;
        gl.uniform1i(p.u.uKind, 1);
        gl.uniform3f(p.u.uBase, a.x, a.y, a.z);
        gl.uniform2f(p.u.uYaw, Math.cos(a.yaw), Math.sin(a.yaw));
        gl.uniform1f(p.u.uScale, a.scale);
        gl.uniform1f(p.u.uSwing, a.legSwing || 0);
        gl.uniform1f(p.u.uTilt, a.tilt || 0); gl.uniform1f(p.u.uMidY, m.heightUnits * 0.5);
        const pivots = new Float32Array(15), signs = new Float32Array(5);
        for (let i = 0; i < 5; ++i) {
            pivots.set(m.pivot[i], i * 3);
            // Front-left and back-right swing together, against front-right and back-left.
            signs[i] = i >= 1 && m.hasPart[i] ? (i === 1 || i === 4 ? 1 : -1) : 0;
        }
        gl.uniform3fv(p.u.uPivot, pivots);
        gl.uniform1fv(p.u.uPartSign, signs);
        gl.uniform1f(p.u.uAmbient, 0.55); gl.uniform1f(p.u.uGain, 0.6);
        gl.uniform1f(p.u.uHue, a.hue || 0); gl.uniform1f(p.u.uBright, a.brightness || 1);
        gl.enable(gl.CULL_FACE);
        gl.bindVertexArray(entry.vao);
        gl.drawArrays(gl.TRIANGLES, 0, entry.count);
    }
}
