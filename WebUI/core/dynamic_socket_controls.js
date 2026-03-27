import { applyPreviewTrackedNodeEdit } from './graph_change_execution.js';

function applyValuesNodeEdit(editor, historyLabel, node, mutate, options = {}) {
    applyPreviewTrackedNodeEdit(editor, historyLabel, node, () => {
        mutate();
    }, () => ({
        op: 'set_node_property',
        nodeId: node.id,
        key: 'values',
        value: editor.cloneJsonValue(node.values)
    }), {
        localPreviewFactory: options.localPreviewFactory
    });
}

function createValuesSocketControl(config) {
    return (editor, node, worldX, worldY) => {
        if (node.type !== config.type || !node.controlButtons) return false;
        const addButtons = config.getAddButtons(node);
        for (const button of addButtons) {
            if (!editor.pointInCircle(worldX, worldY, button)) continue;
            applyValuesNodeEdit(editor, config.historyLabel, node, () => {
                config.onAdd(editor, node, button);
            }, {
                localPreviewFactory: config.localPreviewFactory
            });
            return true;
        }

        const removeButtons = config.getRemoveButtons(node);
        for (const button of removeButtons) {
            if (!editor.pointInCircle(worldX, worldY, button)) continue;
            if (typeof config.canRemove === 'function' && !config.canRemove(node, button)) {
                return true;
            }
            applyValuesNodeEdit(editor, config.historyLabel, node, () => {
                config.onRemove(editor, node, button);
            }, {
                localPreviewFactory: config.localPreviewFactory
            });
            return true;
        }

        return false;
    };
}

const dynamicSocketControlHandlers = [
    createValuesSocketControl({
        type: 'vector',
        historyLabel: 'Vector Size Change',
        getAddButtons: node => node.controlButtons?.vectorAdd ? [node.controlButtons.vectorAdd] : [],
        getRemoveButtons: node => node.controlButtons?.vectorRemove ? [node.controlButtons.vectorRemove] : [],
        canRemove: node => Array.isArray(node.values) && node.values.length > 0,
        onAdd: (editor, node) => {
            node.values.push(0);
            editor.syncVectorInputs(node);
        },
        onRemove: (editor, node) => {
            node.values.pop();
            editor.syncVectorInputs(node);
        },
        localPreviewFactory: currentNode => currentNode.values
    }),
    createValuesSocketControl({
        type: 'list',
        historyLabel: 'List Size Change',
        getAddButtons: node => node.controlButtons?.listAdd || [],
        getRemoveButtons: node => node.controlButtons?.listRemove || [],
        onAdd: (editor, node, button) => {
            const insertIndex = node.inputs.length === 0 ? 0 : button.index + 1;
            node.values.splice(insertIndex, 0, 0);
            editor.shiftListConnections(node, insertIndex, 1);
            editor.syncListInputs(node, true);
        },
        onRemove: (editor, node, button) => {
            node.values.splice(button.index, 1);
            editor.shiftListConnections(node, button.index, -1);
            editor.syncListInputs(node, true);
        },
        localPreviewFactory: currentNode => currentNode.values
    }),
    createValuesSocketControl({
        type: 'geometry',
        historyLabel: 'Geometry Input Size Change',
        getAddButtons: node => node.controlButtons?.geometryAdd || [],
        getRemoveButtons: node => node.controlButtons?.geometryRemove || [],
        onAdd: (editor, node, button) => {
            const values = Array.isArray(node.values) ? node.values : [1, 1, 1];
            while (values.length < 3) values.push(1);
            values[button.bucket] = Math.max(0, (parseInt(values[button.bucket], 10) || 0) + 1);
            node.values = values;
            editor.syncGeometryInputs(node);
        },
        onRemove: (editor, node, button) => {
            const values = Array.isArray(node.values) ? node.values : [1, 1, 1];
            while (values.length < 3) values.push(1);
            values[button.bucket] = Math.max(0, (parseInt(values[button.bucket], 10) || 0) - 1);
            node.values = values;
            editor.syncGeometryInputs(node);
        },
        localPreviewFactory: currentNode => currentNode.values
    })
];

function handleDynamicSocketControl(editor, node, worldX, worldY) {
    return dynamicSocketControlHandlers.some(handler => handler(editor, node, worldX, worldY));
}

export {
    createValuesSocketControl,
    dynamicSocketControlHandlers,
    handleDynamicSocketControl
};
