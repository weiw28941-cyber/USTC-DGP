import { applyPreviewTrackedNodeEdit } from './graph_change_execution.js';

function coerceOperationValues(node, nextValue) {
    if (!Array.isArray(node?.values)) return;
    if (nextValue === 'string') {
        node.values = node.values.map((v) => `${v ?? ''}`);
        return;
    }
    if (nextValue === 'number') {
        node.values = node.values.map((v) => {
            const parsed = parseFloat(v);
            return Number.isFinite(parsed) ? parsed : 0;
        });
    }
}

function syncOperationDependentNodeState(editor, node, nextValue) {
    if (!node) return;
    node.operation = nextValue;
    if (node.type === 'vector' || node.type === 'list') {
        coerceOperationValues(node, nextValue);
    }
    if (node.type === 'vector') {
        editor.syncVectorInputs(node);
    } else if (node.type === 'list') {
        editor.syncListInputs(node, true);
    }
}

function applyOperationNodeEdit(editor, node, operationEditor) {
    if (!editor || !node || !operationEditor || operationEditor.kind !== 'cycle') {
        return false;
    }
    const values = Array.isArray(operationEditor.values) ? operationEditor.values : [];
    if (values.length === 0) return false;
    const current = operationEditor.get(node);
    const index = values.indexOf(current);
    const nextValue = values[(index + 1) % values.length];
    applyPreviewTrackedNodeEdit(
        editor,
        operationEditor.history,
        node,
        () => syncOperationDependentNodeState(editor, node, nextValue),
        operationEditor.patchKey
            ? { op: operationEditor.patchOp, nodeId: node.id, key: operationEditor.patchKey, value: nextValue }
            : null,
        {
            immediatePatchExecute: true
        }
    );
    return true;
}

export {
    applyOperationNodeEdit,
    syncOperationDependentNodeState
};
