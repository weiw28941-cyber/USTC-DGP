class QueuedExecutionOptionsAccumulator {
    constructor(mergeExecutionOptions) {
        this.mergeExecutionOptions = typeof mergeExecutionOptions === 'function'
            ? mergeExecutionOptions
            : ((base, override) => ({ ...(base || {}), ...(override || {}) }));
        this.pending = null;
    }

    queue(executionOptions) {
        if (!executionOptions || typeof executionOptions !== 'object') {
            return;
        }
        this.pending = this.mergeExecutionOptions(this.pending || {}, executionOptions);
    }

    consume() {
        const value = this.pending;
        this.pending = null;
        return value;
    }

    clear() {
        this.pending = null;
    }
}

export { QueuedExecutionOptionsAccumulator };
