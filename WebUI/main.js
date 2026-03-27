import { NodeEditor } from './core/editor.js';
import { EditableHelpPanel } from './ui/editable_help_panel.js';

function initOutputSplitter(editor) {
    const splitter = document.querySelector('.output-splitter');
    const outputPanel = document.querySelector('.output-panel');
    if (!splitter || !outputPanel || !editor) return;

    let dragState = null;

    const onPointerMove = (event) => {
        if (!dragState) return;
        const deltaY = dragState.startY - event.clientY;
        const nextHeight = Math.max(
            dragState.minHeight,
            Math.min(dragState.maxHeight, dragState.startHeight + deltaY)
        );
        outputPanel.style.height = `${nextHeight}px`;
        editor.resize();
        if (typeof editor.requestRender === 'function') {
            editor.requestRender();
        }
    };

    const stopDragging = () => {
        if (!dragState) return;
        dragState = null;
        splitter.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);
        editor.resize();
        if (typeof editor.requestRender === 'function') {
            editor.requestRender();
        }
    };

    splitter.addEventListener('pointerdown', (event) => {
        const computed = window.getComputedStyle(outputPanel);
        const minHeight = Number.parseFloat(computed.minHeight) || 120;
        const maxHeight = Math.min(
            window.innerHeight * 0.6,
            Number.parseFloat(computed.maxHeight) || window.innerHeight * 0.6
        );
        dragState = {
            startY: event.clientY,
            startHeight: outputPanel.getBoundingClientRect().height,
            minHeight,
            maxHeight
        };
        splitter.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopDragging);
        window.addEventListener('pointercancel', stopDragging);
        event.preventDefault();
    });
}

function init() {
    const canvas = document.getElementById('nodeCanvas');
    const editor = new NodeEditor(canvas);
    initOutputSplitter(editor);

    document.getElementById('helpButton').addEventListener('click', () => {
        const helpPanel = new EditableHelpPanel(editor);
        helpPanel.show();
    });

    document.getElementById('saveGraph').addEventListener('click', () => {
        editor.saveGraph();
    });

    document.getElementById('loadGraph').addEventListener('click', () => {
        editor.loadGraph();
    });

    document.getElementById('clearCanvas').addEventListener('click', () => {
        editor.clear();
    });

    return editor;
}

export { init };
