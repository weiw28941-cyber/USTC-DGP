import { buildPropertyPreviewExecutionOptions } from './preview_target_router.js';

function buildPreviewExecutionOptions(editor, node, previewSocketId) {
    return buildPropertyPreviewExecutionOptions(node, previewSocketId, editor);
}

function syncLocalPreview(editor, node, previewSocketId, nextValue) {
    if (!previewSocketId || !node) return;
    node.previewValue = editor.cloneJsonValue(nextValue);
    const existingMeta = (node.previewMeta && typeof node.previewMeta === 'object')
        ? node.previewMeta
        : {};
    node.previewMeta = {
        ...existingMeta,
        socketId: previewSocketId,
        loadedCount: Array.isArray(node.previewValue) ? node.previewValue.length : null,
        totalCount: Array.isArray(node.previewValue) ? node.previewValue.length : null,
        hasMorePages: false,
        outputsTruncated: false,
        pageSize: null,
        rows: null,
        cols: null,
        pageUnit: null,
        previewEpoch: Number(existingMeta.previewEpoch || 0) + 1
    };
    if (editor.previewPanel?.node && Number(editor.previewPanel.node.id) === Number(node.id)) {
        editor.previewPanel.refresh(node, { skipEnsure: true });
    }
}

export {
    buildPreviewExecutionOptions,
    syncLocalPreview
};
