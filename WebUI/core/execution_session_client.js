class ExecutionSessionClient {
    constructor(options = {}) {
        this.baseUrl = String(options.baseUrl || 'http://localhost:3000');
        this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch.bind(globalThis);
        this.sessionId = null;
        this.sessionVersion = null;
        this.pendingOutputPageRequests = new Map();
        this.outputPageCache = new Map();
        this.pendingNodeOutputRequests = new Map();
    }

    hasSession() {
        return !!this.sessionId;
    }

    resetSession() {
        this.sessionId = null;
        this.sessionVersion = null;
        this.pendingOutputPageRequests.clear();
        this.outputPageCache.clear();
        this.pendingNodeOutputRequests.clear();
    }

    updateSessionVersion(nextVersion) {
        if (!Number.isFinite(nextVersion)) return;
        if (!Number.isFinite(this.sessionVersion)) {
            this.sessionVersion = Number(nextVersion);
            return;
        }
        const merged = Math.max(Number(this.sessionVersion), Number(nextVersion));
        if (merged !== this.sessionVersion) {
            this.outputPageCache.clear();
        }
        this.sessionVersion = merged;
    }

    createJsonResponse(status, payload) {
        return new Response(JSON.stringify(payload), {
            status,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    buildOutputPageKey(nodeId, socketId, options = {}) {
        return JSON.stringify({
            sessionId: this.sessionId || null,
            version: Number.isFinite(this.sessionVersion) ? Number(this.sessionVersion) : null,
            nodeId: Number(nodeId),
            socketId: String(socketId),
            offset: Number.isFinite(options.offset) ? Number(options.offset) : 0,
            limit: Number.isFinite(options.limit) ? Number(options.limit) : 0
        });
    }

    buildNodeOutputsKey(nodeId, outputSockets = [], options = {}) {
        return JSON.stringify({
            sessionId: this.sessionId || null,
            version: Number.isFinite(this.sessionVersion) ? Number(this.sessionVersion) : null,
            nodeId: Number(nodeId),
            outputSockets: Array.isArray(outputSockets) ? outputSockets.slice() : [],
            executionOptions: options.executionOptions || {}
        });
    }

    async executeGraph(graphData, options = {}) {
        const execute = options.execute !== false;
        const headers = { 'Content-Type': 'application/json' };

        if (!this.sessionId) {
            const createResp = await this.fetchImpl(`${this.baseUrl}/graph/session`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    graphData,
                    execute
                })
            });
            if (createResp.ok) {
                try {
                    const payload = await createResp.clone().json();
                    this.sessionId = payload.sessionId || null;
                    this.sessionVersion = null;
                    this.updateSessionVersion(payload.version);
                } catch (_) {
                }
            }
            return createResp;
        }

        const snapshotResp = await this.fetchImpl(
            `${this.baseUrl}/graph/${encodeURIComponent(this.sessionId)}/snapshot`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    baseVersion: this.sessionVersion,
                    graphData,
                    execute
                })
            }
        );

        if (snapshotResp.status === 404 || snapshotResp.status === 409) {
            this.resetSession();
            return this.executeGraph(graphData, options);
        }

        if (snapshotResp.ok) {
            try {
                const payload = await snapshotResp.clone().json();
                this.updateSessionVersion(payload.version);
            } catch (_) {
            }
        }

        return snapshotResp;
    }

    async dispatchGraphPatches(patches, options = {}) {
        const list = Array.isArray(patches) ? patches : [];
        if (list.length === 0) return null;

        if (!this.sessionId) {
            const initResp = await this.executeGraph(options.graphData, { execute: false });
            if (!initResp || !initResp.ok) {
                return initResp;
            }
        }

        const resp = await this.fetchImpl(
            `${this.baseUrl}/graph/${encodeURIComponent(this.sessionId)}/patch`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    baseVersion: this.sessionVersion,
                    patches: list,
                    execute: options.execute !== false,
                    fullResults: options.fullResults === true,
                    executionOptions: options.executionOptions || {}
                })
            }
        );

        if (resp.status === 404 || resp.status === 409) {
            this.resetSession();
            if (options.retry !== false) {
                return this.dispatchGraphPatches(list, { ...options, retry: false });
            }
        }

        if (resp.ok) {
            try {
                const payload = await resp.clone().json();
                this.updateSessionVersion(payload.version);
            } catch (_) {
            }
        }

        return resp;
    }

    async fetchNodeOutputs(nodeId, outputSockets = [], options = {}) {
        if (!Number.isFinite(nodeId)) return null;

        if (!this.sessionId) {
            const initResp = await this.executeGraph(options.graphData, { execute: false });
            if (!initResp || !initResp.ok) {
                return initResp;
            }
        }

        const requestKey = this.buildNodeOutputsKey(nodeId, outputSockets, options);
        if (this.pendingNodeOutputRequests.has(requestKey)) {
            return this.pendingNodeOutputRequests.get(requestKey);
        }

        const task = (async () => {
            const resp = await this.fetchImpl(
                `${this.baseUrl}/graph/${encodeURIComponent(this.sessionId)}/outputs`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        baseVersion: this.sessionVersion,
                        nodeId,
                        outputSockets: Array.isArray(outputSockets) ? outputSockets : [],
                        executionOptions: options.executionOptions || {}
                    })
                }
            );

            if (resp.status === 404 || resp.status === 409) {
                this.resetSession();
                if (options.retry !== false) {
                    return this.fetchNodeOutputs(nodeId, outputSockets, { ...options, retry: false });
                }
            }

            if (resp.ok) {
                try {
                    const payload = await resp.clone().json();
                    this.updateSessionVersion(payload.version);
                } catch (_) {
                }
            }

            return resp;
        })().finally(() => {
            this.pendingNodeOutputRequests.delete(requestKey);
        });

        this.pendingNodeOutputRequests.set(requestKey, task);
        return task;
    }

    async fetchNodeOutputPage(nodeId, socketId, options = {}) {
        if (!Number.isFinite(nodeId) || typeof socketId !== 'string' || socketId.length === 0) {
            return null;
        }

        if (!this.sessionId) {
            const initResp = await this.executeGraph(options.graphData, { execute: false });
            if (!initResp || !initResp.ok) {
                return initResp;
            }
        }

        const requestKey = this.buildOutputPageKey(nodeId, socketId, options);
        if (options.bypassCache !== true && this.outputPageCache.has(requestKey)) {
            return this.createJsonResponse(200, this.outputPageCache.get(requestKey));
        }
        if (this.pendingOutputPageRequests.has(requestKey)) {
            return this.pendingOutputPageRequests.get(requestKey);
        }

        const task = (async () => {
            const resp = await this.fetchImpl(
                `${this.baseUrl}/graph/${encodeURIComponent(this.sessionId)}/output-page`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        baseVersion: this.sessionVersion,
                        nodeId,
                        socketId,
                        offset: Number.isFinite(options.offset) ? options.offset : 0,
                        limit: Number.isFinite(options.limit) ? options.limit : 0
                    })
                }
            );

            if (resp.status === 404 || resp.status === 409) {
                this.resetSession();
                if (options.retry !== false) {
                    return this.fetchNodeOutputPage(nodeId, socketId, { ...options, retry: false });
                }
            }

            if (resp.ok) {
                try {
                    const payload = await resp.clone().json();
                    this.updateSessionVersion(payload.version);
                    if (options.cache !== false) {
                        this.outputPageCache.set(requestKey, payload);
                        const resolvedCacheKey = this.buildOutputPageKey(nodeId, socketId, options);
                        this.outputPageCache.set(resolvedCacheKey, payload);
                    }
                } catch (_) {
                }
            }

            return resp;
        })().finally(() => {
            this.pendingOutputPageRequests.delete(requestKey);
        });

        this.pendingOutputPageRequests.set(requestKey, task);
        return task;
    }

    async prefetchNodeOutputPage(nodeId, socketId, options = {}) {
        const resp = await this.fetchNodeOutputPage(nodeId, socketId, {
            ...options,
            cache: true
        });
        return !!resp && resp.ok;
    }
}

export { ExecutionSessionClient };
