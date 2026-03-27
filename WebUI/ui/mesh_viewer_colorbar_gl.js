export function buildColorbarTextureData(stops, width = 512) {
    const safeStops = Array.isArray(stops) && stops.length > 0
        ? stops
        : [{ position: 0, color: '#ffffff' }, { position: 1, color: '#ffffff' }];
    const data = new Uint8Array(width * 4);
    const hexToRgb = (hex) => {
        const n = Number.parseInt((hex || '#ffffff').slice(1), 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    for (let i = 0; i < width; i++) {
        const t = width <= 1 ? 0 : i / (width - 1);
        let left = safeStops[0];
        let right = safeStops[safeStops.length - 1];
        for (let k = 1; k < safeStops.length; k++) {
            if (safeStops[k].position >= t) {
                left = safeStops[k - 1];
                right = safeStops[k];
                break;
            }
        }
        const denom = Math.max(1e-6, right.position - left.position);
        const u = Math.max(0, Math.min(1, (t - left.position) / denom));
        const lc = hexToRgb(left.color);
        const rc = hexToRgb(right.color);
        const o = i * 4;
        data[o] = Math.round(lc.r + (rc.r - lc.r) * u);
        data[o + 1] = Math.round(lc.g + (rc.g - lc.g) * u);
        data[o + 2] = Math.round(lc.b + (rc.b - lc.b) * u);
        data[o + 3] = 255;
    }
    return data;
}

export function ensureColorbarTexture(viewer) {
    if (!viewer.gl) return null;
    const gl = viewer.gl;
    if (!viewer.colorbarTexture) {
        viewer.colorbarTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, viewer.colorbarTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return viewer.colorbarTexture;
}

export function updateColorbarTexture(viewer, stopsOverride = null) {
    const gl = viewer.gl;
    if (!gl || !viewer.colorbar) return;
    const tex = ensureColorbarTexture(viewer);
    if (!tex) return;
    const stops = Array.isArray(stopsOverride) ? stopsOverride : viewer.colorbar.getStops();
    const width = 512;
    const data = buildColorbarTextureData(stops, width);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}
