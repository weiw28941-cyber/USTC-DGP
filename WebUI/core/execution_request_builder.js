import { DEFAULT_PAGED_PREVIEW_ITEMS } from './output_transport.js';
import {
    buildContextPreviewExecutionOptions,
    buildNodePreviewExecutionOptions,
    getPreferredPreviewSocketId
} from './preview_target_router.js';

function buildIncrementalExecutionOptions(context) {
    const targets = buildContextPreviewExecutionOptions(context);
    return {
        ...targets,
        maxPreviewItems: DEFAULT_PAGED_PREVIEW_ITEMS
    };
}

export {
    buildNodePreviewExecutionOptions,
    buildIncrementalExecutionOptions,
    getPreferredPreviewSocketId
};
