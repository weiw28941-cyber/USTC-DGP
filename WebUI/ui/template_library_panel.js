class TemplateLibraryPanel {
    constructor(editor) {
        this.editor = editor;
        this.panel = null;
    }

    show() {
        // 创建面板容器
        this.panel = document.createElement('div');
        this.panel.className = 'template-library-panel';
        this.panel.innerHTML = `
            <div class="template-library-header">
                <h3>Template Library</h3>
                <button class="template-library-close">×</button>
            </div>
            <div class="template-library-content">
                <div class="template-library-list"></div>
            </div>
        `;

        document.body.appendChild(this.panel);

        // 绑定关闭按钮
        this.panel.querySelector('.template-library-close').onclick = () => {
            this.close();
        };

        // 刷新模板列表
        this.refresh();

        // 点击面板外部关闭
        setTimeout(() => {
            document.addEventListener('click', this.outsideClickHandler = (e) => {
                if (this.panel && !this.panel.contains(e.target)) {
                    this.close();
                }
            });
        }, 0);
    }

    refresh() {
        if (!this.panel) return;

        const listContainer = this.panel.querySelector('.template-library-list');
        listContainer.innerHTML = '';

        if (this.editor.templates.length === 0) {
            listContainer.innerHTML = `
                <div class="template-library-empty">
                    <p>No templates saved yet.</p>
                    <p>Select nodes and press Ctrl+M to save a template.</p>
                </div>
            `;
            return;
        }

        // 显示所有模板
        for (let template of this.editor.templates) {
            const item = document.createElement('div');
            item.className = 'template-library-item';

            const date = new Date(template.createdAt);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();

            item.innerHTML = `
                <div class="template-library-item-header">
                    <span class="template-library-item-name">${template.name}</span>
                    <div class="template-library-item-actions">
                        <button class="template-library-btn template-library-btn-rename" title="Rename">✏️</button>
                        <button class="template-library-btn template-library-btn-delete" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="template-library-item-info">
                    <span>${template.nodes.length} nodes, ${template.connections.length} connections</span>
                    <span class="template-library-item-date">${dateStr}</span>
                </div>
            `;

            // 点击模板项插入模板
            item.querySelector('.template-library-item-header .template-library-item-name').onclick = () => {
                this.editor.insertTemplate(template);
                this.close();
            };

            // 重命名按钮
            item.querySelector('.template-library-btn-rename').onclick = (e) => {
                e.stopPropagation();
                this.editor.renameTemplate(template.id);
            };

            // 删除按钮
            item.querySelector('.template-library-btn-delete').onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Delete template "${template.name}"?`)) {
                    this.editor.deleteTemplate(template.id);
                }
            };

            listContainer.appendChild(item);
        }
    }

    close() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        this.editor.templateLibraryPanel = null;
    }
}

// Help 面板类

export { TemplateLibraryPanel };
