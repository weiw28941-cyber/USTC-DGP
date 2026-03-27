function collectAffectedNodeIds(result) {
    const out = new Set();
    const addId = (value) => {
        const id = Number(value);
        if (Number.isFinite(id)) out.add(id);
    };

    if (Array.isArray(result?.deltas)) {
        for (const delta of result.deltas) {
            addId(delta?.id);
        }
    }

    if (Array.isArray(result?.results?.nodes)) {
        for (const nodeResult of result.results.nodes) {
            addId(nodeResult?.id);
        }
    }

    const stats = result?.execution_stats || result?.results?.execution_stats || null;
    if (stats) {
        for (const id of Array.isArray(stats.computedNodes) ? stats.computedNodes : []) {
            addId(id);
        }
        for (const id of Array.isArray(stats.cacheHitNodes) ? stats.cacheHitNodes : []) {
            addId(id);
        }
    }

    return out;
}

function collectRefreshedPreviewNodeIds(result) {
    const out = new Set();
    const nodeResults = (Array.isArray(result?.deltas) && result.deltas.length > 0)
        ? result.deltas
        : (Array.isArray(result?.results?.nodes) ? result.results.nodes : []);
    for (const nodeResult of nodeResults) {
        if (!Number.isFinite(nodeResult?.id)) continue;
        if (nodeResult?.outputs && typeof nodeResult.outputs === 'object') {
            out.add(Number(nodeResult.id));
        }
    }
    return out;
}

class PreviewRefreshScheduler {
    constructor(editor) {
        this.editor = editor;
        this.pendingNodeIds = new Set();
        this.isDraining = false;
    }

    isPreviewableNode(node) {
        if (!node || !Number.isFinite(node.id)) return false;
        if (!Array.isArray(node.outputs) || node.outputs.length === 0) return false;
        try {
            return this.editor.getPreferredPreviewSocketId(node) !== null;
        } catch (_) {
            return false;
        }
    }

    markAffectedPreviewsStale(affectedIds, refreshedPreviewIds = new Set()) {
        for (const node of this.editor.nodes || []) {
            const nodeId = Number(node?.id);
            if (!affectedIds.has(nodeId) || refreshedPreviewIds.has(nodeId)) continue;
            if (!this.isPreviewableNode(node)) continue;
            const existingMeta = (node.previewMeta && typeof node.previewMeta === 'object')
                ? node.previewMeta
                : {};
            node.previewMeta = {
                ...existingMeta,
                isStale: true
            };
        }
    }

    collectImmediateRefreshNodeIds(affectedIds, refreshedPreviewIds = new Set()) {
        const immediate = new Set();
        const previewNodeId = Number(this.editor.previewPanel?.node?.id);
        if (affectedIds.has(previewNodeId) && !refreshedPreviewIds.has(previewNodeId)) {
            immediate.add(previewNodeId);
        }
        const viewerNodeId = Number(this.editor.meshViewerPanel?.currentNodeId);
        if (affectedIds.has(viewerNodeId) && !refreshedPreviewIds.has(viewerNodeId)) {
            immediate.add(viewerNodeId);
        }
        return immediate;
    }

    async refreshNodePreviewNow(nodeId) {
        const node = (this.editor.nodes || []).find((entry) => Number(entry?.id) === Number(nodeId));
        if (!node || !this.isPreviewableNode(node)) return false;
        const ok = await this.editor.fetchPreviewDescriptorForNode(node, { silent: true });
        if (ok && node.previewMeta && typeof node.previewMeta === 'object') {
            node.previewMeta.isStale = false;
        }
        return ok;
    }

    scheduleIdleRefreshes(nodeIds) {
        for (const nodeId of nodeIds) {
            this.pendingNodeIds.add(Number(nodeId));
        }
        this.ensureDrain();
    }

    ensureDrain() {
        if (this.isDraining || this.pendingNodeIds.size === 0) return;
        this.isDraining = true;
        const schedule = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
            ? (cb) => window.requestIdleCallback(() => cb())
            : (cb) => setTimeout(cb, 16);
        schedule(() => this.drainOne());
    }

    async drainOne() {
        const iterator = this.pendingNodeIds.values().next();
        if (iterator.done) {
            this.isDraining = false;
            return;
        }
        const nodeId = iterator.value;
        this.pendingNodeIds.delete(nodeId);
        try {
            await this.refreshNodePreviewNow(nodeId);
        } catch (_) {
        }
        this.isDraining = false;
        this.ensureDrain();
    }

    async processExecutionResult(result) {
        const affectedIds = collectAffectedNodeIds(result);
        if (affectedIds.size === 0) return;
        const refreshedPreviewIds = collectRefreshedPreviewNodeIds(result);
        this.markAffectedPreviewsStale(affectedIds, refreshedPreviewIds);
        const immediate = this.collectImmediateRefreshNodeIds(affectedIds, refreshedPreviewIds);
        for (const nodeId of immediate) {
            await this.refreshNodePreviewNow(nodeId);
        }
        const idleIds = [...affectedIds].filter((nodeId) => {
            if (refreshedPreviewIds.has(nodeId) || immediate.has(nodeId)) return false;
            const node = (this.editor.nodes || []).find((entry) => Number(entry?.id) === Number(nodeId));
            return this.isPreviewableNode(node);
        });
        this.scheduleIdleRefreshes(idleIds);
    }
}

export {
    collectAffectedNodeIds,
    collectRefreshedPreviewNodeIds,
    PreviewRefreshScheduler
};
