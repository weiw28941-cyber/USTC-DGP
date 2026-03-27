function createPersistedWindowState(store, key, initialState) {
    const state = { ...(initialState || {}) };
    state.persist = () => {
        if (!store || !key) return;
        const next = {};
        for (const [k, v] of Object.entries(state)) {
            if (typeof v === 'function') continue;
            next[k] = v;
        }
        store.set(key, next);
    };
    return state;
}

function applyRevealPosition(viewport, store, key, savedState, state, revealKey, rowHeight) {
    if (!Number.isFinite(savedState?.[revealKey]) || savedState[revealKey] < 0) {
        return;
    }
    const revealIndex = Number(savedState[revealKey]);
    requestAnimationFrame(() => {
        viewport.scrollTop = revealIndex * rowHeight;
        if (!store || !key) return;
        const next = {};
        for (const [k, v] of Object.entries(state)) {
            if (typeof v === 'function') continue;
            next[k] = v;
        }
        next[revealKey] = null;
        store.set(key, next);
    });
}

function computeMatrixWindow(rows, cols, budget) {
    if (rows <= 0 || cols <= 0) {
        return { shownRows: rows, shownCols: cols };
    }
    if (rows <= 10) {
        const shownRows = rows;
        const shownCols = Math.min(cols, Math.max(1, Math.floor(budget / shownRows)));
        return { shownRows, shownCols };
    }
    if (cols <= 10) {
        const shownCols = cols;
        const shownRows = Math.min(rows, Math.max(1, Math.floor(budget / shownCols)));
        return { shownRows, shownCols };
    }
    const edge = Math.max(1, Math.floor(Math.sqrt(budget)));
    return {
        shownRows: Math.min(rows, edge),
        shownCols: Math.min(cols, Math.max(1, Math.floor(budget / edge)))
    };
}

function buildPreviewStateKey(nodeId, path, suffix = '') {
    if (!Number.isFinite(nodeId) || !path) return null;
    return suffix
        ? `${nodeId}:${path}:${suffix}`
        : `${nodeId}:${path}`;
}

export {
    applyRevealPosition,
    buildPreviewStateKey,
    computeMatrixWindow,
    createPersistedWindowState
};
