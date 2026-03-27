class ContextMenu {
    constructor(editor) {
        this.editor = editor;
        this.menu = null;
        this.x = 0;
        this.y = 0;
    }

    show(x, y) {
        this.hide();
        this.x = x;
        this.y = y;

        this.menu = document.createElement('div');
        this.menu.className = 'context-menu';
        this.menu.style.left = x + 'px';
        this.menu.style.top = y + 'px';

        // Group nodes by category
        const categories = {};
        for (const nodeType of this.editor.nodeTypes) {
            if (!categories[nodeType.category]) {
                categories[nodeType.category] = [];
            }
            categories[nodeType.category].push(nodeType);
        }

        // Create menu items
        let first = true;
        for (const [category, types] of Object.entries(categories)) {
            if (!first) {
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';
                this.menu.appendChild(separator);
            }
            first = false;

            // Category header
            const header = document.createElement('div');
            header.className = 'context-menu-header';
            header.textContent = category;
            this.menu.appendChild(header);

            // Node types in category
            for (const nodeType of types) {
                const menuItem = document.createElement('div');
                menuItem.className = 'context-menu-item';
                menuItem.innerHTML = `
                    <span class="node-color-indicator" style="background: ${nodeType.color}"></span>
                    ${nodeType.name}
                `;
                menuItem.onclick = () => {
                    this.editor.addNode(nodeType.id, x, y);
                    this.hide();
                };
                this.menu.appendChild(menuItem);
            }
        }

        // Add separator and clear option
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        this.menu.appendChild(separator);

        const clearItem = document.createElement('div');
        clearItem.className = 'context-menu-item';
        clearItem.textContent = 'Clear All';
        clearItem.onclick = () => {
            this.editor.clear();
            this.hide();
        };
        this.menu.appendChild(clearItem);

        document.body.appendChild(this.menu);

        // Close menu when clicking outside
        setTimeout(() => {
            document.addEventListener('click', () => this.hide(), { once: true });
        }, 0);
    }

    hide() {
        if (this.menu) {
            this.menu.remove();
            this.menu = null;
        }
    }
}

// 预览面板类

export { ContextMenu };
