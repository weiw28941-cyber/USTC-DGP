import { buildPreviewExecutionOptions, syncLocalPreview } from './preview_output_state.js';
import { buildConnectionPreviewExecutionOptionsWithContext } from './preview_target_router.js';

function mergeExecutionOptions(editor, primary, secondary = null) {
    if (typeof editor?.mergeExecutionOptions === 'function') {
        return editor.mergeExecutionOptions(primary, secondary);
    }
    return secondary || primary || null;
}

function applyPreviewTrackedNodeEdit(editor, historyLabel, node, updateFn, syncSpec = null, options = {}) {
    const previewSocketId = options.previewSocketId || editor.getPreferredPreviewSocketId(node);
    const previewExecutionOptions = buildPreviewExecutionOptions(editor, node, previewSocketId);
    const executionOptions = mergeExecutionOptions(
        editor,
        previewExecutionOptions,
        options.executionOptions || null
    );
    editor.applyNodeEdit(historyLabel, updateFn, syncSpec, {
        ...options,
        immediatePatchExecute: options.immediatePatchExecute !== false,
        executionOptions,
        afterUpdate: () => {
            if (typeof options.localPreviewFactory === 'function') {
                syncLocalPreview(editor, node, previewSocketId, options.localPreviewFactory(node));
            }
            if (typeof options.afterUpdate === 'function') {
                options.afterUpdate();
            }
        }
    });
}

function enqueueConnectionGraphChange(editor, patches, affectedNodes, options = {}) {
    const connectionExecutionOptions = buildConnectionPreviewExecutionOptionsWithContext(affectedNodes, editor);
    const executionOptions = mergeExecutionOptions(
        editor,
        connectionExecutionOptions,
        options.executionOptions || null
    );
    editor.enqueueIncrementalExecutionPatches(patches, {
        ...options,
        executionOptions
    });
}

export {
    applyPreviewTrackedNodeEdit,
    enqueueConnectionGraphChange
};
