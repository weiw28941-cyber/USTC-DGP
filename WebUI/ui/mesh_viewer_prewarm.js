import { isGeometryViewerPayload } from '../core/output_transport.js';
import { scheduleHandleAuxiliaryBuild as scheduleAuxiliaryLodBuild } from './mesh_viewer_aux_lods.js';
import { setMetaSummaryMessage } from './mesh_viewer_runtime.js';

export function scheduleRuntimeWarmup(viewer) {
    if (viewer.panel && viewer.gl && viewer.program) {
        return Promise.resolve();
    }
    if (viewer.pendingRuntimeWarmup) {
        return viewer.pendingRuntimeWarmup;
    }
    viewer.pendingRuntimeWarmup = (async () => {
        await viewer.afterNextPaint();
        const panelWasVisible = !!viewer.panel && viewer.panel.style.display !== 'none';
        const previousNodeId = viewer.currentNodeId;
        viewer.ensurePanel();
        if (!panelWasVisible && viewer.panel) {
            viewer.panel.style.display = 'none';
        }
        viewer.currentNodeId = previousNodeId;
    })().finally(() => {
        viewer.pendingRuntimeWarmup = null;
    });
    return viewer.pendingRuntimeWarmup;
}

export async function runDeferredShowPipeline(viewer, token, payload) {
    try {
        await viewer.afterNextPaint();
        if (token !== viewer.latestShowToken || viewer.pendingShowTask !== token) return;
        const prewarmKey = viewer.getMeshKey(payload);
        const pendingPrewarm = prewarmKey ? viewer.pendingIdlePrewarms.get(prewarmKey) : null;
        if (pendingPrewarm) {
            await pendingPrewarm.catch(() => {});
            if (token !== viewer.latestShowToken || viewer.pendingShowTask !== token) return;
            const warmedHandle = prewarmKey ? viewer.meshCache.get(prewarmKey) : null;
            if (warmedHandle && warmedHandle.version === (payload.version || 0)) {
                viewer.currentPayload = payload;
                viewer.bindMesh(payload);
                viewer.startRenderLoop();
                return;
            }
        }
        const resolved = await viewer.resolvePayload(payload);
        if (token !== viewer.latestShowToken || viewer.pendingShowTask !== token) return;
        viewer.currentPayload = resolved;
        await viewer.afterNextPaint();
        if (token !== viewer.latestShowToken || viewer.pendingShowTask !== token) return;
        viewer.bindMesh(resolved);
        viewer.startRenderLoop();
    } catch (error) {
        if (token !== viewer.latestShowToken || viewer.pendingShowTask !== token) return;
        setMetaSummaryMessage(viewer, `Load mesh stream failed: ${error.message || String(error)}`);
    }
}

export function scheduleHandleAuxiliaryBuild(viewer, handle) {
    return scheduleAuxiliaryLodBuild(viewer, handle);
}

export function prewarmPayload(viewer, node, payload) {
    if (!isGeometryViewerPayload(payload)) return;
    const key = viewer.getMeshKey(payload);
    if (!key) return;
    const pending = viewer.pendingIdlePrewarms.get(key);
    if (pending) return;
    const task = (async () => {
        await viewer.afterNextPaint();
        await scheduleRuntimeWarmup(viewer);
        await viewer.afterNextPaint();
        const resolved = await viewer.resolvePayload(payload);
        if (!viewer.panel || !viewer.gl || !viewer.program) {
            return;
        }
        await viewer.afterNextPaint();
        const handle = viewer.getOrCreateHandleForPayload(resolved);
        if (handle) {
            if (handle.isComposite && Array.isArray(handle.parts)) {
                for (const part of handle.parts) {
                    scheduleHandleAuxiliaryBuild(viewer, part);
                }
            } else {
                scheduleHandleAuxiliaryBuild(viewer, handle);
            }
        }
    })().finally(() => {
        viewer.pendingIdlePrewarms.delete(key);
    });
    viewer.pendingIdlePrewarms.set(key, task);
}
