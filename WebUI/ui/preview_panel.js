import {
    DEFAULT_PAGED_PREVIEW_ITEMS,
    getOutputPageSize,
    isPagedOutput
} from '../core/output_transport.js';
import {
    applyRevealPosition,
    buildPreviewStateKey,
    computeMatrixWindow,
    createPersistedWindowState
} from './preview_windowing.js';

class PreviewPanel {
    constructor(editor) {
        this.editor = editor;
        this.panel = null;
        this.node = null;
        this.content = null;
        this.maxArrayItems = DEFAULT_PAGED_PREVIEW_ITEMS;
        this.arrayPageSize = DEFAULT_PAGED_PREVIEW_ITEMS;
        this.virtualRowHeight = 24;
        this.matrixRowHeight = 28;
        this.matrixColumnPageSize = 24;
        this.matrixCellBudget = 100;
        this.virtualViewportHeight = 320;
        this.virtualOverscanRows = 8;
        this.matrixPreviewState = new Map();
        this.arrayPreviewState = new Map();
        this.previewOpenState = new Map();

        // Registry for custom payload renderers
        // Maps action type to renderer function: (container, payload) => void
        this.payloadRenderers = new Map();

        // Register built-in renderers
        this.registerBuiltInRenderers();
    }

    registerPayloadRenderer(actionType, renderer) {
        if (typeof actionType === 'string' && typeof renderer === 'function') {
            this.payloadRenderers.set(actionType, renderer);
        }
    }

    registerBuiltInRenderers() {
        // Mesh edit handles renderer
        this.registerPayloadRenderer('mesh_edit_handles', (container, payload) => {
            this.renderMeshEditPayload(container, payload);
        });

        // Mesh edit edges renderer
        this.registerPayloadRenderer('mesh_edit_edges', (container, payload) => {
            this.renderMeshEditEdgesPayload(container, payload);
        });

        // Mesh edit faces renderer
        this.registerPayloadRenderer('mesh_edit_faces', (container, payload) => {
            this.renderMeshEditFacesPayload(container, payload);
        });

        // Camera state renderer
        this.registerPayloadRenderer('viewer_camera_state', (container, payload) => {
            this.renderCameraStatePayload(container, payload);
        });

        // Colorbar stops renderer
        this.registerPayloadRenderer('viewer_colorbar_stops', (container, payload) => {
            this.renderColorbarStopsPayload(container, payload);
        });
    }

    show(node, x, y) {
        this.hide();
        if (node &&
            Array.isArray(node.previewValue) &&
            (node?.previewMeta?.outputsTruncated === true || node?.previewMeta?.hasMorePages === true)) {
            node.previewValue = null;
            if (node.previewMeta && typeof node.previewMeta === 'object') {
                node.previewMeta.loadedCount = 0;
                node.previewMeta.hasMorePages = true;
            }
        }
        this.node = node;
        const shouldRefreshDescriptor =
            !Array.isArray(node?.previewValue) &&
            this.editor &&
            typeof this.editor.fetchPreviewDescriptorForNode === 'function';
        if (shouldRefreshDescriptor) {
            this.editor.fetchPreviewDescriptorForNode(node, { silent: true }).catch(() => {});
        }
        this.ensurePreviewDataRequested(node);

        this.panel = document.createElement('div');
        this.panel.className = 'preview-panel';
        this.panel.style.left = x + 'px';
        this.panel.style.top = y + 'px';

        const title = document.createElement('div');
        title.className = 'preview-panel-title';

        const titleText = document.createElement('span');
        titleText.textContent = `${node.config.name} - Preview`;
        title.appendChild(titleText);

        this.panel.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'preview-panel-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close preview');
        closeBtn.onclick = () => this.hide();
        title.appendChild(closeBtn);

        const content = document.createElement('div');
        content.className = 'preview-panel-content';
        this.content = content;

        if (node.previewValue !== null) {
            this.renderPreviewContent(content, node.previewValue);
        } else {
            content.textContent = 'No preview data available';
        }

        this.panel.appendChild(content);
        document.body.appendChild(this.panel);

        this.adjustPosition();
    }

    refresh(node = null, options = {}) {
        if (!this.panel || !this.content) return;
        const targetNode = node || this.node;
        if (!targetNode) return;
        if (this.node && targetNode && Number(this.node.id) !== Number(targetNode.id)) return;
        this.node = targetNode;
        if (options.skipEnsure !== true) {
            this.ensurePreviewDataRequested(targetNode);
        }
        this.content.innerHTML = '';
        if (targetNode.previewValue !== null && targetNode.previewValue !== undefined) {
            this.renderPreviewContent(this.content, targetNode.previewValue);
        } else {
            this.content.textContent = 'No preview data available';
        }
        this.adjustPosition();
    }

    ensurePreviewDataRequested(node) {
        const shouldFetchFullPreview = this.editor &&
            typeof this.editor.shouldProgressivelyLoadFullPreview === 'function' &&
            this.editor.shouldProgressivelyLoadFullPreview(node) &&
            typeof this.editor.fetchFullPreviewForNode === 'function';
        if (shouldFetchFullPreview) {
            this.editor.fetchFullPreviewForNode(node, { silent: true }).catch(() => {});
        }
        const hasLoadedArrayPreview = Array.isArray(node?.previewValue);
        const shouldFetchPagedPreview =
            isPagedOutput(node?.previewValue) ||
            (!hasLoadedArrayPreview && node?.previewMeta?.outputsTruncated === true);
        if (shouldFetchPagedPreview &&
            this.editor &&
            typeof this.editor.fetchPreviewPageForNode === 'function' &&
            typeof this.editor.isPreviewPageFetchInFlight === 'function' &&
            !this.editor.isPreviewPageFetchInFlight(node, node?.previewMeta?.socketId || null)) {
            const previewMetaPageSize = Number.isFinite(node?.previewMeta?.pageSize)
                ? Number(node.previewMeta.pageSize)
                : null;
            const pageSize = isPagedOutput(node?.previewValue)
                ? getOutputPageSize(node?.previewValue, previewMetaPageSize ?? this.arrayPageSize)
                : (previewMetaPageSize ?? this.arrayPageSize);
            this.editor.fetchPreviewPageForNode(node, {
                socketId: node?.previewMeta?.socketId || node?.previewValue?.stream?.socketId || null,
                offset: 0,
                limit: pageSize
            }).catch(() => {});
        }
    }

    renderPreviewContent(container, value) {
        if (isPagedOutput(value)) {
            const placeholder = document.createElement('div');
            placeholder.className = 'preview-item';
            placeholder.textContent = 'Array preview is available in pages and will load on demand.';
            container.appendChild(placeholder);
        } else if (this.isInteractionPreviewValue(value)) {
            this.renderInteractionStatePreview(container, value);
        } else {
            this.renderValueBlock(container, 'Preview', value, 0, true);
        }
    }

    isInteractionPreviewValue(value) {
        if (!value || typeof value !== 'object') return false;
        if ('event' in value || 'payload' in value || 'state' in value) return true;
        if ('channel' in value && 'phase' in value) return true;
        return false;
    }

    normalizeInteractionPreviewValue(value) {
        const event = (value && typeof value.event === 'object' && value.event !== null) ? value.event : {};
        const state = (value && typeof value.state === 'object' && value.state !== null) ? value.state : {};
        const payloadFromEvent = (event && typeof event.payload === 'object' && event.payload !== null) ? event.payload : {};
        const payload = (value && typeof value.payload === 'object' && value.payload !== null)
            ? value.payload
            : payloadFromEvent;
        const channels = (state && typeof state.channels === 'object' && state.channels !== null) ? state.channels : {};
        const channel = value?.channel ?? event?.channel ?? state?.lastChannel ?? '';
        const phase = value?.phase ?? event?.phase ?? state?.lastPhase ?? '';
        const version = value?.version ?? event?.version ?? state?.lastVersion ?? 0;
        const target = value?.target ?? event?.targetNodeId ?? -1;
        const sourceNodeId = value?.sourceNodeId ?? event?.sourceNodeId ?? payload?.sourceViewerNodeId ?? -1;
        const timestampMs = value?.timestampMs ?? event?.timestampMs ?? state?.timestampMs ?? 0;
        const phaseMatched = value?.phaseMatched ?? 0;
        const channelStateFromValue = (value?.channel_state && typeof value.channel_state === 'object' && value.channel_state !== null)
            ? value.channel_state
            : {};
        const channelStateFromChannels = (channel && channels[channel] && typeof channels[channel] === 'object')
            ? channels[channel]
            : {};
        const channelState = Object.keys(channelStateFromValue).length > 0
            ? channelStateFromValue
            : channelStateFromChannels;
        const committed = (value?.committed && typeof value.committed === 'object' && value.committed !== null)
            ? value.committed
            : ((channelState.committed && typeof channelState.committed === 'object') ? channelState.committed : {});
        const transient = (value?.transient && typeof value.transient === 'object' && value.transient !== null)
            ? value.transient
            : ((channelState.transient && typeof channelState.transient === 'object') ? channelState.transient : {});
        return {
            event,
            payload,
            state,
            channels,
            channelState,
            committed,
            transient,
            channel,
            phase,
            version,
            target,
            sourceNodeId,
            timestampMs,
            phaseMatched
        };
    }

    renderInteractionSummaryRow(container, key, val) {
        const row = document.createElement('div');
        row.className = 'preview-item';
        row.innerHTML = `<span class="preview-label">${key}:</span> <span class="preview-value">${String(val)}</span>`;
        container.appendChild(row);
    }

    renderInteractionStatePreview(container, value) {
        const model = this.normalizeInteractionPreviewValue(value);

        const summary = document.createElement('div');
        summary.className = 'preview-info-section';
        this.renderInteractionSummaryRow(summary, 'Channel', model.channel || '(none)');
        this.renderInteractionSummaryRow(summary, 'Phase', model.phase || '(none)');
        this.renderInteractionSummaryRow(summary, 'Version', Number.isFinite(Number(model.version)) ? Number(model.version) : 0);
        this.renderInteractionSummaryRow(summary, 'Source Node', Number.isFinite(Number(model.sourceNodeId)) ? Number(model.sourceNodeId) : -1);
        this.renderInteractionSummaryRow(summary, 'Target Node', Number.isFinite(Number(model.target)) ? Number(model.target) : -1);
        this.renderInteractionSummaryRow(summary, 'Phase Matched', Number(model.phaseMatched) !== 0 ? 'yes' : 'no');
        if (Number.isFinite(Number(model.timestampMs)) && Number(model.timestampMs) > 0) {
            this.renderInteractionSummaryRow(summary, 'Timestamp', new Date(Number(model.timestampMs)).toISOString());
        }
        container.appendChild(summary);

        const payloadSection = document.createElement('div');
        payloadSection.className = 'preview-payload-section';
        const action = model.payload?.action;
        const renderer = action ? this.payloadRenderers.get(action) : null;
        if (renderer) {
            renderer(payloadSection, model.payload);
        } else {
            this.renderValueBlock(payloadSection, 'Payload', model.payload, 0, true);
        }
        container.appendChild(payloadSection);

        const channelStateSection = document.createElement('div');
        channelStateSection.className = 'preview-details-section';
        this.renderValueBlock(channelStateSection, 'Channel State', model.channelState, 0, true);
        this.renderValueBlock(channelStateSection, 'Transient', model.transient, 0, false);
        this.renderValueBlock(channelStateSection, 'Committed', model.committed, 0, false);
        container.appendChild(channelStateSection);

        const channels = model.channels && typeof model.channels === 'object' ? model.channels : {};
        const channelKeys = Object.keys(channels);
        if (channelKeys.length > 0) {
            const channelSection = document.createElement('div');
            channelSection.className = 'preview-details-section';
            for (const channelKey of channelKeys) {
                const forceOpen = model.channel === channelKey;
                this.renderValueBlock(channelSection, `channel:${channelKey}`, channels[channelKey], 0, forceOpen);
            }
            container.appendChild(channelSection);
        }

        const detailsSection = document.createElement('div');
        detailsSection.className = 'preview-details-section';
        this.renderValueBlock(detailsSection, 'Event', model.event, 0, true);
        this.renderValueBlock(detailsSection, 'State', model.state, 0, false);
        container.appendChild(detailsSection);

        if (Object.keys(model.event).length === 0 && Object.keys(model.state).length === 0) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'preview-item';
            emptyHint.textContent = 'No interaction event received yet. Check viewer->interaction line and trigger begin/update/commit.';
            container.appendChild(emptyHint);
        }
    }

    renderMeshEditPayload(container, payload) {
        const title = document.createElement('div');
        title.className = 'preview-item';
        title.innerHTML = `<span class="preview-label">Action:</span> <span class="preview-value">${payload.action}</span>`;
        container.appendChild(title);

        if (!payload.value || !Array.isArray(payload.value.handles)) {
            const error = document.createElement('div');
            error.className = 'preview-item';
            error.textContent = 'Invalid mesh edit payload structure';
            container.appendChild(error);
            return;
        }

        const handles = payload.value.handles;
        const handlesHeader = document.createElement('div');
        handlesHeader.className = 'preview-item';
        handlesHeader.innerHTML = `<span class="preview-label">Edited Vertices:</span> <span class="preview-value">${handles.length} vertex(es)</span>`;
        container.appendChild(handlesHeader);

        // Render handles in a table-like format
        const handlesContainer = document.createElement('div');
        handlesContainer.className = 'preview-interaction-data';

        for (let i = 0; i < handles.length; i++) {
            const handle = handles[i];
            const handleRow = document.createElement('div');
            handleRow.className = 'preview-interaction-row';

            const id = handle.id !== undefined ? handle.id : '?';
            const pos = handle.position || [0, 0, 0];
            const x = typeof pos[0] === 'number' ? pos[0].toFixed(3) : '0.000';
            const y = typeof pos[1] === 'number' ? pos[1].toFixed(3) : '0.000';
            const z = typeof pos[2] === 'number' ? pos[2].toFixed(3) : '0.000';

            handleRow.innerHTML = `
                <span class="preview-interaction-key">Vertex ${id}:</span>
                <span class="preview-interaction-value">(${x}, ${y}, ${z})</span>
            `;
            handlesContainer.appendChild(handleRow);
        }

        container.appendChild(handlesContainer);

        // Show source viewer node if available
        if (payload.sourceViewerNodeId !== undefined) {
            const sourceInfo = document.createElement('div');
            sourceInfo.className = 'preview-item preview-source-info';
            sourceInfo.innerHTML = `<span class="preview-label">Source:</span> <span class="preview-value">Node ${payload.sourceViewerNodeId}</span>`;
            container.appendChild(sourceInfo);
        }
    }

    renderMeshEditEdgesPayload(container, payload) {
        const title = document.createElement('div');
        title.className = 'preview-item';
        title.innerHTML = `<span class="preview-label">Action:</span> <span class="preview-value">${payload.action}</span>`;
        container.appendChild(title);

        if (!payload.value || !Array.isArray(payload.value.edges)) {
            const error = document.createElement('div');
            error.className = 'preview-item';
            error.textContent = 'Invalid edge selection payload structure';
            container.appendChild(error);
            return;
        }

        const edges = payload.value.edges;
        const edgesHeader = document.createElement('div');
        edgesHeader.className = 'preview-item';
        edgesHeader.innerHTML = `<span class="preview-label">Selected Edges:</span> <span class="preview-value">${edges.length} edge(s)</span>`;
        container.appendChild(edgesHeader);

        const edgesContainer = document.createElement('div');
        edgesContainer.className = 'preview-interaction-data';

        for (let i = 0; i < Math.min(edges.length, 20); i++) {
            const edge = edges[i];
            const row = document.createElement('div');
            row.className = 'preview-interaction-row';
            row.innerHTML = `
                <span class="preview-interaction-key">Edge ${i}:</span>
                <span class="preview-interaction-value">V${edge.v1} - V${edge.v2}</span>
            `;
            edgesContainer.appendChild(row);
        }

        if (edges.length > 20) {
            const more = document.createElement('div');
            more.className = 'preview-item';
            more.textContent = `... and ${edges.length - 20} more`;
            edgesContainer.appendChild(more);
        }

        container.appendChild(edgesContainer);

        if (payload.sourceViewerNodeId !== undefined) {
            const sourceInfo = document.createElement('div');
            sourceInfo.className = 'preview-item preview-source-info';
            sourceInfo.innerHTML = `<span class="preview-label">Source:</span> <span class="preview-value">Node ${payload.sourceViewerNodeId}</span>`;
            container.appendChild(sourceInfo);
        }
    }

    renderMeshEditFacesPayload(container, payload) {
        const title = document.createElement('div');
        title.className = 'preview-item';
        title.innerHTML = `<span class="preview-label">Action:</span> <span class="preview-value">${payload.action}</span>`;
        container.appendChild(title);

        if (!payload.value || !Array.isArray(payload.value.faces)) {
            const error = document.createElement('div');
            error.className = 'preview-item';
            error.textContent = 'Invalid face selection payload structure';
            container.appendChild(error);
            return;
        }

        const faces = payload.value.faces;
        const facesHeader = document.createElement('div');
        facesHeader.className = 'preview-item';
        facesHeader.innerHTML = `<span class="preview-label">Selected Faces:</span> <span class="preview-value">${faces.length} face(s)</span>`;
        container.appendChild(facesHeader);

        const facesContainer = document.createElement('div');
        facesContainer.className = 'preview-interaction-data';

        for (let i = 0; i < Math.min(faces.length, 20); i++) {
            const face = faces[i];
            const row = document.createElement('div');
            row.className = 'preview-interaction-row';
            row.innerHTML = `
                <span class="preview-interaction-key">Face ${i}:</span>
                <span class="preview-interaction-value">V${face.v1}, V${face.v2}, V${face.v3}</span>
            `;
            facesContainer.appendChild(row);
        }

        if (faces.length > 20) {
            const more = document.createElement('div');
            more.className = 'preview-item';
            more.textContent = `... and ${faces.length - 20} more`;
            facesContainer.appendChild(more);
        }

        container.appendChild(facesContainer);

        if (payload.sourceViewerNodeId !== undefined) {
            const sourceInfo = document.createElement('div');
            sourceInfo.className = 'preview-item preview-source-info';
            sourceInfo.innerHTML = `<span class="preview-label">Source:</span> <span class="preview-value">Node ${payload.sourceViewerNodeId}</span>`;
            container.appendChild(sourceInfo);
        }
    }

    renderCameraStatePayload(container, payload) {
        const title = document.createElement('div');
        title.className = 'preview-item';
        title.innerHTML = `<span class="preview-label">Action:</span> <span class="preview-value">${payload.action}</span>`;
        container.appendChild(title);

        if (!payload.value || typeof payload.value !== 'object') {
            const error = document.createElement('div');
            error.className = 'preview-item';
            error.textContent = 'Invalid camera state payload structure';
            container.appendChild(error);
            return;
        }

        const camera = payload.value;
        const dataContainer = document.createElement('div');
        dataContainer.className = 'preview-interaction-data';

        // Position
        if (camera.position && Array.isArray(camera.position)) {
            const row = document.createElement('div');
            row.className = 'preview-interaction-row';
            const pos = camera.position;
            const x = typeof pos[0] === 'number' ? pos[0].toFixed(3) : '0.000';
            const y = typeof pos[1] === 'number' ? pos[1].toFixed(3) : '0.000';
            const z = typeof pos[2] === 'number' ? pos[2].toFixed(3) : '0.000';
            row.innerHTML = `
                <span class="preview-interaction-key">Position:</span>
                <span class="preview-interaction-value">(${x}, ${y}, ${z})</span>
            `;
            dataContainer.appendChild(row);
        }

        // Target
        if (camera.target && Array.isArray(camera.target)) {
            const row = document.createElement('div');
            row.className = 'preview-interaction-row';
            const tgt = camera.target;
            const x = typeof tgt[0] === 'number' ? tgt[0].toFixed(3) : '0.000';
            const y = typeof tgt[1] === 'number' ? tgt[1].toFixed(3) : '0.000';
            const z = typeof tgt[2] === 'number' ? tgt[2].toFixed(3) : '0.000';
            row.innerHTML = `
                <span class="preview-interaction-key">Target:</span>
                <span class="preview-interaction-value">(${x}, ${y}, ${z})</span>
            `;
            dataContainer.appendChild(row);
        }

        // Zoom
        if (camera.zoom !== undefined) {
            const row = document.createElement('div');
            row.className = 'preview-interaction-row';
            const zoom = typeof camera.zoom === 'number' ? camera.zoom.toFixed(3) : '1.000';
            row.innerHTML = `
                <span class="preview-interaction-key">Zoom:</span>
                <span class="preview-interaction-value">${zoom}</span>
            `;
            dataContainer.appendChild(row);
        }

        container.appendChild(dataContainer);

        if (payload.sourceViewerNodeId !== undefined) {
            const sourceInfo = document.createElement('div');
            sourceInfo.className = 'preview-item preview-source-info';
            sourceInfo.innerHTML = `<span class="preview-label">Source:</span> <span class="preview-value">Node ${payload.sourceViewerNodeId}</span>`;
            container.appendChild(sourceInfo);
        }
    }

    renderColorbarStopsPayload(container, payload) {
        const title = document.createElement('div');
        title.className = 'preview-item';
        title.innerHTML = `<span class="preview-label">Action:</span> <span class="preview-value">${payload.action}</span>`;
        container.appendChild(title);

        if (!payload.value || typeof payload.value !== 'object') {
            const error = document.createElement('div');
            error.className = 'preview-item';
            error.textContent = 'Invalid colorbar stops payload structure';
            container.appendChild(error);
            return;
        }

        const { target, stops } = payload.value;

        if (target !== undefined) {
            const targetInfo = document.createElement('div');
            targetInfo.className = 'preview-item';
            targetInfo.innerHTML = `<span class="preview-label">Target:</span> <span class="preview-value">${target}</span>`;
            container.appendChild(targetInfo);
        }

        if (stops && Array.isArray(stops)) {
            const stopsHeader = document.createElement('div');
            stopsHeader.className = 'preview-item';
            stopsHeader.innerHTML = `<span class="preview-label">Color Stops:</span> <span class="preview-value">${stops.length} stop(s)</span>`;
            container.appendChild(stopsHeader);

            const stopsContainer = document.createElement('div');
            stopsContainer.className = 'preview-interaction-data';

            for (let i = 0; i < Math.min(stops.length, 10); i++) {
                const stop = stops[i];
                const row = document.createElement('div');
                row.className = 'preview-interaction-row';

                const pos = typeof stop.position === 'number' ? stop.position.toFixed(3) : '?';
                const color = stop.color || '#000000';

                row.innerHTML = `
                    <span class="preview-interaction-key">Stop ${i}:</span>
                    <span class="preview-interaction-value">
                        <span style="display:inline-block;width:16px;height:16px;background:${color};border:1px solid #666;vertical-align:middle;margin-right:4px;"></span>
                        ${color} @ ${pos}
                    </span>
                `;
                stopsContainer.appendChild(row);
            }

            if (stops.length > 10) {
                const more = document.createElement('div');
                more.className = 'preview-item';
                more.textContent = `... and ${stops.length - 10} more`;
                stopsContainer.appendChild(more);
            }

            container.appendChild(stopsContainer);
        }

        if (payload.sourceViewerNodeId !== undefined) {
            const sourceInfo = document.createElement('div');
            sourceInfo.className = 'preview-item preview-source-info';
            sourceInfo.innerHTML = `<span class="preview-label">Source:</span> <span class="preview-value">Node ${payload.sourceViewerNodeId}</span>`;
            container.appendChild(sourceInfo);
        }
    }

    isMatrixPreviewArray(value) {
        if (!Array.isArray(value) || value.length === 0) return false;
        let cols = 0;
        for (const row of value) {
            if (!Array.isArray(row)) return false;
            cols = Math.max(cols, row.length);
        }
        return cols > 0;
    }

    createVirtualViewport(rowCount, rowHeight, renderRows) {
        const viewport = document.createElement('div');
        viewport.className = 'preview-virtual-viewport';
        viewport.style.maxHeight = `${this.virtualViewportHeight}px`;

        const topSpacer = document.createElement('div');
        topSpacer.className = 'preview-virtual-spacer';
        const items = document.createElement('div');
        items.className = 'preview-virtual-items';
        const bottomSpacer = document.createElement('div');
        bottomSpacer.className = 'preview-virtual-spacer';

        const renderWindow = () => {
            const scrollTop = viewport.scrollTop || 0;
            const visibleRows = Math.max(1, Math.ceil(this.virtualViewportHeight / rowHeight));
            const start = Math.max(0, Math.floor(scrollTop / rowHeight) - this.virtualOverscanRows);
            const end = Math.min(rowCount, start + visibleRows + this.virtualOverscanRows * 2);
            topSpacer.style.height = `${start * rowHeight}px`;
            bottomSpacer.style.height = `${Math.max(0, rowCount - end) * rowHeight}px`;
            items.innerHTML = '';
            renderRows(items, start, end);
        };

        viewport.addEventListener('scroll', renderWindow);
        viewport.appendChild(topSpacer);
        viewport.appendChild(items);
        viewport.appendChild(bottomSpacer);
        renderWindow();
        return viewport;
    }

    buildArrayLoadMoreControls(state, value, rootArrayUsesPagedFetch) {
        const persistState = typeof state.persist === 'function' ? state.persist : () => {};
        const totalCount = Number.isFinite(this.node?.previewMeta?.totalCount)
            ? this.node.previewMeta.totalCount
            : value.length;
        const remaining = Math.max(0, totalCount - state.shown);
        if (remaining <= 0 && !rootArrayUsesPagedFetch) {
            return null;
        }

        const controls = document.createElement('div');
        controls.className = 'preview-matrix-controls';

        const countInfo = document.createElement('div');
        countInfo.className = 'preview-matrix-control-group';
        countInfo.innerHTML = `<span class="preview-label">Items:</span> <span class="preview-value">${state.shown} / ${totalCount}</span>`;

        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.type = 'button';
        loadMoreBtn.className = 'preview-load-more';
        loadMoreBtn.textContent = 'Show More';
        loadMoreBtn.addEventListener('click', async () => {
            if (rootArrayUsesPagedFetch &&
                this.node?.previewMeta?.hasMorePages === true &&
                state.shown >= value.length) {
                loadMoreBtn.disabled = true;
                loadMoreBtn.textContent = 'Loading...';
                const pageSize = Number.isFinite(this.node?.previewMeta?.pageSize)
                    ? Number(this.node.previewMeta.pageSize)
                    : this.arrayPageSize;
                const previousShown = state.shown;
                state.revealFrom = Math.max(0, state.shown);
                state.shown = Math.min(totalCount, state.shown + pageSize);
                persistState();
                const ok = await this.editor.fetchPreviewPageForNode(this.node, {
                    socketId: this.node?.previewMeta?.socketId || null,
                    offset: value.length,
                    limit: pageSize
                }).catch(() => false);
                loadMoreBtn.disabled = false;
                loadMoreBtn.textContent = 'Show More';
                if (!ok) {
                    state.shown = previousShown;
                    state.revealFrom = null;
                    persistState();
                    this.refresh(this.node, { skipEnsure: true });
                }
                return;
            }
            const previousShown = state.shown;
            state.shown = Math.min(value.length, state.shown + this.arrayPageSize);
            state.revealFrom = previousShown;
            persistState();
            this.refresh(this.node, { skipEnsure: true });
        });
        countInfo.appendChild(loadMoreBtn);
        controls.appendChild(countInfo);
        return controls;
    }

    renderVirtualArrayBlock(container, label, value, depth, forceOpen, rootArrayUsesPagedFetch, pathKey = label) {
        const arrayStateKey = buildPreviewStateKey(Number(this.node?.id), pathKey, 'array');
        const openStateKey = buildPreviewStateKey(Number(this.node?.id), pathKey, 'open');
        const savedState = arrayStateKey ? this.arrayPreviewState.get(arrayStateKey) : null;
        const details = document.createElement('details');
        details.className = 'preview-collapsible';
        const defaultOpen = forceOpen || depth <= 0;
        details.open = openStateKey ? (this.previewOpenState.get(openStateKey) ?? defaultOpen) : defaultOpen;
        if (openStateKey) {
            details.addEventListener('toggle', () => {
                this.previewOpenState.set(openStateKey, details.open);
            });
        }

        const summary = document.createElement('summary');
        summary.className = 'preview-collapsible-summary';
        summary.innerHTML = `<span class="preview-label">${label}:</span> Array (${value.length} items)`;
        details.appendChild(summary);

        const state = createPersistedWindowState(this.arrayPreviewState, arrayStateKey, {
            shown: Math.min(
                value.length,
                Number.isFinite(savedState?.shown)
                    ? Number(savedState.shown)
                    : Math.min(value.length, this.arrayPageSize)
            ),
            revealFrom: Number.isFinite(savedState?.revealFrom) ? Number(savedState.revealFrom) : null
        });
        const viewport = this.createVirtualViewport(state.shown, this.virtualRowHeight, (items, start, end) => {
            for (let i = start; i < end; i++) {
                const v = value[i];
                if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
                    this.renderValueBlock(items, `[${i}]`, v, depth + 1, false, `${pathKey}[${i}]`);
                } else {
                    const listItem = document.createElement('div');
                    listItem.className = 'preview-list-item';
                    listItem.style.height = `${this.virtualRowHeight}px`;
                    if (typeof v === 'number') {
                        listItem.innerHTML = `<span class="preview-index">[${i}]</span> ${v.toFixed(6)}`;
                    } else {
                        listItem.innerHTML = `<span class="preview-index">[${i}]</span> ${String(v)}`;
                    }
                    items.appendChild(listItem);
                }
            }
        });
        const controls = this.buildArrayLoadMoreControls(state, value, rootArrayUsesPagedFetch);
        if (controls) {
            details.appendChild(controls);
        }
        details.appendChild(viewport);
        applyRevealPosition(
            viewport,
            this.arrayPreviewState,
            arrayStateKey,
            savedState,
            state,
            'revealFrom',
            this.virtualRowHeight
        );
        state.persist();
        container.appendChild(details);
    }

    renderMatrixPreviewBlock(container, label, value, depth, forceOpen, rootArrayUsesPagedFetch, pathKey = label) {
        const rows = value.length;
        const cols = value.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
        const matrixStateKey = buildPreviewStateKey(Number(this.node?.id), pathKey);
        const openStateKey = buildPreviewStateKey(Number(this.node?.id), pathKey, 'open');
        const savedState = matrixStateKey ? this.matrixPreviewState.get(matrixStateKey) : null;
        const budget = Math.max(1, Number(this.matrixCellBudget) || 100);
        const defaultWindow = computeMatrixWindow(rows, cols, budget);

        const details = document.createElement('details');
        details.className = 'preview-collapsible';
        const defaultOpen = forceOpen || depth <= 0;
        details.open = openStateKey ? (this.previewOpenState.get(openStateKey) ?? defaultOpen) : defaultOpen;
        if (openStateKey) {
            details.addEventListener('toggle', () => {
                this.previewOpenState.set(openStateKey, details.open);
            });
        }

        const summary = document.createElement('summary');
        summary.className = 'preview-collapsible-summary';
        summary.innerHTML = `<span class="preview-label">${label}:</span> Matrix (${rows} x ${cols})`;
        details.appendChild(summary);

        const state = createPersistedWindowState(this.matrixPreviewState, matrixStateKey, {
            shownRows: Math.min(
                rows,
                Number.isFinite(savedState?.shownRows) ? Number(savedState.shownRows) : defaultWindow.shownRows
            ),
            shownCols: Math.min(
                cols,
                Number.isFinite(savedState?.shownCols) ? Number(savedState.shownCols) : defaultWindow.shownCols
            ),
            revealFromRow: Number.isFinite(savedState?.revealFromRow) ? Number(savedState.revealFromRow) : null
        });
        const persistState = state.persist;

        const controls = document.createElement('div');
        controls.className = 'preview-matrix-controls';

        const rowTotalCount = Number.isFinite(this.node?.previewMeta?.totalCount)
            ? this.node.previewMeta.totalCount
            : value.length;
        const loadedRows = value.length;
        const canShowMoreRows = state.shownRows < loadedRows;
        const canFetchMoreRows = rootArrayUsesPagedFetch &&
            this.node?.previewMeta?.hasMorePages === true &&
            state.shownRows >= loadedRows;
        const canShowMoreCols = state.shownCols < cols;

        const rowInfo = document.createElement('div');
        rowInfo.className = 'preview-matrix-control-group';
        rowInfo.innerHTML = `<span class="preview-label">Rows:</span> <span class="preview-value">${state.shownRows} / ${rowTotalCount}</span>`;
        if (canShowMoreRows || canFetchMoreRows) {
            const loadMoreRowsBtn = document.createElement('button');
            loadMoreRowsBtn.type = 'button';
            loadMoreRowsBtn.className = 'preview-load-more';
            loadMoreRowsBtn.textContent = 'Show More';
            loadMoreRowsBtn.addEventListener('click', async () => {
                if (canFetchMoreRows) {
                    loadMoreRowsBtn.disabled = true;
                    loadMoreRowsBtn.textContent = 'Loading...';
                    const pageSize = Number.isFinite(this.node?.previewMeta?.pageSize)
                        ? Number(this.node.previewMeta.pageSize)
                        : Math.max(1, Math.floor(budget / Math.max(1, cols)));
                    const previousShownRows = state.shownRows;
                    state.revealFromRow = Math.max(0, state.shownRows);
                    state.shownRows = Math.min(rowTotalCount, state.shownRows + pageSize);
                    persistState();
                    const ok = await this.editor.fetchPreviewPageForNode(this.node, {
                        socketId: this.node?.previewMeta?.socketId || null,
                        offset: value.length,
                        limit: pageSize
                    }).catch(() => false);
                    if (!ok) {
                        state.shownRows = previousShownRows;
                        state.revealFromRow = null;
                        persistState();
                        loadMoreRowsBtn.disabled = false;
                        loadMoreRowsBtn.textContent = 'Show More';
                    }
                    return;
                }
                state.shownRows = Math.min(loadedRows, state.shownRows + defaultWindow.shownRows);
                state.revealFromRow = Math.max(0, state.shownRows - defaultWindow.shownRows);
                persistState();
                this.refresh(this.node, { skipEnsure: true });
            });
            rowInfo.appendChild(loadMoreRowsBtn);
        }
        controls.appendChild(rowInfo);

        const colInfo = document.createElement('div');
        colInfo.className = 'preview-matrix-control-group';
        colInfo.innerHTML = `<span class="preview-label">Cols:</span> <span class="preview-value">${state.shownCols} / ${cols}</span>`;
        if (canShowMoreCols) {
            const loadMoreColsBtn = document.createElement('button');
            loadMoreColsBtn.type = 'button';
            loadMoreColsBtn.className = 'preview-load-more';
            loadMoreColsBtn.textContent = 'Show More';
            loadMoreColsBtn.addEventListener('click', () => {
                state.shownCols = Math.min(cols, state.shownCols + defaultWindow.shownCols);
                persistState();
                this.refresh(this.node, { skipEnsure: true });
            });
            colInfo.appendChild(loadMoreColsBtn);
        }
        controls.appendChild(colInfo);

        details.appendChild(controls);
        persistState();

        const viewport = this.createVirtualViewport(state.shownRows, this.matrixRowHeight, (items, start, end) => {
            for (let i = start; i < end; i++) {
                const row = Array.isArray(value[i]) ? value[i] : [];
                const rowEl = document.createElement('div');
                rowEl.className = 'preview-matrix-row';
                rowEl.style.height = `${this.matrixRowHeight}px`;

                const index = document.createElement('div');
                index.className = 'preview-matrix-index';
                index.textContent = `[${i}]`;
                rowEl.appendChild(index);

                const values = document.createElement('div');
                values.className = 'preview-matrix-cells';
                const visibleCols = Math.min(row.length, state.shownCols);
                for (let c = 0; c < visibleCols; c++) {
                    const cell = document.createElement('span');
                    cell.className = 'preview-matrix-cell';
                    const cellValue = row[c];
                    cell.textContent = typeof cellValue === 'number'
                        ? cellValue.toFixed(6)
                        : String(cellValue);
                    values.appendChild(cell);
                }
                if (row.length > state.shownCols) {
                    const more = document.createElement('span');
                    more.className = 'preview-matrix-more';
                    more.textContent = `... +${row.length - state.shownCols}`;
                    values.appendChild(more);
                }
                rowEl.appendChild(values);
                items.appendChild(rowEl);
            }
        });

        const scrollShell = document.createElement('div');
        scrollShell.className = 'preview-matrix-scroll';
        scrollShell.appendChild(viewport);
        applyRevealPosition(
            viewport,
            this.matrixPreviewState,
            matrixStateKey,
            savedState,
            state,
            'revealFromRow',
            this.matrixRowHeight
        );
        details.appendChild(scrollShell);
        container.appendChild(details);
    }

    renderValueBlock(container, label, value, depth, forceOpen = false, pathKey = label) {
        if (typeof value === 'number') {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.innerHTML = `<span class="preview-label">${label}:</span> <span class="preview-value">${value.toFixed(6)}</span>`;
            container.appendChild(item);
        }
        else if (Array.isArray(value)) {
            const rootArrayUsesPagedFetch =
                depth === 0 &&
                this.node &&
                this.node.previewMeta &&
                this.node.previewMeta.outputsTruncated === true &&
                typeof this.editor?.fetchPreviewPageForNode === 'function';

            if (this.isMatrixPreviewArray(value)) {
                this.renderMatrixPreviewBlock(container, label, value, depth, forceOpen, rootArrayUsesPagedFetch, pathKey);
                return;
            }

            this.renderVirtualArrayBlock(container, label, value, depth, forceOpen, rootArrayUsesPagedFetch, pathKey);
        }
        else if (typeof value === 'object' && value !== null) {
            const objectKeys = Object.keys(value);
            const shouldForceOpen =
                forceOpen ||
                depth <= 1 ||
                label === 'payload' ||
                label === 'Payload' ||
                label === 'value' ||
                label === 'handles' ||
                label === 'event' ||
                label === 'state';
            const openStateKey = buildPreviewStateKey(Number(this.node?.id), pathKey, 'open');
            const details = document.createElement('details');
            details.className = 'preview-collapsible';
            details.open = openStateKey ? (this.previewOpenState.get(openStateKey) ?? shouldForceOpen) : shouldForceOpen;
            if (openStateKey) {
                details.addEventListener('toggle', () => {
                    this.previewOpenState.set(openStateKey, details.open);
                });
            }

            const summary = document.createElement('summary');
            summary.className = 'preview-collapsible-summary';
            summary.innerHTML = `<span class="preview-label">${label}:</span> Object (${objectKeys.length} keys)`;
            details.appendChild(summary);

            const objContent = document.createElement('div');
            objContent.className = 'preview-object';
            if (objectKeys.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'preview-object-item';
                empty.textContent = '(empty)';
                objContent.appendChild(empty);
            }
            for (const [key, val] of Object.entries(value)) {
                if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
                    this.renderValueBlock(objContent, key, val, depth + 1, false, `${pathKey}.${key}`);
                } else {
                    const objItem = document.createElement('div');
                    objItem.className = 'preview-object-item';
                    if (typeof val === 'number') {
                        objItem.innerHTML = `<span class="preview-key">${key}:</span> ${val.toFixed(6)}`;
                    } else {
                        objItem.innerHTML = `<span class="preview-key">${key}:</span> ${JSON.stringify(val)}`;
                    }
                    objContent.appendChild(objItem);
                }
            }
            details.appendChild(objContent);
            container.appendChild(details);
        }
        else if (typeof value === 'string') {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.innerHTML = `<span class="preview-label">${label}:</span> <span class="preview-value">${value}</span>`;
            container.appendChild(item);
        }
        else {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.innerHTML = `<span class="preview-label">${label}:</span> <span class="preview-value">${String(value)}</span>`;
            container.appendChild(item);
        }
    }

    adjustPosition() {
        if (!this.panel) return;

        const rect = this.panel.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = parseInt(this.panel.style.left);
        let top = parseInt(this.panel.style.top);

        
        if (rect.right > viewportWidth) {
            left = viewportWidth - rect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }

        
        if (rect.bottom > viewportHeight) {
            top = viewportHeight - rect.height - 10;
        }
        if (top < 10) {
            top = 10;
        }

        this.panel.style.left = left + 'px';
        this.panel.style.top = top + 'px';
    }

    hide() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
            this.node = null;
            this.content = null;
        }
    }

    isVisible() {
        return !!this.panel;
    }
}


export { PreviewPanel };
