export function resolveTextureUrl(viewer, path) {
    const raw = typeof path === 'string' ? path.trim() : '';
    if (!raw || raw === 'builtin://checkerboard' || raw.startsWith('builtin://')) {
        return null;
    }
    if (raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw;
    }
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
        return raw;
    }
    return `/texture?path=${encodeURIComponent(raw)}`;
}

export function getTexture(viewer, path) {
    if (!viewer.gl) return null;
    const key = (typeof path === 'string' && path.trim().length > 0)
        ? path.trim()
        : 'builtin://checkerboard';
    if (viewer.textureCache.has(key)) {
        return viewer.textureCache.get(key);
    }
    const gl = viewer.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const texSize = 2048;
    const cellSize = 64;
    const checker = new Uint8Array(texSize * texSize * 4);
    for (let y = 0; y < texSize; y++) {
        for (let x = 0; x < texSize; x++) {
            const odd = ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) & 1) === 1;
            const c = odd ? 220 : 30;
            const o = (y * texSize + x) * 4;
            checker[o] = c;
            checker[o + 1] = c;
            checker[o + 2] = c;
            checker[o + 3] = 255;
        }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texSize, texSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, checker);
    gl.generateMipmap(gl.TEXTURE_2D);
    viewer.textureCache.set(key, texture);

    if (key !== 'builtin://checkerboard' && !key.startsWith('builtin://')) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
        };
        img.onerror = () => {
            console.warn('Failed to load texture image:', key);
        };
        const src = resolveTextureUrl(viewer, key);
        if (src) {
            img.src = src;
        }
    }
    return texture;
}
