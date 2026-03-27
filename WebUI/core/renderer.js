export const rendererMixin = {
requestRender() {
    this.needsRender = true;
},

isNodeInViewport(node) {
    // 计算视口边界（世界坐标）
    const viewLeft = -this.viewOffset.x / this.viewScale;
    const viewTop = -this.viewOffset.y / this.viewScale;
    const viewRight = (this.canvas.width - this.viewOffset.x) / this.viewScale;
    const viewBottom = (this.canvas.height - this.viewOffset.y) / this.viewScale;

    // 添加一些边距以避免边缘闪烁
    const margin = 50;

    // 检查节点是否与视口相交
    return !(node.x + node.width < viewLeft - margin ||
             node.x > viewRight + margin ||
             node.y + node.height < viewTop - margin ||
             node.y > viewBottom + margin);
},

isConnectionInViewport(conn) {
    // 获取连接线的起点和终�?
    let startX, startY, endX, endY;

    // 处理折叠组的情况
    if (conn.fromNode.group && conn.fromNode.group.collapsed) {
        const socket = conn.fromNode.group.outputSockets.find(s => s.connection === conn);
        if (socket) {
            startX = socket.x;
            startY = socket.y;
        } else {
            startX = conn.fromNode.x + conn.fromSocket.x;
            startY = conn.fromNode.y + conn.fromSocket.y;
        }
    } else {
        startX = conn.fromNode.x + conn.fromSocket.x;
        startY = conn.fromNode.y + conn.fromSocket.y;
    }

    if (conn.toNode.group && conn.toNode.group.collapsed) {
        const socket = conn.toNode.group.inputSockets.find(s => s.connection === conn);
        if (socket) {
            endX = socket.x;
            endY = socket.y;
        } else {
            endX = conn.toNode.x + conn.toSocket.x;
            endY = conn.toNode.y + conn.toSocket.y;
        }
    } else {
        endX = conn.toNode.x + conn.toSocket.x;
        endY = conn.toNode.y + conn.toSocket.y;
    }

    // 计算视口边界
    const viewLeft = -this.viewOffset.x / this.viewScale;
    const viewTop = -this.viewOffset.y / this.viewScale;
    const viewRight = (this.canvas.width - this.viewOffset.x) / this.viewScale;
    const viewBottom = (this.canvas.height - this.viewOffset.y) / this.viewScale;

    const margin = 50;

    // 检查连接线的边界框是否与视口相�?
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);

    return !(maxX < viewLeft - margin ||
             minX > viewRight + margin ||
             maxY < viewTop - margin ||
             minY > viewBottom + margin);
},

togglePerformanceMetrics() {
    this.showPerformanceMetrics = !this.showPerformanceMetrics;
    this.requestRender();
},

render() {
    // 性能测量开�?
    const renderStartTime = performance.now();

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 保存当前状�?
    this.ctx.save();

    // 应用视图变换
    this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
    this.ctx.scale(this.viewScale, this.viewScale);

    // Draw grid
    const gridSize = this.gridSize;
    const startX = Math.floor(-this.viewOffset.x / this.viewScale / gridSize) * gridSize;
    const startY = Math.floor(-this.viewOffset.y / this.viewScale / gridSize) * gridSize;
    const endX = Math.ceil((this.canvas.width - this.viewOffset.x) / this.viewScale / gridSize) * gridSize;
    const endY = Math.ceil((this.canvas.height - this.viewOffset.y) / this.viewScale / gridSize) * gridSize;

    // 网格吸附开启时，网格线更明�?
    this.ctx.strokeStyle = this.gridSnap ? '#3d3d3d' : '#2a2a2a';
    this.ctx.lineWidth = 1 / this.viewScale;
    for (let x = startX; x <= endX; x += gridSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, startY);
        this.ctx.lineTo(x, endY);
        this.ctx.stroke();
    }
    for (let y = startY; y <= endY; y += gridSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(startX, y);
        this.ctx.lineTo(endX, y);
        this.ctx.stroke();
    }

    // Draw comments (behind everything) - 使用视口剔除
    let visibleComments = 0;
    this.comments.forEach(comment => {
        // 简单的边界检�?
        if (this.isNodeInViewport(comment)) {
            const isSelected = comment === this.selectedComment;
            comment.draw(this.ctx, isSelected);
            visibleComments++;
        }
    });

    // Draw groups (behind nodes) - 使用视口剔除
    // 先更新折叠组的输入输出接�?
    this.groups.forEach(group => {
        if (group.collapsed) {
            group.updateSockets(this.connections);
        }
    });
    let visibleGroups = 0;
    this.groups.forEach(group => {
        if (this.isNodeInViewport(group)) {
            group.draw(this.ctx);
            visibleGroups++;
        }
    });

    // Draw connections - 使用视口剔除
    let visibleConnections = 0;
    this.connections.forEach(conn => {
        const fromGroup = conn.fromNode.group;
        const toGroup = conn.toNode.group;
        // 折叠组内的内部连线不显示
        if (fromGroup && toGroup && fromGroup === toGroup && fromGroup.collapsed) {
            return;
        }
        // 显示连接线的条件�?
        // 1. 两端节点都可�?
        // 2. 或者至少有一端在折叠的组中（这样可以显示组的输入输出连接�?
        const fromVisible = conn.fromNode.visible || (fromGroup && fromGroup.collapsed);
        const toVisible = conn.toNode.visible || (toGroup && toGroup.collapsed);

        if (fromVisible && toVisible && this.isConnectionInViewport(conn)) {
            conn.draw(this.ctx);
            visibleConnections++;
        }
    });

    // Draw temp connection
    if (this.connectingFrom && this.tempConnection) {
        const startX = this.connectingFrom.node.x + this.connectingFrom.socket.x;
        const startY = this.connectingFrom.node.y + this.connectingFrom.socket.y;

        this.ctx.strokeStyle = '#61dafb';
        this.ctx.lineWidth = 3 / this.viewScale;
        this.ctx.setLineDash([5 / this.viewScale, 5 / this.viewScale]);
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(this.tempConnection.x, this.tempConnection.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    // Draw nodes (only visible ones) - 使用视口剔除
    let visibleNodes = 0;
    this.nodes.forEach(node => {
        if (node.visible && this.isNodeInViewport(node)) {
            const isSelected = this.selectedNodes.has(node);
            node.draw(this.ctx, isSelected);
            visibleNodes++;
        }
    });

    // Draw box selection rectangle
    if (this.isBoxSelecting && this.boxSelectStart && this.boxSelectEnd) {
        const minX = Math.min(this.boxSelectStart.x, this.boxSelectEnd.x);
        const minY = Math.min(this.boxSelectStart.y, this.boxSelectEnd.y);
        const width = Math.abs(this.boxSelectEnd.x - this.boxSelectStart.x);
        const height = Math.abs(this.boxSelectEnd.y - this.boxSelectStart.y);

        this.ctx.strokeStyle = '#61dafb';
        this.ctx.fillStyle = 'rgba(97, 218, 251, 0.1)';
        this.ctx.lineWidth = 2 / this.viewScale;
        this.ctx.setLineDash([5 / this.viewScale, 5 / this.viewScale]);
        this.ctx.fillRect(minX, minY, width, height);
        this.ctx.strokeRect(minX, minY, width, height);
        this.ctx.setLineDash([]);
    }

    // 恢复状�?
    this.ctx.restore();

    // 更新性能指标
    this.performanceMetrics.visibleNodes = visibleNodes;
    this.performanceMetrics.visibleConnections = visibleConnections;
    this.performanceMetrics.totalNodes = this.nodes.length;
    this.performanceMetrics.totalConnections = this.connections.length;
    this.performanceMetrics.renderTime = performance.now() - renderStartTime;

    // 更新FPS
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= this.fpsUpdateInterval) {
        this.performanceMetrics.fps = Math.round(this.frameCount / ((now - this.lastFpsUpdate) / 1000));
        this.frameCount = 0;
        this.lastFpsUpdate = now;
    }

    // 绘制缩放比例指示器和选择计数（在屏幕坐标系）
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '12px Arial';
    let infoY = this.canvas.height - 10;
    this.ctx.fillText(`Zoom: ${(this.viewScale * 100).toFixed(0)}%`, 10, infoY);

    if (this.selectedNodes.size > 0) {
        infoY -= 20;
        this.ctx.fillText(`Selected: ${this.selectedNodes.size}`, 10, infoY);
    }

    // 显示网格吸附状�?
    if (this.gridSnap) {
        infoY -= 20;
        this.ctx.fillStyle = '#61dafb';
        this.ctx.fillText(`Grid Snap: ON (${this.gridSize}px)`, 10, infoY);
    }

    // 显示性能指标
    if (this.showPerformanceMetrics) {
        infoY -= 20;
        this.ctx.fillStyle = '#a9dc76';
        this.ctx.fillText(`FPS: ${this.performanceMetrics.fps}`, 10, infoY);

        infoY -= 20;
        this.ctx.fillText(`Render: ${this.performanceMetrics.renderTime.toFixed(2)}ms`, 10, infoY);

        infoY -= 20;
        this.ctx.fillText(`Nodes: ${this.performanceMetrics.visibleNodes}/${this.performanceMetrics.totalNodes}`, 10, infoY);

        infoY -= 20;
        this.ctx.fillText(`Connections: ${this.performanceMetrics.visibleConnections}/${this.performanceMetrics.totalConnections}`, 10, infoY);

        infoY -= 20;
        const previewBudget = (typeof this.getPreviewBudget === 'function') ? this.getPreviewBudget() : 256;
        this.ctx.fillText(`Paged Limit: ${previewBudget}`, 10, infoY);

        // 计算剔除�?
        const nodeCullRate = this.performanceMetrics.totalNodes > 0
            ? ((1 - this.performanceMetrics.visibleNodes / this.performanceMetrics.totalNodes) * 100).toFixed(1)
            : 0;
        const connCullRate = this.performanceMetrics.totalConnections > 0
            ? ((1 - this.performanceMetrics.visibleConnections / this.performanceMetrics.totalConnections) * 100).toFixed(1)
            : 0;

        infoY -= 20;
        this.ctx.fillText(`Culled: ${nodeCullRate}% nodes, ${connCullRate}% conns`, 10, infoY);
    }

    this.needsRender = false;
},

startRenderLoop() {
    const loop = () => {
        if (this.needsRender) {
            this.render();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
};


