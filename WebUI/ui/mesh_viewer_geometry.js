export function buildPointIndices(vertexCount) {
    const pointIndices = new Array(Math.max(0, vertexCount | 0));
    for (let i = 0; i < pointIndices.length; i++) pointIndices[i] = i;
    return pointIndices;
}

export function buildUniqueEdgeIndices(triIndices) {
    const source = Array.isArray(triIndices) ? triIndices : Array.from(triIndices || [], (v) => v | 0);
    const edges = [];
    const seen = new Set();
    for (let i = 0; i + 2 < source.length; i += 3) {
        const a = source[i] | 0;
        const b = source[i + 1] | 0;
        const c = source[i + 2] | 0;
        const pairs = [[a, b], [b, c], [c, a]];
        for (const [u0, v0] of pairs) {
            const u = Math.min(u0, v0);
            const v = Math.max(u0, v0);
            const key = `${u}:${v}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push(u, v);
        }
    }
    return edges;
}

export function extractGeometry(viewer, payload) {
    const normalizeColorTriplet = (r, g, b) => {
        let nr = Number(r) || 0;
        let ng = Number(g) || 0;
        let nb = Number(b) || 0;
        const needsByteNormalization =
            nr > 1.0 || ng > 1.0 || nb > 1.0;
        if (needsByteNormalization) {
            nr /= 255.0;
            ng /= 255.0;
            nb /= 255.0;
        }
        return [
            Math.max(0, Math.min(1, nr)),
            Math.max(0, Math.min(1, ng)),
            Math.max(0, Math.min(1, nb))
        ];
    };
    const parseColorArray = (raw, vertexCount) => {
        if (!raw) return [];
        if (ArrayBuffer.isView(raw) || (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number')) {
            const arr = Array.from(raw);
            if (arr.length < vertexCount * 3) return [];
            const out = new Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) {
                const o = i * 3;
                out[i] = normalizeColorTriplet(arr[o], arr[o + 1], arr[o + 2]);
            }
            return out;
        }
        if (Array.isArray(raw)) {
            return raw.map(c => normalizeColorTriplet(c?.[0], c?.[1], c?.[2]));
        }
        return [];
    };
    const parseUvArray = (raw, vertexCount) => {
        if (!raw) return [];
        if (ArrayBuffer.isView(raw) || (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number')) {
            const arr = Array.from(raw);
            if (arr.length < vertexCount * 2) return [];
            const out = new Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) {
                const o = i * 2;
                out[i] = [Number(arr[o]) || 0, Number(arr[o + 1]) || 0];
            }
            return out;
        }
        if (Array.isArray(raw)) {
            return raw.map(t => [Number(t?.[0]) || 0, Number(t?.[1]) || 0]);
        }
        return [];
    };
    const parseUvPool = (raw) => {
        if (!raw) return [];
        if (ArrayBuffer.isView(raw) || (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number')) {
            const arr = Array.from(raw);
            const count = Math.floor(arr.length / 2);
            const out = new Array(count);
            for (let i = 0; i < count; i++) {
                const o = i * 2;
                out[i] = [Number(arr[o]) || 0, Number(arr[o + 1]) || 0];
            }
            return out;
        }
        if (Array.isArray(raw)) {
            return raw.map(t => [Number(t?.[0]) || 0, Number(t?.[1]) || 0]);
        }
        return [];
    };
    const parseIntArray = (raw) => {
        if (!raw) return [];
        if (ArrayBuffer.isView(raw) || Array.isArray(raw)) {
            return Array.from(raw, v => v | 0);
        }
        return [];
    };

    const hasPackedPositions = Array.isArray(payload.positions) || ArrayBuffer.isView(payload.positions);
    const hasTri = Array.isArray(payload.triIndices) || ArrayBuffer.isView(payload.triIndices) ||
        Array.isArray(payload.indices) || ArrayBuffer.isView(payload.indices);
    const hasLine = Array.isArray(payload.lineIndices) || ArrayBuffer.isView(payload.lineIndices);
    const hasPoint = Array.isArray(payload.pointIndices) || ArrayBuffer.isView(payload.pointIndices);
    if (hasPackedPositions && (hasTri || hasLine || hasPoint)) {
        const positionsRaw = payload.positions;
        const triRaw = (Array.isArray(payload.triIndices) || ArrayBuffer.isView(payload.triIndices))
            ? payload.triIndices
            : payload.indices;
        const lineRaw = (Array.isArray(payload.lineIndices) || ArrayBuffer.isView(payload.lineIndices))
            ? payload.lineIndices
            : [];
        const pointRaw = (Array.isArray(payload.pointIndices) || ArrayBuffer.isView(payload.pointIndices))
            ? payload.pointIndices
            : [];
        const vertexCount = Math.floor(positionsRaw.length / 3);
        const vertices = new Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            const o = i * 3;
            vertices[i] = [
                Number(positionsRaw[o]) || 0,
                Number(positionsRaw[o + 1]) || 0,
                Number(positionsRaw[o + 2]) || 0
            ];
        }
        const triIndices = Array.from(triRaw || [], v => v | 0);
        let lineIndices = Array.from(lineRaw || [], v => v | 0);
        let pointIndices = Array.from(pointRaw || [], v => v | 0);
        let lineIndicesDerived = false;
        if (lineIndices.length === 0 && triIndices.length > 0) {
            lineIndices = buildUniqueEdgeIndices(triIndices);
            lineIndicesDerived = true;
        }
        if (pointIndices.length === 0) {
            pointIndices = buildPointIndices(vertexCount);
        }
        return {
            vertices,
            triIndices,
            lineIndices,
            lineIndicesDerived,
            pointIndices,
            vertexCount,
            colors: parseColorArray(payload.colors, vertexCount),
            uv: parseUvArray(payload.texcoords, vertexCount),
            uvPool: parseUvPool(payload.texcoords),
            triTexcoordIndices: parseIntArray(payload.triTexcoordIndices),
            vectorLineFlags: parseIntArray(payload.vectorLineFlags),
            texturePath: payload.texturePath || 'builtin://checkerboard'
        };
    }

    const vertices = Array.isArray(payload.vertices) ? payload.vertices : [];
    const triangles = Array.isArray(payload.triangles) ? payload.triangles : [];
    if (vertices.length === 0) return null;
    const triIndices = [];
    for (const tri of triangles) {
        triIndices.push((tri[0] | 0), (tri[1] | 0), (tri[2] | 0));
    }
    const pointIndices = buildPointIndices(vertices.length);
    return {
        vertices,
        triIndices,
        lineIndices: buildUniqueEdgeIndices(triIndices),
        lineIndicesDerived: true,
        pointIndices,
        vertexCount: vertices.length,
        colors: parseColorArray(payload.colors, vertices.length),
        uv: parseUvArray(payload.texcoords, vertices.length),
        uvPool: parseUvPool(payload.texcoords),
        triTexcoordIndices: parseIntArray(payload.triTexcoordIndices),
        vectorLineFlags: parseIntArray(payload.vectorLineFlags),
        texturePath: payload.texturePath || 'builtin://checkerboard'
    };
}
