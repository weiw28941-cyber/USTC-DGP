class NodeGroup {
    constructor(x, y, width, height, title = 'Group') {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.title = title;
        this.color = '#4a90e2';
        this.collapsed = false;
        this.nodes = new Set(); // 包含的节点
        this.isDragging = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        // 折叠时保存的节点位置
        this.savedNodePositions = new Map();

        // 保存展开和折叠状态的尺寸
        this.expandedWidth = width;
        this.expandedHeight = height;
        this.collapsedWidth = 200;
        this.collapsedHeight = 100;

        // 标题栏高度
        this.titleBarHeight = 30;

        // 最小尺寸
        this.minWidth = 200;
        this.minHeight = 150;
        this.minCollapsedWidth = 150;
        this.minCollapsedHeight = 60;

        // 调整大小的控制点
        this.resizeHandleSize = 10;

        // 折叠时的输入输出接口
        this.inputSockets = [];
        this.outputSockets = [];

        // 编辑状态
        this.isEditingTitle = false;
    }

    // 更新组的输入输出接口（用于折叠状态）
    updateSockets(connections) {
        this.inputSockets = [];
        this.outputSockets = [];

        if (!this.collapsed) return;

        // 找到所有连接到组内节点的外部连接
        for (let conn of connections) {
            const fromInGroup = this.nodes.has(conn.fromNode);
            const toInGroup = this.nodes.has(conn.toNode);

            // 输入：外部节点 -> 组内节点
            if (!fromInGroup && toInGroup) {
                this.inputSockets.push({
                    connection: conn,
                    label: conn.toSocket.label || conn.toSocket.id
                });
            }
            // 输出：组内节点 -> 外部节点
            else if (fromInGroup && !toInGroup) {
                this.outputSockets.push({
                    connection: conn,
                    label: conn.fromSocket.label || conn.fromSocket.id
                });
            }
        }
    }

    draw(ctx) {
        // 绘制组框架
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.fillStyle = this.color + '20'; // 半透明背景

        if (this.collapsed) {
            // 折叠状态：显示为一个紧凑的盒子
            // 使用保存的折叠高度，但至少要能容纳所有接口
            const minHeightForSockets = this.titleBarHeight + 20 +
                Math.max(this.inputSockets.length, this.outputSockets.length) * 25;
            this.collapsedHeight = Math.max(this.collapsedHeight, minHeightForSockets);

            ctx.fillRect(this.x, this.y, this.width, this.collapsedHeight);
            ctx.strokeRect(this.x, this.y, this.width, this.collapsedHeight);

            // 绘制标题栏
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.width, this.titleBarHeight);

            // 绘制标题
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`▶ ${this.title}`, this.x + 10, this.y + 20);

            // 绘制节点数量
            ctx.font = '12px Arial';
            ctx.fillStyle = '#cccccc';
            ctx.fillText(`(${this.nodes.size})`, this.x + this.width - 40, this.y + 20);

            // 绘制输入接口（左侧）
            ctx.font = '11px Arial';
            this.inputSockets.forEach((socket, index) => {
                const socketY = this.y + this.titleBarHeight + 20 + index * 25;

                // 绘制接口圆圈
                ctx.fillStyle = '#61dafb';
                ctx.beginPath();
                ctx.arc(this.x, socketY, 6, 0, Math.PI * 2);
                ctx.fill();

                // 绘制标签
                ctx.fillStyle = '#ffffff';
                ctx.fillText(socket.label, this.x + 12, socketY + 4);

                // 保存接口位置用于连接线
                socket.x = this.x;
                socket.y = socketY;
            });

            // 绘制输出接口（右侧）
            this.outputSockets.forEach((socket, index) => {
                const socketY = this.y + this.titleBarHeight + 20 + index * 25;

                // 绘制接口圆圈
                ctx.fillStyle = '#a9dc76';
                ctx.beginPath();
                ctx.arc(this.x + this.width, socketY, 6, 0, Math.PI * 2);
                ctx.fill();

                // 绘制标签（右对齐）
                ctx.fillStyle = '#ffffff';
                const labelWidth = ctx.measureText(socket.label).width;
                ctx.fillText(socket.label, this.x + this.width - labelWidth - 12, socketY + 4);

                // 保存接口位置用于连接线
                socket.x = this.x + this.width;
                socket.y = socketY;
            });

            // 绘制调整大小的控制点（右下角）- 折叠状态也可以调整
            ctx.fillStyle = this.color;
            ctx.fillRect(
                this.x + this.width - this.resizeHandleSize,
                this.y + this.collapsedHeight - this.resizeHandleSize,
                this.resizeHandleSize,
                this.resizeHandleSize
            );
        } else {
            // 展开状态：显示完整框架
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.strokeRect(this.x, this.y, this.width, this.height);

            // 绘制标题栏
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.width, this.titleBarHeight);

            // 绘制标题
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`▼ ${this.title}`, this.x + 10, this.y + 20);

            // 绘制调整大小的控制点（右下角）
            ctx.fillStyle = this.color;
            ctx.fillRect(
                this.x + this.width - this.resizeHandleSize,
                this.y + this.height - this.resizeHandleSize,
                this.resizeHandleSize,
                this.resizeHandleSize
            );
        }
    }

    containsPoint(x, y) {
        const height = this.collapsed ? this.collapsedHeight : this.height;
        return x >= this.x && x <= this.x + this.width &&
               y >= this.y && y <= this.y + height;
    }

    containsTitleBar(x, y) {
        return x >= this.x && x <= this.x + this.width &&
               y >= this.y && y <= this.y + this.titleBarHeight;
    }

    containsResizeHandle(x, y) {
        const height = this.collapsed ? this.collapsedHeight : this.height;
        return x >= this.x + this.width - this.resizeHandleSize &&
               x <= this.x + this.width &&
               y >= this.y + height - this.resizeHandleSize &&
               y <= this.y + height;
    }

    // 切换折叠状态
    toggleCollapse() {
        if (this.collapsed) {
            // 展开：保存折叠尺寸，恢复展开尺寸
            this.collapsedWidth = this.width;
            this.collapsedHeight = this.collapsedHeight; // 保持当前折叠高度
            this.width = this.expandedWidth;
            this.height = this.expandedHeight;

            // 恢复节点位置和可见性
            for (let node of this.nodes) {
                const savedPos = this.savedNodePositions.get(node);
                if (savedPos) {
                    // 根据当前组位置和保存的偏移量恢复节点位置
                    node.x = this.x + savedPos.offsetX;
                    node.y = this.y + savedPos.offsetY;
                }
                node.visible = true;
            }
        } else {
            // 折叠：保存展开尺寸，恢复折叠尺寸
            this.expandedWidth = this.width;
            this.expandedHeight = this.height;
            this.width = this.collapsedWidth;
            // collapsedHeight 会在 draw() 中根据接口数量动态计算

            // 保存节点相对于组的偏移量并隐藏节点
            this.savedNodePositions.clear();
            for (let node of this.nodes) {
                // 保存相对偏移量，而不是绝对位置
                this.savedNodePositions.set(node, {
                    offsetX: node.x - this.x,
                    offsetY: node.y - this.y
                });
                node.visible = false;
            }
        }

        this.collapsed = !this.collapsed;
    }

    // 添加节点到组
    addNode(node) {
        this.nodes.add(node);
        node.group = this;
    }

    // 从组中移除节点
    removeNode(node) {
        this.nodes.delete(node);
        node.group = null;
    }

    // 更新组的边界以包含所有节点
    updateBounds(padding = 20) {
        if (this.nodes.size === 0) return;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (let node of this.nodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        }

        this.x = minX - padding;
        this.y = minY - padding - this.titleBarHeight;
        this.width = Math.max(this.minWidth, maxX - minX + padding * 2);
        this.height = Math.max(this.minHeight, maxY - minY + padding * 2 + this.titleBarHeight);
    }
}

// 注释框类

export { NodeGroup };
