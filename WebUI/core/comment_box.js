class CommentBox {
    constructor(x, y, text = 'Comment', width = 250, height = 100) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.width = width;
        this.height = height;
        this.color = '#ffd700'; // 金色
        this.isDragging = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.fontSize = 14;
        this.padding = 10;
        this.minWidth = 100;
        this.minHeight = 60;
        this.resizeHandleSize = 10;
    }

    draw(ctx, isSelected = false) {
        // 绘制背景
        ctx.fillStyle = this.color + '20'; // 半透明背景
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // 绘制边框
        ctx.strokeStyle = isSelected ? '#ffffff' : this.color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(this.x, this.y, this.width, this.height);
        ctx.setLineDash([]);

        // 绘制文本
        ctx.fillStyle = '#ffffff';
        ctx.font = `${this.fontSize}px Arial`;

        // 文本换行
        const words = this.text.split(/\s+/);
        const lines = [];
        let currentLine = '';
        const maxWidth = this.width - this.padding * 2;

        for (let word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            lines.push(currentLine);
        }

        // 绘制每一行
        const lineHeight = this.fontSize + 4;
        lines.forEach((line, index) => {
            const y = this.y + this.padding + (index + 1) * lineHeight;
            if (y < this.y + this.height - this.padding) {
                ctx.fillText(line, this.x + this.padding, y);
            }
        });

        // 绘制调整大小的控制点（右下角）
        ctx.fillStyle = this.color;
        ctx.fillRect(
            this.x + this.width - this.resizeHandleSize,
            this.y + this.height - this.resizeHandleSize,
            this.resizeHandleSize,
            this.resizeHandleSize
        );
    }

    containsPoint(x, y) {
        return x >= this.x && x <= this.x + this.width &&
               y >= this.y && y <= this.y + this.height;
    }

    containsResizeHandle(x, y) {
        return x >= this.x + this.width - this.resizeHandleSize &&
               x <= this.x + this.width &&
               y >= this.y + this.height - this.resizeHandleSize &&
               y <= this.y + this.height;
    }
}


export { CommentBox };
