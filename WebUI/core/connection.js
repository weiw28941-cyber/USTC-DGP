class Connection {
    constructor(fromNode, fromSocket, toNode, toSocket) {
        this.fromNode = fromNode;
        this.fromSocket = fromSocket;
        this.toNode = toNode;
        this.toSocket = toSocket;
        this.success = true;
        this.errorMessage = '';
        this.fromNodeName = '';
        this.toNodeName = '';
        this.fromSocketIndex = -1;
        this.toSocketIndex = -1;
    }

    draw(ctx) {
        let startX = this.fromNode.x + this.fromSocket.x;
        let startY = this.fromNode.y + this.fromSocket.y;
        let endX = this.toNode.x + this.toSocket.x;
        let endY = this.toNode.y + this.toSocket.y;

        // 检查节点是否在折叠的组中
        if (this.fromNode.group && this.fromNode.group.collapsed) {
            // 起点在折叠的组中，使用组的输出接口位置
            const socket = this.fromNode.group.outputSockets.find(s => s.connection === this);
            if (socket) {
                startX = socket.x;
                startY = socket.y;
            }
        }

        if (this.toNode.group && this.toNode.group.collapsed) {
            // 终点在折叠的组中，使用组的输入接口位置
            const socket = this.toNode.group.inputSockets.find(s => s.connection === this);
            if (socket) {
                endX = socket.x;
                endY = socket.y;
            }
        }

        // Color based on success status
        ctx.strokeStyle = this.success ? '#61dafb' : '#e74c3c';
        ctx.lineWidth = this.success ? 3 : 4;
        if (!this.success) {
            ctx.setLineDash([6, 6]);
        }
        ctx.beginPath();
        ctx.moveTo(startX, startY);

        const cp1x = startX + 100;
        const cp1y = startY;
        const cp2x = endX - 100;
        const cp2y = endY;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
        ctx.stroke();
        if (!this.success) {
            ctx.setLineDash([]);
        }
    }
}


export { Connection };
