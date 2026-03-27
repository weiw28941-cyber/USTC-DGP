export function projectArcball(viewer, clientX, clientY) {
    const rect = viewer.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [0, 0, 1];
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((clientY - rect.top) / rect.height) * 2;
    const len2 = x * x + y * y;
    if (len2 <= 1) {
        return [x, y, Math.sqrt(1 - len2)];
    }
    const inv = 1 / Math.sqrt(len2);
    return [x * inv, y * inv, 0];
}

export function quatIdentity() {
    return [0, 0, 0, 1];
}

export function quatNormalize(viewer, q) {
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatMul(viewer, a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
}

export function quatFromBallPoints(viewer, from, to) {
    const cross = [
        from[1] * to[2] - from[2] * to[1],
        from[2] * to[0] - from[0] * to[2],
        from[0] * to[1] - from[1] * to[0]
    ];
    const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
    const q = [cross[0], cross[1], cross[2], dot + 1];
    if (q[3] < 1e-6) {
        if (Math.abs(from[0]) > Math.abs(from[2])) {
            return quatNormalize(viewer, [-from[1], from[0], 0, 0]);
        }
        return quatNormalize(viewer, [0, -from[2], from[1], 0]);
    }
    return quatNormalize(viewer, q);
}

export function quatFromAxisAngle(viewer, axis, angle) {
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1.0;
    const x = axis[0] / len;
    const y = axis[1] / len;
    const z = axis[2] / len;
    const h = 0.5 * angle;
    const s = Math.sin(h);
    return quatNormalize(viewer, [x * s, y * s, z * s, Math.cos(h)]);
}

export function updateViewQuatFromOrbit(viewer) {
    const qYaw = quatFromAxisAngle(viewer, [0, 1, 0], viewer.orbitYaw);
    const qPitch = quatFromAxisAngle(viewer, [1, 0, 0], viewer.orbitPitch);
    viewer.viewQuat = quatNormalize(viewer, quatMul(viewer, qYaw, qPitch));
}

export function applyTurntableRotate(viewer, dx, dy) {
    const rotateSpeed = 0.006;
    viewer.orbitYaw += -dx * rotateSpeed;
    const pitchMax = (Math.PI * 0.5) - 0.01;
    viewer.orbitPitch = Math.max(-pitchMax, Math.min(pitchMax, viewer.orbitPitch - dy * rotateSpeed));
    updateViewQuatFromOrbit(viewer);
}

export function rotateByQuat(viewer, v, q) {
    const qv = [v[0], v[1], v[2], 0];
    const qc = [-q[0], -q[1], -q[2], q[3]];
    const r = quatMul(viewer, quatMul(viewer, q, qv), qc);
    return [r[0], r[1], r[2]];
}

export function applyPan(viewer, dxPixels, dyPixels) {
    if (!viewer.currentPayload) return;
    const boundsMin = viewer.currentPayload.boundsMin || [-1, -1, -1];
    const boundsMax = viewer.currentPayload.boundsMax || [1, 1, 1];
    const sx = boundsMax[0] - boundsMin[0];
    const sy = boundsMax[1] - boundsMin[1];
    const sz = boundsMax[2] - boundsMin[2];
    const radius = Math.max(0.001, 0.5 * Math.hypot(sx, sy, sz));
    const scale = (2.0 * radius * viewer.cameraDistance) / Math.max(1, viewer.canvas.clientHeight || viewer.canvas.height);
    const right = rotateByQuat(viewer, [1, 0, 0], viewer.viewQuat);
    const up = rotateByQuat(viewer, [0, 1, 0], viewer.viewQuat);
    viewer.cameraPan[0] += (-dxPixels * right[0] + dyPixels * up[0]) * scale;
    viewer.cameraPan[1] += (-dxPixels * right[1] + dyPixels * up[1]) * scale;
    viewer.cameraPan[2] += (-dxPixels * right[2] + dyPixels * up[2]) * scale;
}

export function identity() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
}

export function perspective(viewer, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy * 0.5);
    const nf = 1.0 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, (2 * far * near) * nf, 0
    ]);
}

export function lookAt(viewer, eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
        1
    ]);
}

export function multiplyMat4(viewer, a, b) {
    const out = new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
    const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
    const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
    const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

    out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
    out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
    out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
    out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
    out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
    return out;
}
