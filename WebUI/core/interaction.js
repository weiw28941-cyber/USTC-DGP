import { Connection } from './connection.js';
import { handleDynamicSocketControl } from './dynamic_socket_controls.js';
import { enqueueConnectionGraphChange } from './graph_change_execution.js';

export const interactionMixin = {
getConnectionAt(x, y, threshold = 10) {
    for (let conn of this.connections) {
        const startX = conn.fromNode.x + conn.fromSocket.x;
        const startY = conn.fromNode.y + conn.fromSocket.y;
        const endX = conn.toNode.x + conn.toSocket.x;
        const endY = conn.toNode.y + conn.toSocket.y;

        // 简化的贝塞尔曲线碰撞检测：检查多个采样点
        for (let t = 0; t <= 1; t += 0.05) {
            const cp1x = startX + 100;
            const cp1y = startY;
            const cp2x = endX - 100;
            const cp2y = endY;

            // 贝塞尔曲线公式
            const px = Math.pow(1-t, 3) * startX +
                      3 * Math.pow(1-t, 2) * t * cp1x +
                      3 * (1-t) * Math.pow(t, 2) * cp2x +
                      Math.pow(t, 3) * endX;
            const py = Math.pow(1-t, 3) * startY +
                      3 * Math.pow(1-t, 2) * t * cp1y +
                      3 * (1-t) * Math.pow(t, 2) * cp2y +
                      Math.pow(t, 3) * endY;

            const dist = Math.sqrt(Math.pow(px - x, 2) + Math.pow(py - y, 2));
            if (dist < threshold) {
                return conn;
            }
        }
    }
    return null;
},

updateTooltip(screenX, screenY, worldX, worldY) {
    // 清除之前的超时
    if (this.tooltipTimeout) {
        clearTimeout(this.tooltipTimeout);
        this.tooltipTimeout = null;
    }

    // 检查是否悬停在socket上
    for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (node.visible === false) continue;
        const socket = node.getSocketAt(worldX, worldY);
        if (socket) {
            this.tooltipTimeout = setTimeout(() => {
                const socketType = socket.type === 'input' ? 'Input' : 'Output';
                const valueType = socket.socket?.customType
                    ? `${socket.socket.type} (${socket.socket.customType})`
                    : (socket.socket?.type || 'unknown');
                const tooltipText = `${socketType}: ${socket.socket.label}\nType: ${valueType}`;
                this.showTooltip(screenX, screenY, tooltipText);
            }, 500);
            return;
        }
    }

    // 检查是否悬停在节点上
    for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (node.visible === false) continue;
        if (node.containsTitleLabel(worldX, worldY)) {
            if (node.type === 'geometry_viewer') {
                this.hideTooltip();
                return;
            }
            this.tooltipTimeout = setTimeout(() => {
                const schemaInfo = typeof node.getSchemaInfo === 'function'
                    ? node.getSchemaInfo()
                    : { editableEntries: [], readonlyEntries: [], primaryEntry: null };
                const primary = schemaInfo.primaryEntry
                    ? `${schemaInfo.primaryEntry[0]} (${schemaInfo.primaryEntry[1]?.editor || schemaInfo.primaryEntry[1]?.type || 'edit'})`
                    : 'none';
                const editableList = schemaInfo.editableEntries.length > 0
                    ? `\nEditable Fields: ${schemaInfo.editableEntries.map(([key]) => key).slice(0, 4).join(', ')}`
                    : '';
                const readonlyList = schemaInfo.readonlyEntries.length > 0
                    ? `\nRead-only Fields: ${schemaInfo.readonlyEntries.map(([key]) => key).slice(0, 4).join(', ')}`
                    : '';
                const description = node.config?.description ? `\n${node.config.description}` : '';
                const tooltipText =
                    `${node.config.name}\nCategory: ${node.config.category}` +
                    description +
                    `\nEditable: ${schemaInfo.editableEntries.length}` +
                    `\nRead-only: ${schemaInfo.readonlyEntries.length}` +
                    `\nPrimary Edit: ${primary}` +
                    editableList +
                    readonlyList;
                this.showTooltip(screenX, screenY, tooltipText);
            }, 500);
            return;
        }
    }

    // 没有悬停在任何元素上，隐藏工具提示
    this.hideTooltip();
},

onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 中键进行平移（不再使用Shift+左键，因为Shift用于多选）
    if (e.button === 1) {
        this.isPanning = true;
        this.panStart = {
            x: x - this.viewOffset.x,
            y: y - this.viewOffset.y
        };
        this.canvas.style.cursor = 'grab';
        return;
    }

    if (e.button !== 0) return;

    if (this.previewPanel && typeof this.previewPanel.isVisible === 'function' && this.previewPanel.isVisible()) {
        this.previewPanel.hide();
        this.previewHoldNode = null;
        this.requestRender();
        return;
    }

    // 转换为世界坐标
    const worldX = (x - this.viewOffset.x) / this.viewScale;
    const worldY = (y - this.viewOffset.y) / this.viewScale;

    for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (node.visible === false) continue;
        if (node.controlButtons && this.handleNodeControls(node, worldX, worldY)) {
            return;
        }
    }

    // Alt+点击连接线：断开连接
    if (e.altKey) {
        const connection = this.getConnectionAt(worldX, worldY);
        if (connection) {
            this.saveHistory('Disconnect Connection');
            this.connections = this.connections.filter(c => c !== connection);
            // 清除输入socket的连接引用
            if (connection.toSocket) {
                connection.toSocket.connection = null;
            }
            enqueueConnectionGraphChange(this, [{
                op: 'remove_connection',
                from_node: connection.fromNode.id,
                from_socket: connection.fromSocket.id,
                to_node: connection.toNode.id,
                to_socket: connection.toSocket.id
            }], [connection.toNode]);
            this.requestRender();
            return;
        }
    }

    // 检查是否点击了组
    for (let i = this.groups.length - 1; i >= 0; i--) {
        const group = this.groups[i];

        // 检查是否点击了标题栏（用于折叠/展开）
        if (group.containsTitleBar(worldX, worldY)) {
            // 双击标题栏：折叠/展开
            if (e.detail === 2) {
                group.toggleCollapse();
                this.saveHistory('Toggle Group Collapse');
                this.requestSessionSnapshotSync();
                this.requestRender();
                return;
            }
            // Ctrl+单击标题栏：重命名
            if (e.ctrlKey) {
                const newTitle = prompt('Enter new group name:', group.title);
                if (newTitle && newTitle.trim()) {
                    const trimmedTitle = newTitle.trim();
                    if (trimmedTitle !== group.title) {
                        this.saveHistory('Rename Group');
                        group.title = trimmedTitle;
                        this.requestSessionSnapshotSync();
                    }
                    this.requestRender();
                }
                return;
            }
            // 单击标题栏：开始拖拽组
            group.isDragging = true;
            group.dragOffsetX = worldX - group.x;
            group.dragOffsetY = worldY - group.y;
            this.draggingGroupStart = {x: group.x, y: group.y};
            this.draggingGroup = group;
            return;
        }

        // 检查是否点击了调整大小控制点
        if (group.containsResizeHandle(worldX, worldY)) {
            this.resizingGroup = group;
            this.resizeStart = {x: worldX, y: worldY};
            this.resizeOriginal = {
                width: group.width,
                height: group.collapsed ? group.collapsedHeight : group.height,
                collapsed: group.collapsed
            };
            // 保存组内所有节点的原始位置（只在展开状态需要）
            if (!group.collapsed) {
                this.resizeNodePositions = new Map();
                for (let node of group.nodes) {
                    this.resizeNodePositions.set(node, {x: node.x, y: node.y});
                }
            }
            return;
        }
    }

    // 检查是否点击了注释框
    for (let i = this.comments.length - 1; i >= 0; i--) {
        const comment = this.comments[i];

        // 检查是否点击了调整大小控制点
        if (comment.containsResizeHandle(worldX, worldY)) {
            this.resizingComment = comment;
            this.resizeStart = {x: worldX, y: worldY};
            this.resizeOriginal = {
                width: comment.width,
                height: comment.height
            };
            return;
        }

        // 检查是否点击了注释框
        if (comment.containsPoint(worldX, worldY)) {
            // Ctrl+点击：编辑文本
            if (e.ctrlKey) {
                const newText = prompt('Edit comment:', comment.text);
                if (newText !== null) {
                    comment.text = newText;
                    this.requestRender();
                }
                return;
            }
            // 普通点击：选中并开始拖拽
            this.selectedComment = comment;
            comment.isDragging = true;
            comment.dragOffsetX = worldX - comment.x;
            comment.dragOffsetY = worldY - comment.y;
            this.draggingComment = comment;
            return;
        }
    }

    // 检查是否点击了socket
    for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (node.visible === false) continue;
        const socket = node.getSocketAt(worldX, worldY);
        if (socket) {
            if (socket.type === 'output') {
                // 点击输出socket：开始新连接或重定向现有连接
                this.connectingFrom = socket;
                this.tempConnection = {x: worldX, y: worldY};
                this.redirectingConnection = null;
            } else if (socket.type === 'input') {
                // 点击输入socket：如果有连接，则重定向该连接
                const existingConnection = this.connections.find(c =>
                    c.toNode === socket.node && c.toSocket === socket.socket
                );
                if (existingConnection) {
                    // 开始重定向连接
                    this.connectingFrom = existingConnection.fromNode.outputs.find(
                        s => s === existingConnection.fromSocket
                    ) ? {
                        type: 'output',
                        socket: existingConnection.fromSocket,
                        node: existingConnection.fromNode
                    } : null;

                    if (this.connectingFrom) {
                        this.tempConnection = {x: worldX, y: worldY};
                        this.redirectingConnection = existingConnection;
                        // 临时移除旧连接
                        this.connections = this.connections.filter(c => c !== existingConnection);
                    }
                }
            }
            return;
        }
    }

    // 检查是否点击了节点的预览图标
    for (let i = this.nodes.length - 1; i >= 0; i--) {
        if (this.nodes[i].containsPreviewIcon(worldX, worldY)) {
            e.preventDefault();
            const node = this.nodes[i];
            this.previewHoldNode = node;

            // For interaction_state nodes, check if we need to refresh data
            if (node.type === 'interaction_state') {
                this.refreshInteractionStatePreview(node, e.clientX, e.clientY);
            } else {
                this.previewPanel.show(node, e.clientX, e.clientY);
            }
            return;
        }
    }

    for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (node.containsOpLabel(worldX, worldY)) {
            if (!this.selectedNodes.has(node)) {
                this.selectedNodes.clear();
                this.selectedNodes.add(node);
                this.selectedNode = node;
            }
            this.cycleNodeOperation(node);
            this.requestRender();
            return;
        }
    }


    // 检查是否点击了节点
    let clickedNode = null;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
        if (this.nodes[i].containsPoint(worldX, worldY)) {
            clickedNode = this.nodes[i];
            break;
        }
    }

    if (clickedNode) {
        // Shift+点击：添加/移除选择
        if (e.shiftKey) {
            if (this.selectedNodes.has(clickedNode)) {
                this.selectedNodes.delete(clickedNode);
                this.selectedNode = this.selectedNodes.size > 0 ?
                    Array.from(this.selectedNodes)[0] : null;
            } else {
                this.selectedNodes.add(clickedNode);
                this.selectedNode = clickedNode;
            }
        }
        // Ctrl+点击：切换选择
        else if (e.ctrlKey) {
            if (this.selectedNodes.has(clickedNode)) {
                this.selectedNodes.delete(clickedNode);
                this.selectedNode = this.selectedNodes.size > 0 ?
                    Array.from(this.selectedNodes)[0] : null;
            } else {
                this.selectedNodes.add(clickedNode);
                this.selectedNode = clickedNode;
            }
        }
        // 普通点击：单选
        else {
            // 如果点击的节点已经在选择集中，保持多选状态并开始拖拽
            if (!this.selectedNodes.has(clickedNode)) {
                this.selectedNodes.clear();
                this.selectedNodes.add(clickedNode);
            }
            this.selectedNode = clickedNode;
        }

        // 开始拖拽所有选中的节点
        for (let node of this.selectedNodes) {
            node.isDragging = true;
            node.dragOffsetX = worldX - node.x;
            node.dragOffsetY = worldY - node.y;
        }
        this.requestRender();
        return;
    }

    // 点击空白处：开始框选或清除选择
    if (!e.shiftKey && !e.ctrlKey) {
        this.selectedNodes.clear();
        this.selectedNode = null;
        this.selectedComment = null; // 取消选中注释框
    }

    // 开始框选
    this.isBoxSelecting = true;
    this.boxSelectStart = {x: worldX, y: worldY};
    this.boxSelectEnd = {x: worldX, y: worldY};
    this.requestRender();
},

onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 转换为世界坐标
    const worldX = (x - this.viewOffset.x) / this.viewScale;
    const worldY = (y - this.viewOffset.y) / this.viewScale;

    if (this.isPanning) {
        // 平移视图
        this.viewOffset.x = x - this.panStart.x;
        this.viewOffset.y = y - this.panStart.y;
        this.hideTooltip();
        this.requestRender();
    } else if (this.draggingComment) {
        // 拖拽注释框
        const comment = this.draggingComment;
        comment.x = worldX - comment.dragOffsetX;
        comment.y = worldY - comment.dragOffsetY;
        this.hideTooltip();
        this.requestRender();
    } else if (this.resizingComment) {
        // 调整注释框大小
        const comment = this.resizingComment;
        const deltaX = worldX - this.resizeStart.x;
        const deltaY = worldY - this.resizeStart.y;
        comment.width = Math.max(comment.minWidth, this.resizeOriginal.width + deltaX);
        comment.height = Math.max(comment.minHeight, this.resizeOriginal.height + deltaY);
        this.hideTooltip();
        this.requestRender();
    } else if (this.draggingGroup) {
        // 拖拽组
        const group = this.draggingGroup;
        const newX = worldX - group.dragOffsetX;
        const newY = worldY - group.dragOffsetY;
        const deltaX = newX - group.x;
        const deltaY = newY - group.y;

        group.x = newX;
        group.y = newY;

        // 移动组内的所有节点（包括隐藏的节点）
        if (group.collapsed) {
            // 如果组是折叠的，节点位置会在展开时根据偏移量自动计算
            // 但我们仍然需要更新隐藏节点的实际位置，以便其他操作正常工作
            for (let node of group.nodes) {
                node.x += deltaX;
                node.y += deltaY;
            }
        } else {
            // 如果组是展开的，直接移动所有可见节点
            for (let node of group.nodes) {
                node.x += deltaX;
                node.y += deltaY;
            }
        }

        this.hideTooltip();
        this.requestRender();
    } else if (this.resizingGroup) {
        // 调整组大小
        const group = this.resizingGroup;
        const deltaX = worldX - this.resizeStart.x;
        const deltaY = worldY - this.resizeStart.y;

        if (group.collapsed) {
            // 折叠状态：只调整折叠尺寸，不影响节点
            const minWidth = group.minCollapsedWidth;
            const minHeight = group.minCollapsedHeight;
            group.width = Math.max(minWidth, this.resizeOriginal.width + deltaX);
            group.collapsedHeight = Math.max(minHeight, this.resizeOriginal.height + deltaY);
            // 保持折叠尺寸记录同步，便于撤销/重做与展开/折叠切换
            group.collapsedWidth = group.width;
        } else {
            // 展开状态：调整展开尺寸并缩放节点
            const newWidth = Math.max(group.minWidth, this.resizeOriginal.width + deltaX);
            const newHeight = Math.max(group.minHeight, this.resizeOriginal.height + deltaY);

            // 计算缩放比例
            const scaleX = newWidth / this.resizeOriginal.width;
            const scaleY = newHeight / this.resizeOriginal.height;

            // 更新组内节点的位置（按比例缩放）
            for (let node of group.nodes) {
                if (node.visible) {
                    // 计算节点相对于组的原始偏移量
                    const originalOffsetX = this.resizeNodePositions.get(node).x - group.x;
                    const originalOffsetY = this.resizeNodePositions.get(node).y - group.y;

                    // 应用缩放
                    node.x = group.x + originalOffsetX * scaleX;
                    node.y = group.y + originalOffsetY * scaleY;
                }
            }

            group.width = newWidth;
            group.height = newHeight;
            // 保持展开尺寸记录同步，便于撤销/重做与折叠/展开切换
            group.expandedWidth = newWidth;
            group.expandedHeight = newHeight;
        }

        this.hideTooltip();
        this.requestRender();
    } else if (this.isBoxSelecting) {
        // 更新框选区域
        this.boxSelectEnd = {x: worldX, y: worldY};
        this.hideTooltip();
        this.requestRender();
    } else if (this.connectingFrom) {
        this.tempConnection = {x: worldX, y: worldY};
        this.hideTooltip();
        this.requestRender();
    } else if (this.selectedNodes.size > 0) {
        // 拖拽所有选中的节点
        let isDragging = false;
        for (let node of this.selectedNodes) {
            if (node.isDragging) {
                isDragging = true;
                node.x = worldX - node.dragOffsetX;
                node.y = worldY - node.dragOffsetY;
            }
        }
        if (isDragging) {
            this.hideTooltip();
            this.requestRender();
        } else {
            // 不在拖拽时，检查是否悬停在节点或socket上
            this.updateTooltip(e.clientX, e.clientY, worldX, worldY);
        }
    } else {
        // 检查是否悬停在节点或socket上
        this.updateTooltip(e.clientX, e.clientY, worldX, worldY);
    }
},

onMouseUp(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 停止平移
    if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = 'default';
        return;
    }


    // 停止注释框拖拽
    if (this.previewHoldNode) {
        this.previewHoldNode = null;
        this.previewPanel.hide();
        return;
    }

    if (this.draggingComment) {
        this.draggingComment.isDragging = false;
        this.draggingComment = null;
        this.saveHistory('Move Comment');
        this.requestSessionSnapshotSync();
        return;
    }

    // 停止注释框调整大小
    if (this.resizingComment) {
        this.resizingComment = null;
        this.resizeStart = null;
        this.resizeOriginal = null;
        this.saveHistory('Resize Comment');
        this.requestSessionSnapshotSync();
        return;
    }

    // 停止组拖拽
    if (this.draggingGroup) {
        const group = this.draggingGroup;
        const startPos = this.draggingGroupStart;
        if (startPos && (group.x != startPos.x || group.y != startPos.y)) {
            this.saveHistory('Move Group');
            this.requestSessionSnapshotSync();
        }
        this.draggingGroupStart = null;
        this.draggingGroup.isDragging = false;
        this.draggingGroup = null;
        return;
    }

    // ???????
    if (this.resizingGroup) {
        const group = this.resizingGroup;
        const original = this.resizeOriginal;
        if (original) {
            const currentHeight = group.collapsed ? group.collapsedHeight : group.height;
            if (group.width != original.width || currentHeight != original.height) {
                this.saveHistory('Resize Group');
                this.requestSessionSnapshotSync();
            }
        }
        this.resizingGroup = null;
        this.resizeStart = null;
        this.resizeOriginal = null;
        this.resizeNodePositions = null;
        return;
    }

    // 转换为世界坐标
    const worldX = (x - this.viewOffset.x) / this.viewScale;
    const worldY = (y - this.viewOffset.y) / this.viewScale;

    // 完成框选
    if (this.isBoxSelecting) {
        this.isBoxSelecting = false;

        // 计算框选区域
        const minX = Math.min(this.boxSelectStart.x, this.boxSelectEnd.x);
        const maxX = Math.max(this.boxSelectStart.x, this.boxSelectEnd.x);
        const minY = Math.min(this.boxSelectStart.y, this.boxSelectEnd.y);
        const maxY = Math.max(this.boxSelectStart.y, this.boxSelectEnd.y);

        // 选择框选区域内的所有节点
        if (!e.shiftKey && !e.ctrlKey) {
            this.selectedNodes.clear();
        }

        for (let node of this.nodes) {
            const nodeMinX = node.x;
            const nodeMaxX = node.x + node.width;
            const nodeMinY = node.y;
            const nodeMaxY = node.y + node.height;

            // 检查节点是否与框选区域相交
            if (nodeMaxX >= minX && nodeMinX <= maxX &&
                nodeMaxY >= minY && nodeMinY <= maxY) {
                if (e.ctrlKey && this.selectedNodes.has(node)) {
                    // Ctrl+框选：切换选择
                    this.selectedNodes.delete(node);
                } else {
                    this.selectedNodes.add(node);
                }
            }
        }

        this.selectedNode = this.selectedNodes.size > 0 ?
            Array.from(this.selectedNodes)[0] : null;

        this.boxSelectStart = null;
        this.boxSelectEnd = null;
        this.requestRender();
        return;
    }

    // 完成连接或重定向
    if (this.connectingFrom) {
        let connectionMade = false;
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            if (node.visible === false) continue;
            const socket = node.getSocketAt(worldX, worldY);
            if (socket && socket.type === 'input' && socket.node !== this.connectingFrom.node) {
                // 保存历史记录
                if (this.redirectingConnection) {
                    this.saveHistory('Redirect Connection');
                } else {
                    this.saveHistory('Add Connection');
                }

                // 移除目标socket上的现有连接
                const removedConnections = this.connections.filter(c =>
                    (c.toNode === socket.node && c.toSocket === socket.socket)
                );
                this.connections = this.connections.filter(c =>
                    !(c.toNode === socket.node && c.toSocket === socket.socket)
                );

                const conn = new Connection(
                    this.connectingFrom.node,
                    this.connectingFrom.socket,
                    socket.node,
                    socket.socket
                );
                this.connections.push(conn);
                socket.socket.connection = conn;
                connectionMade = true;
                const patches = [];
                if (this.redirectingConnection) {
                    patches.push({
                        op: 'remove_connection',
                        from_node: this.redirectingConnection.fromNode.id,
                        from_socket: this.redirectingConnection.fromSocket.id,
                        to_node: this.redirectingConnection.toNode.id,
                        to_socket: this.redirectingConnection.toSocket.id
                    });
                }
                for (const removed of removedConnections) {
                    patches.push({
                        op: 'remove_connection',
                        from_node: removed.fromNode.id,
                        from_socket: removed.fromSocket.id,
                        to_node: removed.toNode.id,
                        to_socket: removed.toSocket.id
                    });
                }
                patches.push({
                    op: 'add_connection',
                    from_node: conn.fromNode.id,
                    from_socket: conn.fromSocket.id,
                    to_node: conn.toNode.id,
                    to_socket: conn.toSocket.id
                });
                enqueueConnectionGraphChange(
                    this,
                    patches,
                    [
                        conn.toNode,
                        ...removedConnections.map((removed) => removed.toNode),
                        ...(this.redirectingConnection ? [this.redirectingConnection.toNode] : [])
                    ]
                );
                break;
            }
        }

        // 如果重定向失败，恢复原连接
        if (!connectionMade && this.redirectingConnection) {
            this.connections.push(this.redirectingConnection);
        }

        this.connectingFrom = null;
        this.tempConnection = null;
        this.redirectingConnection = null;
    }

    // 停止拖拽
    let wasDragging = false;
    for (let node of this.selectedNodes) {
        if (node.isDragging) {
            wasDragging = true;
            node.isDragging = false;
            // 应用网格吸附
            if (this.gridSnap) {
                node.x = this.snapToGrid(node.x);
                node.y = this.snapToGrid(node.y);
            }
        }
    }

    // 如果拖拽了节点，保存历史记录并更新所属组的边界
    if (wasDragging) {
        // 更新被移动节点所属组的边界
        const affectedGroups = new Set();
        for (let node of this.selectedNodes) {
            if (node.group && !node.group.collapsed) {
                affectedGroups.add(node.group);
            }
        }
        for (let group of affectedGroups) {
            group.updateBounds();
        }

        this.saveHistory(`Move ${this.selectedNodes.size} Node(s)`);
        const movePatches = [];
        for (let node of this.selectedNodes) {
            movePatches.push({
                op: 'move_node',
                nodeId: node.id,
                x: node.x,
                y: node.y
            });
        }
        this.enqueueSessionOnlyPatches(movePatches);
    }

    this.requestRender();
},

onWheel(e) {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 计算缩放前的世界坐标
    const worldX = (mouseX - this.viewOffset.x) / this.viewScale;
    const worldY = (mouseY - this.viewOffset.y) / this.viewScale;

    // 缩放因子
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.viewScale * zoomFactor));

    // 更新缩放
    this.viewScale = newScale;

    // 调整偏移以保持鼠标位置不变
    this.viewOffset.x = mouseX - worldX * this.viewScale;
    this.viewOffset.y = mouseY - worldY * this.viewScale;

    this.requestRender();
},

onDoubleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 转换为世界坐标
    const worldX = (x - this.viewOffset.x) / this.viewScale;
    const worldY = (y - this.viewOffset.y) / this.viewScale;

    for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (node.visible === false) continue;
        if (node.containsPoint(worldX, worldY)) {
            this.selectedNodes.clear();
            this.selectedNodes.add(node);
            this.selectedNode = node;
            if (this.openMeshViewer(node)) {
                this.requestRender();
                return;
            }
            if (this.canDoubleClickEditNode(node)) {
                this.editNode(node);
            }
            this.requestRender();
            break;
        }
    }
},

handleNodeControls(node, worldX, worldY) {
    return handleDynamicSocketControl(this, node, worldX, worldY);
},

clearNodeInputConnections(node) {
    const toRemove = new Set();
    for (const input of node.inputs) {
        if (input.connection) {
            toRemove.add(input.connection);
        }
    }
    if (toRemove.size === 0) return;
    this.connections = this.connections.filter(conn => !toRemove.has(conn));
    for (const conn of toRemove) {
        if (conn.toSocket) {
            conn.toSocket.connection = null;
        }
    }
},

pointInCircle(x, y, circle) {
    const dx = x - circle.cx;
    const dy = y - circle.cy;
    return (dx * dx + dy * dy) <= (circle.r * circle.r);
}
};
