export function pickVertex(viewer, clientX, clientY) {
    if (!viewer.currentMeshHandle || !viewer.canvas) return null;
    if (viewer.vertexPositions.size === 0) return null;
    const rect = viewer.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ndcX = (x / rect.width) * 2 - 1;
    const ndcY = -((y / rect.height) * 2 - 1);
    const ray = getRayFromNDC(viewer, ndcX, ndcY);
    if (!ray) return null;
    const boundsMin = viewer.currentPayload?.boundsMin || [-1, -1, -1];
    const boundsMax = viewer.currentPayload?.boundsMax || [1, 1, 1];
    const sx = boundsMax[0] - boundsMin[0];
    const sy = boundsMax[1] - boundsMin[1];
    const sz = boundsMax[2] - boundsMin[2];
    const meshSize = Math.hypot(sx, sy, sz);
    const threshold = Math.max(0.01, meshSize * 0.05 * viewer.cameraDistance);
    const result = queryVertexBVH(viewer, ray.origin, ray.direction, threshold);
    return result && result.vertexId !== null ? result.vertexId : null;
}

export function pickEdge(viewer, clientX, clientY) {
    if (!viewer.currentMeshHandle || !viewer.canvas || viewer.edgeList.length === 0) return null;
    const rect = viewer.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ndcX = (x / rect.width) * 2 - 1;
    const ndcY = -((y / rect.height) * 2 - 1);
    const ray = getRayFromNDC(viewer, ndcX, ndcY);
    if (!ray) return null;
    const boundsMin = viewer.currentPayload?.boundsMin || [-1, -1, -1];
    const boundsMax = viewer.currentPayload?.boundsMax || [1, 1, 1];
    const sx = boundsMax[0] - boundsMin[0];
    const sy = boundsMax[1] - boundsMin[1];
    const sz = boundsMax[2] - boundsMin[2];
    const meshSize = Math.hypot(sx, sy, sz);
    const threshold = Math.max(0.02, meshSize * 0.08 * viewer.cameraDistance);
    const result = queryEdgeBVH(viewer, ray.origin, ray.direction, threshold);
    return result && result.edgeId !== null ? result.edgeId : null;
}

export function pickFace(viewer, clientX, clientY) {
    if (!viewer.currentMeshHandle || !viewer.canvas || viewer.faceList.length === 0) return null;
    const rect = viewer.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ndcX = (x / rect.width) * 2 - 1;
    const ndcY = -((y / rect.height) * 2 - 1);
    const ray = getRayFromNDC(viewer, ndcX, ndcY);
    if (!ray) return null;
    const result = queryFaceBVH(viewer, ray.origin, ray.direction);
    return result && result.faceId !== null ? result.faceId : null;
}

export function rayToSegmentDistance(viewer, rayOrigin, rayDir, segStart, segEnd) {
    const u = [segEnd[0] - segStart[0], segEnd[1] - segStart[1], segEnd[2] - segStart[2]];
    const v = rayDir;
    const w = [segStart[0] - rayOrigin[0], segStart[1] - rayOrigin[1], segStart[2] - rayOrigin[2]];
    const a = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const c = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
    const e = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    const denom = a * c - b * b;
    let sc;
    let tc;
    if (denom < 0.0001) {
        sc = 0.0;
        tc = (b > c ? d / b : e / c);
    } else {
        sc = (b * e - c * d) / denom;
        tc = (a * e - b * d) / denom;
    }
    sc = Math.max(0, Math.min(1, sc));
    const closestOnSeg = [
        segStart[0] + sc * u[0],
        segStart[1] + sc * u[1],
        segStart[2] + sc * u[2]
    ];
    const closestOnRay = [
        rayOrigin[0] + tc * v[0],
        rayOrigin[1] + tc * v[1],
        rayOrigin[2] + tc * v[2]
    ];
    const dx = closestOnSeg[0] - closestOnRay[0];
    const dy = closestOnSeg[1] - closestOnRay[1];
    const dz = closestOnSeg[2] - closestOnRay[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function rayTriangleIntersection(viewer, rayOrigin, rayDir, v0, v1, v2) {
    const EPSILON = 0.0000001;
    const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const normal = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ];
    const h = [
        rayDir[1] * edge2[2] - rayDir[2] * edge2[1],
        rayDir[2] * edge2[0] - rayDir[0] * edge2[2],
        rayDir[0] * edge2[1] - rayDir[1] * edge2[0]
    ];
    const a = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
    if (a > -EPSILON && a < EPSILON) {
        return null;
    }
    const f = 1.0 / a;
    const s = [rayOrigin[0] - v0[0], rayOrigin[1] - v0[1], rayOrigin[2] - v0[2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0.0 || u > 1.0) {
        return null;
    }
    const q = [
        s[1] * edge1[2] - s[2] * edge1[1],
        s[2] * edge1[0] - s[0] * edge1[2],
        s[0] * edge1[1] - s[1] * edge1[0]
    ];
    const v = f * (rayDir[0] * q[0] + rayDir[1] * q[1] + rayDir[2] * q[2]);
    if (v < 0.0 || u + v > 1.0) {
        return null;
    }
    const t = f * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
    if (t > EPSILON) {
        const len = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
        return {
            t,
            normal: [normal[0] / len, normal[1] / len, normal[2] / len]
        };
    }
    return null;
}

export function getRayFromNDC(viewer, ndcX, ndcY) {
    if (!viewer.currentPayload) return null;
    const boundsMin = viewer.currentPayload.boundsMin || [-1, -1, -1];
    const boundsMax = viewer.currentPayload.boundsMax || [1, 1, 1];
    const center = [
        (boundsMin[0] + boundsMax[0]) * 0.5,
        (boundsMin[1] + boundsMax[1]) * 0.5,
        (boundsMin[2] + boundsMax[2]) * 0.5
    ];
    const sx = boundsMax[0] - boundsMin[0];
    const sy = boundsMax[1] - boundsMin[1];
    const sz = boundsMax[2] - boundsMin[2];
    const radius = Math.max(0.001, 0.5 * Math.hypot(sx, sy, sz));
    const dist = Math.max(viewer.cameraDistance * radius, 0.01);
    const camOffset = viewer.rotateByQuat([0, 0, dist], viewer.viewQuat);
    const origin = [
        camOffset[0] + center[0] + viewer.cameraPan[0],
        camOffset[1] + center[1] + viewer.cameraPan[1],
        camOffset[2] + center[2] + viewer.cameraPan[2]
    ];
    const aspect = viewer.canvas.width / viewer.canvas.height;
    const fovY = 45 * Math.PI / 180;
    const tanHalfFov = Math.tan(fovY / 2);
    const right = viewer.rotateByQuat([1, 0, 0], viewer.viewQuat);
    const up = viewer.rotateByQuat([0, 1, 0], viewer.viewQuat);
    const forward = viewer.rotateByQuat([0, 0, -1], viewer.viewQuat);
    const direction = [
        forward[0] + right[0] * ndcX * aspect * tanHalfFov + up[0] * ndcY * tanHalfFov,
        forward[1] + right[1] * ndcX * aspect * tanHalfFov + up[1] * ndcY * tanHalfFov,
        forward[2] + right[2] * ndcX * aspect * tanHalfFov + up[2] * ndcY * tanHalfFov
    ];
    const len = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
    if (len < 0.0001) return null;
    return {
        origin,
        direction: [direction[0] / len, direction[1] / len, direction[2] / len]
    };
}

export function pointToRayDistance(viewer, point, rayOrigin, rayDir) {
    const v = [point[0] - rayOrigin[0], point[1] - rayOrigin[1], point[2] - rayOrigin[2]];
    const t = v[0] * rayDir[0] + v[1] * rayDir[1] + v[2] * rayDir[2];
    const closest = [
        rayOrigin[0] + rayDir[0] * t,
        rayOrigin[1] + rayDir[1] * t,
        rayOrigin[2] + rayDir[2] * t
    ];
    const dx = point[0] - closest[0];
    const dy = point[1] - closest[1];
    const dz = point[2] - closest[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dragVertex(viewer, vertexId, dx, dy) {
    const pos = viewer.vertexPositions.get(vertexId);
    if (!pos || !viewer.currentPayload) return;
    const boundsMin = viewer.currentPayload.boundsMin || [-1, -1, -1];
    const boundsMax = viewer.currentPayload.boundsMax || [1, 1, 1];
    const sx = boundsMax[0] - boundsMin[0];
    const sy = boundsMax[1] - boundsMin[1];
    const sz = boundsMax[2] - boundsMin[2];
    const radius = Math.max(0.001, 0.5 * Math.hypot(sx, sy, sz));
    const scale = (2.0 * radius * viewer.cameraDistance) / Math.max(1, viewer.canvas.clientHeight || viewer.canvas.height);
    const right = viewer.rotateByQuat([1, 0, 0], viewer.viewQuat);
    const up = viewer.rotateByQuat([0, 1, 0], viewer.viewQuat);
    pos[0] += (-dx * right[0] + dy * up[0]) * scale;
    pos[1] += (-dx * right[1] + dy * up[1]) * scale;
    pos[2] += (-dx * right[2] + dy * up[2]) * scale;
}

export function prepareInteractionGeometry(viewer, handle) {
    if (!handle || handle.geometryInteractionReady === true) {
        return;
    }
    initVertexPositions(viewer, handle);
    handle.geometryInteractionReady = true;
}

export function scheduleInteractionGeometryPrep(viewer, handle) {
    if (!handle || !handle.key || handle.geometryInteractionReady === true) return;
    if (viewer.pendingGeometryPrep.has(handle.key)) return;
    const task = (async () => {
        await viewer.afterNextPaint();
        prepareInteractionGeometry(viewer, handle);
    })().finally(() => {
        viewer.pendingGeometryPrep.delete(handle.key);
    });
    viewer.pendingGeometryPrep.set(handle.key, task);
    viewer.runWhenIdle(() => task);
}

export function ensureInteractionGeometryReady(viewer, handle) {
    if (!handle) return;
    if (handle.geometryInteractionReady === true) return;
    prepareInteractionGeometry(viewer, handle);
}

export function initVertexPositions(viewer, handle) {
    viewer.vertexPositions.clear();
    viewer.edgeList = [];
    viewer.faceList = [];
    if (handle.isComposite && handle.parts) {
        let globalVertexId = 0;
        for (const part of handle.parts) {
            if (part.geometry && part.geometry.vertices) {
                const vertexOffset = globalVertexId;
                for (let i = 0; i < part.geometry.vertices.length; i++) {
                    const v = part.geometry.vertices[i];
                    viewer.vertexPositions.set(globalVertexId++, [...v]);
                }
                if (part.geometry.triIndices) {
                    buildEdgesAndFacesFromTriangles(viewer, part.geometry.triIndices, vertexOffset);
                }
                if (part.geometry.lineIndices) {
                    buildEdgesFromLines(viewer, part.geometry.lineIndices, vertexOffset);
                }
            }
        }
    } else if (handle.geometry && handle.geometry.vertices) {
        for (let i = 0; i < handle.geometry.vertices.length; i++) {
            const v = handle.geometry.vertices[i];
            viewer.vertexPositions.set(i, [...v]);
        }
        if (handle.geometry.triIndices) {
            buildEdgesAndFacesFromTriangles(viewer, handle.geometry.triIndices, 0);
        }
        if (handle.geometry.lineIndices) {
            buildEdgesFromLines(viewer, handle.geometry.lineIndices, 0);
        }
    }
    buildVertexBVH(viewer);
    buildEdgeBVH(viewer);
    buildFaceBVH(viewer);
}

export function buildEdgesAndFacesFromTriangles(viewer, triIndices, vertexOffset) {
    const edgeSet = new Set();
    for (let i = 0; i < triIndices.length; i += 3) {
        const v1 = triIndices[i] + vertexOffset;
        const v2 = triIndices[i + 1] + vertexOffset;
        const v3 = triIndices[i + 2] + vertexOffset;
        viewer.faceList.push([v1, v2, v3]);
        const edges = [
            [Math.min(v1, v2), Math.max(v1, v2)],
            [Math.min(v2, v3), Math.max(v2, v3)],
            [Math.min(v3, v1), Math.max(v3, v1)]
        ];
        for (const [a, b] of edges) {
            const edgeKey = `${a}-${b}`;
            if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                viewer.edgeList.push([a, b]);
            }
        }
    }
}

export function buildEdgesFromLines(viewer, lineIndices, vertexOffset) {
    const edgeSet = new Set(viewer.edgeList.map(([a, b]) => `${a}-${b}`));
    for (let i = 0; i < lineIndices.length; i += 2) {
        const v1 = lineIndices[i] + vertexOffset;
        const v2 = lineIndices[i + 1] + vertexOffset;
        const a = Math.min(v1, v2);
        const b = Math.max(v1, v2);
        const edgeKey = `${a}-${b}`;
        if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            viewer.edgeList.push([a, b]);
        }
    }
}

export function buildVertexBVH(viewer) {
    if (viewer.vertexPositions.size === 0) {
        viewer.vertexBVH = null;
        return;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [, pos] of viewer.vertexPositions) {
        minX = Math.min(minX, pos[0]);
        minY = Math.min(minY, pos[1]);
        minZ = Math.min(minZ, pos[2]);
        maxX = Math.max(maxX, pos[0]);
        maxY = Math.max(maxY, pos[1]);
        maxZ = Math.max(maxZ, pos[2]);
    }
    const meshSize = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    const epsilon = meshSize * 0.01;
    const vertexBounds = [];
    for (const [vid, pos] of viewer.vertexPositions) {
        vertexBounds.push({
            idx: vid,
            minX: pos[0] - epsilon,
            minY: pos[1] - epsilon,
            minZ: pos[2] - epsilon,
            maxX: pos[0] + epsilon,
            maxY: pos[1] + epsilon,
            maxZ: pos[2] + epsilon
        });
    }
    viewer.vertexBVH = buildBVHRecursive(viewer, vertexBounds, 0);
}

export function buildEdgeBVH(viewer) {
    if (viewer.edgeList.length === 0) {
        viewer.edgeBVH = null;
        return;
    }
    const edgeBounds = viewer.edgeList.map((edge, idx) => {
        const [v1, v2] = edge;
        const p1 = viewer.vertexPositions.get(v1);
        const p2 = viewer.vertexPositions.get(v2);
        if (!p1 || !p2) return null;
        return {
            idx,
            minX: Math.min(p1[0], p2[0]),
            minY: Math.min(p1[1], p2[1]),
            minZ: Math.min(p1[2], p2[2]),
            maxX: Math.max(p1[0], p2[0]),
            maxY: Math.max(p1[1], p2[1]),
            maxZ: Math.max(p1[2], p2[2])
        };
    }).filter((b) => b !== null);
    viewer.edgeBVH = buildBVHRecursive(viewer, edgeBounds, 0);
}

export function buildFaceBVH(viewer) {
    if (viewer.faceList.length === 0) {
        viewer.faceBVH = null;
        return;
    }
    const faceBounds = viewer.faceList.map((face, idx) => {
        const [v1, v2, v3] = face;
        const p1 = viewer.vertexPositions.get(v1);
        const p2 = viewer.vertexPositions.get(v2);
        const p3 = viewer.vertexPositions.get(v3);
        if (!p1 || !p2 || !p3) return null;
        return {
            idx,
            minX: Math.min(p1[0], p2[0], p3[0]),
            minY: Math.min(p1[1], p2[1], p3[1]),
            minZ: Math.min(p1[2], p2[2], p3[2]),
            maxX: Math.max(p1[0], p2[0], p3[0]),
            maxY: Math.max(p1[1], p2[1], p3[1]),
            maxZ: Math.max(p1[2], p2[2], p3[2])
        };
    }).filter((b) => b !== null);
    viewer.faceBVH = buildBVHRecursive(viewer, faceBounds, 0);
}

export function buildBVHRecursive(viewer, primitives, depth) {
    if (primitives.length === 0) return null;
    if (primitives.length <= 4) {
        return { isLeaf: true, primitives, bounds: computeBounds(viewer, primitives) };
    }
    const bounds = computeBounds(viewer, primitives);
    const extentX = bounds.maxX - bounds.minX;
    const extentY = bounds.maxY - bounds.minY;
    const extentZ = bounds.maxZ - bounds.minZ;
    let axis = 0;
    if (extentY > extentX && extentY > extentZ) axis = 1;
    else if (extentZ > extentX && extentZ > extentY) axis = 2;
    primitives.sort((a, b) => {
        const centerA = axis === 0 ? (a.minX + a.maxX) / 2 : axis === 1 ? (a.minY + a.maxY) / 2 : (a.minZ + a.maxZ) / 2;
        const centerB = axis === 0 ? (b.minX + b.maxX) / 2 : axis === 1 ? (b.minY + b.maxY) / 2 : (b.minZ + b.maxZ) / 2;
        return centerA - centerB;
    });
    const mid = Math.floor(primitives.length / 2);
    return {
        isLeaf: false,
        bounds,
        left: buildBVHRecursive(viewer, primitives.slice(0, mid), depth + 1),
        right: buildBVHRecursive(viewer, primitives.slice(mid), depth + 1)
    };
}

export function computeBounds(viewer, primitives) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of primitives) {
        minX = Math.min(minX, p.minX);
        minY = Math.min(minY, p.minY);
        minZ = Math.min(minZ, p.minZ);
        maxX = Math.max(maxX, p.maxX);
        maxY = Math.max(maxY, p.maxY);
        maxZ = Math.max(maxZ, p.maxZ);
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function rayAABBIntersection(viewer, rayOrigin, rayDir, bounds) {
    const invDirX = 1.0 / rayDir[0];
    const invDirY = 1.0 / rayDir[1];
    const invDirZ = 1.0 / rayDir[2];
    const t1 = (bounds.minX - rayOrigin[0]) * invDirX;
    const t2 = (bounds.maxX - rayOrigin[0]) * invDirX;
    const t3 = (bounds.minY - rayOrigin[1]) * invDirY;
    const t4 = (bounds.maxY - rayOrigin[1]) * invDirY;
    const t5 = (bounds.minZ - rayOrigin[2]) * invDirZ;
    const t6 = (bounds.maxZ - rayOrigin[2]) * invDirZ;
    const tmin = Math.max(Math.max(Math.min(t1, t2), Math.min(t3, t4)), Math.min(t5, t6));
    const tmax = Math.min(Math.min(Math.max(t1, t2), Math.max(t3, t4)), Math.max(t5, t6));
    return tmax >= tmin && tmax >= 0;
}

export function queryEdgeBVH(viewer, rayOrigin, rayDir, threshold) {
    if (!viewer.edgeBVH) return null;
    let closestEdgeId = null;
    let closestDist = threshold;
    const traverse = (node) => {
        if (!node || !rayAABBIntersection(viewer, rayOrigin, rayDir, node.bounds)) return;
        if (node.isLeaf) {
            for (const prim of node.primitives) {
                const [v1, v2] = viewer.edgeList[prim.idx];
                const p1 = viewer.vertexPositions.get(v1);
                const p2 = viewer.vertexPositions.get(v2);
                if (!p1 || !p2) continue;
                const dist = rayToSegmentDistance(viewer, rayOrigin, rayDir, p1, p2);
                if (dist < closestDist) {
                    const midpoint = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5, (p1[2] + p2[2]) * 0.5];
                    if (!isPointOccluded(viewer, midpoint, rayOrigin)) {
                        closestDist = dist;
                        closestEdgeId = `${v1}-${v2}`;
                    }
                }
            }
        } else {
            traverse(node.left);
            traverse(node.right);
        }
    };
    traverse(viewer.edgeBVH);
    return { edgeId: closestEdgeId, distance: closestDist };
}

export function queryFaceBVH(viewer, rayOrigin, rayDir) {
    if (!viewer.faceBVH) return null;
    let closestFaceId = null;
    let closestDist = Infinity;
    const traverse = (node) => {
        if (!node || !rayAABBIntersection(viewer, rayOrigin, rayDir, node.bounds)) return;
        if (node.isLeaf) {
            for (const prim of node.primitives) {
                const [v1, v2, v3] = viewer.faceList[prim.idx];
                const p1 = viewer.vertexPositions.get(v1);
                const p2 = viewer.vertexPositions.get(v2);
                const p3 = viewer.vertexPositions.get(v3);
                if (!p1 || !p2 || !p3) continue;
                const intersection = rayTriangleIntersection(viewer, rayOrigin, rayDir, p1, p2, p3);
                if (intersection !== null && intersection.t > 0) {
                    const dotProduct = rayDir[0] * intersection.normal[0] + rayDir[1] * intersection.normal[1] + rayDir[2] * intersection.normal[2];
                    if (dotProduct < 0 && intersection.t < closestDist) {
                        closestDist = intersection.t;
                        closestFaceId = prim.idx;
                    }
                }
            }
        } else {
            traverse(node.left);
            traverse(node.right);
        }
    };
    traverse(viewer.faceBVH);
    return { faceId: closestFaceId, distance: closestDist };
}

export function isPointOccluded(viewer, point, rayOrigin) {
    const dx = point[0] - rayOrigin[0];
    const dy = point[1] - rayOrigin[1];
    const dz = point[2] - rayOrigin[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.0001) return false;
    const rayDir = [dx / dist, dy / dist, dz / dist];
    if (!viewer.faceBVH) return false;
    let isOccluded = false;
    const pointDist = dist;
    const EPSILON = 0.01;
    const traverse = (node) => {
        if (!node || isOccluded || !rayAABBIntersection(viewer, rayOrigin, rayDir, node.bounds)) return;
        if (node.isLeaf) {
            for (const prim of node.primitives) {
                const [v1, v2, v3] = viewer.faceList[prim.idx];
                const p1 = viewer.vertexPositions.get(v1);
                const p2 = viewer.vertexPositions.get(v2);
                const p3 = viewer.vertexPositions.get(v3);
                if (!p1 || !p2 || !p3) continue;
                const isSameVertex = (
                    (Math.abs(point[0] - p1[0]) < EPSILON && Math.abs(point[1] - p1[1]) < EPSILON && Math.abs(point[2] - p1[2]) < EPSILON) ||
                    (Math.abs(point[0] - p2[0]) < EPSILON && Math.abs(point[1] - p2[1]) < EPSILON && Math.abs(point[2] - p2[2]) < EPSILON) ||
                    (Math.abs(point[0] - p3[0]) < EPSILON && Math.abs(point[1] - p3[1]) < EPSILON && Math.abs(point[2] - p3[2]) < EPSILON)
                );
                if (isSameVertex) continue;
                const intersection = rayTriangleIntersection(viewer, rayOrigin, rayDir, p1, p2, p3);
                if (intersection !== null && intersection.t > EPSILON && intersection.t < pointDist - EPSILON) {
                    const dotProduct = rayDir[0] * intersection.normal[0] + rayDir[1] * intersection.normal[1] + rayDir[2] * intersection.normal[2];
                    if (dotProduct < 0) {
                        isOccluded = true;
                        return;
                    }
                }
            }
        } else {
            traverse(node.left);
            traverse(node.right);
        }
    };
    traverse(viewer.faceBVH);
    return isOccluded;
}

export function queryVertexBVH(viewer, rayOrigin, rayDir, threshold) {
    if (!viewer.vertexBVH) return null;
    let closestVid = null;
    let closestDist = threshold;
    const traverse = (node) => {
        if (!node || !rayAABBIntersection(viewer, rayOrigin, rayDir, node.bounds)) return;
        if (node.isLeaf) {
            for (const prim of node.primitives) {
                const pos = viewer.vertexPositions.get(prim.idx);
                if (!pos) continue;
                const dist = pointToRayDistance(viewer, pos, rayOrigin, rayDir);
                if (dist < closestDist && !isPointOccluded(viewer, pos, rayOrigin)) {
                    closestDist = dist;
                    closestVid = prim.idx;
                }
            }
        } else {
            traverse(node.left);
            traverse(node.right);
        }
    };
    traverse(viewer.vertexBVH);
    return { vertexId: closestVid, distance: closestDist };
}
