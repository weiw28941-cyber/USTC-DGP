class GraphPatchQueue {
    constructor(options = {}) {
        this.coalescePatchBatch = typeof options.coalescePatchBatch === 'function'
            ? options.coalescePatchBatch
            : ((patches) => Array.isArray(patches) ? patches.slice() : []);
        this.defaultDelayMs = Number.isFinite(options.defaultDelayMs)
            ? Math.max(0, Number(options.defaultDelayMs))
            : 16;
        this.pendingPatches = [];
        this.flushTimer = null;
    }

    getPendingPatches() {
        return this.pendingPatches.slice();
    }

    hasPendingPatches() {
        return Array.isArray(this.pendingPatches) && this.pendingPatches.length > 0;
    }

    clear() {
        this.cancelScheduledFlush();
        this.pendingPatches = [];
    }

    cancelScheduledFlush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    enqueue(patches, options = {}) {
        const list = Array.isArray(patches) ? patches : [];
        if (list.length === 0) return false;
        for (const patch of list) {
            this.pendingPatches.push(patch);
        }
        this.pendingPatches = this.coalescePatchBatch(this.pendingPatches);
        this.cancelScheduledFlush();
        const onFlush = typeof options.onFlush === 'function' ? options.onFlush : null;
        if (!onFlush) return true;
        const delay = Number.isFinite(options.debounceMs)
            ? Math.max(0, Number(options.debounceMs))
            : this.defaultDelayMs;
        const flushExecute = options.flushExecute === true;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            onFlush(flushExecute);
        }, delay);
        return true;
    }

    consumePending() {
        this.cancelScheduledFlush();
        if (!this.hasPendingPatches()) {
            return null;
        }
        const batch = this.coalescePatchBatch(this.pendingPatches);
        this.pendingPatches = [];
        return batch;
    }
}

export { GraphPatchQueue };
