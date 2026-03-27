class Node {
    constructor(id, type, x, y, config) {
        this.id = id;
        this.type = type;
        this.x = x;
        this.y = y;
        this.width = 180;
        this.height = 120;
        this.inputs = [];
        this.outputs = [];
        this.value = 0;
        this.operation = 'add';
        this.label = 'Result';
        this.values = null;
        this.controlButtons = null;
        this.isDragging = false;
        this.success = true;
        this.errorMessage = '';
        this.errorInputs = new Set();
        this.errorOutputs = new Set();
        this.config = config;
        this.previewSocket = (typeof config?.previewSocket === 'string' && config.previewSocket)
            ? config.previewSocket
            : (config?.previewSocket === null ? null : undefined);
        this.previewValue = null; // 棰勮鍊?
        this.showPreview = true; // 鏄惁鏄剧ず棰勮
        this.visible = true; // 鑺傜偣鍙鎬э紙鐢ㄤ簬缁勬姌鍙狅級
        this.group = null; // 鎵€灞炵殑缁?

        this.setupNodeType();
    }

    setupNodeType() {
        if (!this.config) return;

        // Setup inputs
        this.inputs = this.config.inputs.map((input, index) => ({
            id: input.id,
            label: input.label,
            type: input.type,
            customType: input.customType || '',
            x: 0,
            y: 40 + index * 40,
            connection: null
        }));

        // Setup outputs
        this.outputs = this.config.outputs.map((output, index) => ({
            id: output.id,
            label: output.label,
            type: output.type,
            customType: output.customType || '',
            x: this.width,
            y: 60 + index * 40
        }));

        // Setup properties
        if (this.config.properties) {
            for (const [key, prop] of Object.entries(this.config.properties)) {
                this[key] = prop.default;
            }
        }

        this.updateAutoSize();
    }

    updateAutoSize() {
        const inputCount = this.inputs.length;
        const outputCount = this.outputs.length;
        const maxCount = Math.max(inputCount, outputCount, 1);
        const desired = (maxCount * 40) + 60;
        this.height = Math.max(120, desired);
    }

    draw(ctx, isSelected) {
        this.updateAutoSize();
        const isFailed = !this.success || !!this.errorMessage;
        // Node body color based on success status
        const baseColor = isFailed ? '#e74c3c' : this.config.color;
        ctx.fillStyle = isSelected ? this.adjustColor(baseColor, -20) : baseColor;
        ctx.strokeStyle = isFailed ? '#ffffff' : (isSelected ? '#61dafb' : '#4a5568');
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.roundRect(this.x, this.y, this.width, this.height, 8);
        ctx.fill();
        ctx.stroke();

        // Node header
        ctx.fillStyle = this.adjustColor(baseColor, -30);
        ctx.beginPath();
        ctx.roundRect(this.x, this.y, this.width, 30, [8, 8, 0, 0]);
        ctx.fill();

        // Node title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        const titleText = this.config.name.toUpperCase();
        const titleX = this.x + 10;
        const titleY = this.y + 20;
        ctx.fillText(titleText, titleX, titleY);
        const titleWidth = ctx.measureText(titleText).width;
        this.titleBounds = {
            x: titleX - 2,
            y: titleY - 14,
            width: titleWidth + 4,
            height: 18
        };

        // Draw inputs
        this.inputs.forEach((input, index) => {
            const isError = this.errorInputs.has(index);
            ctx.fillStyle = isError ? '#e74c3c' : '#61dafb';
            ctx.beginPath();
            ctx.arc(this.x + input.x, this.y + input.y, 6, 0, Math.PI * 2);
            ctx.fill();
            if (isError) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.fillText(input.label, this.x + 15, this.y + input.y + 4);
        });

        this.controlButtons = null;
        if (this.type === 'vector') {
            const lastInput = this.inputs[this.inputs.length - 1];
            if (lastInput) {
                const radius = 6;
                const btnY = this.y + lastInput.y + 12;
                const centerX = this.x + (this.width / 2) - 8;
                const addX = centerX - 50;
                const removeX = centerX - 30;

                this.drawControlButton(ctx, addX, btnY, radius, 'add');
                this.drawControlButton(ctx, removeX, btnY, radius, 'remove');

                this.controlButtons = {
                    vectorAdd: { cx: addX, cy: btnY, r: radius },
                    vectorRemove: { cx: removeX, cy: btnY, r: radius }
                };
            } else {
                const radius = 6;
                const addX = this.x + (this.width / 2) - 58;
                const btnY = this.y + 50;
                this.drawControlButton(ctx, addX, btnY, radius, 'add');
                this.controlButtons = {
                    vectorAdd: { cx: addX, cy: btnY, r: radius }
                };
            }
        } else if (this.type === 'list') {
            this.controlButtons = { listAdd: [], listRemove: [] };
            if (this.inputs.length === 0) {
                const radius = 6;
                const addX = this.x + (this.width / 2) - 58;
                const btnY = this.y + 50;
                this.drawControlButton(ctx, addX, btnY, radius, 'add');
                this.controlButtons.listAdd.push({
                    cx: addX, cy: btnY, r: radius, index: 0
                });
            }
            this.inputs.forEach((input, index) => {
                const radius = 6;
                const addX = this.x + (this.width / 2) - 58;
                const removeX = this.x + (this.width / 2) - 42;
                const btnY = this.y + input.y + 12;

                this.drawControlButton(ctx, addX, btnY, radius, 'add');
                this.drawControlButton(ctx, removeX, btnY, radius, 'remove');

                this.controlButtons.listAdd.push({
                    cx: addX, cy: btnY, r: radius, index
                });
                this.controlButtons.listRemove.push({
                    cx: removeX, cy: btnY, r: radius, index
                });
            });
        } else if (this.type === 'geometry') {
            const radius = 6;
            const centerX = this.x + (this.width / 2) - 8;
            const addX = centerX - 56;
            const removeX = centerX - 40;
            const labels = ['P', 'L', 'M'];
            const bucketDefs = [
                { prefix: 'points', bucket: 0 },
                { prefix: 'lines', bucket: 1 },
                { prefix: 'mesh', bucket: 2 }
            ];
            this.controlButtons = { geometryAdd: [], geometryRemove: [] };

            const baseInput = this.inputs.find(input => input.id === 'geometry');
            let fallbackY = baseInput ? (this.y + baseInput.y + 12) : (this.y + 52);

            for (let i = 0; i < bucketDefs.length; i++) {
                const { prefix, bucket } = bucketDefs[i];
                const groupInputs = this.inputs.filter(input => input.id.startsWith(prefix));
                const anchorInput = groupInputs.length > 0 ? groupInputs[groupInputs.length - 1] : null;
                const y = anchorInput ? (this.y + anchorInput.y + 12) : fallbackY;
                fallbackY = y + 18;

                this.drawControlButton(ctx, addX, y, radius, 'add');
                this.drawControlButton(ctx, removeX, y, radius, 'remove');
                ctx.fillStyle = '#ffffff';
                ctx.font = '10px Arial';
                ctx.fillText(labels[i], removeX + 12, y + 3);
                this.controlButtons.geometryAdd.push({ cx: addX, cy: y, r: radius, bucket });
                this.controlButtons.geometryRemove.push({ cx: removeX, cy: y, r: radius, bucket });
            }
        }

        // Draw outputs
        this.outputs.forEach((output, index) => {
            const isError = this.errorOutputs.has(index);
            ctx.fillStyle = isError ? '#e74c3c' : '#a9dc76';
            ctx.beginPath();
            ctx.arc(this.x + output.x, this.y + output.y, 6, 0, Math.PI * 2);
            ctx.fill();
            if (isError) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(output.label, this.x + this.width - 15, this.y + output.y + 4);
            ctx.textAlign = 'left';
        });

        // Draw node-specific content
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        let contentY = this.y + 50;

        if (this.type === 'value') {
            ctx.fillText(`Value: ${this.value}`, this.x + 10, contentY);
        } else if (this.type === 'string') {
            const text = typeof this.text === 'string' ? this.text : '';
            const maxLen = 18;
            const display = text.length > maxLen
                ? text.slice(0, maxLen - 3) + '...'
                : text;
            ctx.fillText(`Text: ${display}`, this.x + 10, contentY);
        }

        const opLabel = this.getOperationLabel();
        if (opLabel) {
            const opText = `${this.operation}`;
            ctx.font = '11px Arial';
            ctx.textAlign = 'right';
            const labelText = `${opLabel}: ${opText}`;
            const textWidth = ctx.measureText(labelText).width;
            const paddingX = 6;
            const paddingY = 4;
            const buttonWidth = textWidth + paddingX * 2;
            const buttonHeight = 16 + paddingY;
            const opX = this.x + this.width - 8;
            const opY = this.y + 20;
            const buttonX = opX - buttonWidth;
            const buttonY = opY - 12 - (paddingY / 2);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 6);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.fillText(labelText, opX - paddingX, opY);
            this.opLabelBounds = {
                x: buttonX,
                y: buttonY,
                width: buttonWidth,
                height: buttonHeight
            };
            ctx.textAlign = 'left';
            ctx.font = '14px Arial';
        } else {
            this.opLabelBounds = null;
        }

        // Draw preview icon when the node has previewable outputs.
        const hasPreviewableOutput = Array.isArray(this.outputs) && this.outputs.length > 0;
        if (this.showPreview && hasPreviewableOutput && this.success) {
            const iconX = this.x + (this.width / 2) - 8;
            const iconY = this.y + (this.height / 2) + 6;
            const iconSize = 16;

            ctx.fillStyle = 'rgba(169, 220, 118, 0.2)';
            ctx.fillRect(iconX - 2, iconY - 2, iconSize + 4, iconSize + 4);

            ctx.strokeStyle = '#a9dc76';
            ctx.lineWidth = 1;
            ctx.strokeRect(iconX - 2, iconY - 2, iconSize + 4, iconSize + 4);

            // Eye outline
            const centerX = iconX + iconSize / 2;
            const centerY = iconY + iconSize / 2;
            ctx.strokeStyle = '#a9dc76';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, 6, 4, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Pupil
            ctx.fillStyle = '#a9dc76';
            ctx.beginPath();
            ctx.arc(centerX, centerY, 1.8, 0, Math.PI * 2);
            ctx.fill();

            // Save icon bounds for click handling
            this.previewIconBounds = {
                x: iconX - 2,
                y: iconY - 2,
                width: iconSize + 4,
                height: iconSize + 4
            };
        } else {
            this.previewIconBounds = null;
        }

        // Draw status indicator
        if (!this.success) {
            ctx.fillStyle = '#e74c3c';
            ctx.font = 'bold 12px Arial';
            ctx.fillText('ERROR', this.x + 10, this.y + this.height - 10);
        }
    }

    drawControlButton(ctx, cx, cy, r, type) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = type === 'add' ? '#61dafb' : '#e67e22';
        ctx.fill();

        ctx.strokeStyle = '#1e1e1e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - r + 2, cy);
        ctx.lineTo(cx + r - 2, cy);
        if (type === 'add') {
            ctx.moveTo(cx, cy - r + 2);
            ctx.lineTo(cx, cy + r - 2);
        }
        ctx.stroke();
    }

    // 鏍煎紡鍖栭瑙堝€?
    formatPreviewValue(value) {
        if (typeof value === 'number') {
            return value.toFixed(2);
        } else if (Array.isArray(value)) {
            if (value.length <= 3) {
                return `[${value.map(v => typeof v === 'number' ? v.toFixed(2) : v).join(', ')}]`;
            } else {
                return `[${value.length} items]`;
            }
        } else if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
    }

    adjustColor(color, amount) {
        const num = parseInt(color.replace('#', ''), 16);
        const r = Math.max(0, Math.min(255, (num >> 16) + amount));
        const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
        const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
        return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    }

    containsPoint(x, y) {
        return x >= this.x && x <= this.x + this.width &&
               y >= this.y && y <= this.y + this.height;
    }

    // 妫€鏌ョ偣鍑绘槸鍚﹀湪棰勮鍥炬爣涓?
    containsPreviewIcon(x, y) {
        if (!this.previewIconBounds) return false;
        const bounds = this.previewIconBounds;
        return x >= bounds.x && x <= bounds.x + bounds.width &&
               y >= bounds.y && y <= bounds.y + bounds.height;
    }

    getSocketAt(x, y) {
        for (let input of this.inputs) {
            const dx = (this.x + input.x) - x;
            const dy = (this.y + input.y) - y;
            if (Math.sqrt(dx * dx + dy * dy) < 8) {
                return {type: 'input', socket: input, node: this};
            }
        }
        for (let output of this.outputs) {
            const dx = (this.x + output.x) - x;
            const dy = (this.y + output.y) - y;
            if (Math.sqrt(dx * dx + dy * dy) < 8) {
                return {type: 'output', socket: output, node: this};
            }
        }
        return null;
    }

    containsOpLabel(x, y) {
        if (!this.opLabelBounds) return false;
        const bounds = this.opLabelBounds;
        return x >= bounds.x && x <= bounds.x + bounds.width &&
               y >= bounds.y && y <= bounds.y + bounds.height;
    }

    containsTitleLabel(x, y) {
        if (!this.titleBounds) return false;
        const bounds = this.titleBounds;
        return x >= bounds.x && x <= bounds.x + bounds.width &&
               y >= bounds.y && y <= bounds.y + bounds.height;
    }

    getOperationLabel() {
        const operationProp = this.config?.properties?.operation;
        if (operationProp?.editable === false) {
            return null;
        }
        const options = operationProp?.options;
        if (!Array.isArray(options) || options.length === 0) {
            return null;
        }
        const isTypeSwitch = options.includes('number') && options.includes('string');
        return isTypeSwitch ? 'Type' : 'Op';
    }

    getSchemaInfo() {
        const properties = this.config?.properties || {};
        const entries = Object.entries(properties);
        const editableEntries = entries.filter(([, prop]) => prop?.editable !== false);
        const readonlyEntries = entries.filter(([, prop]) => prop?.editable === false);
        const primaryEntry = editableEntries.find(([key]) => key === 'operation')
            || editableEntries.find(([key]) => key === 'value')
            || editableEntries.find(([key]) => key === 'text')
            || editableEntries[0]
            || null;
        return {
            editableEntries,
            readonlyEntries,
            primaryEntry
        };
    }

}

export { Node };


