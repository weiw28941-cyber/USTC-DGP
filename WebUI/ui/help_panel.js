class HelpPanel {
    constructor() {
        this.panel = null;
    }

    show() {
        // 创建面板容器
        this.panel = document.createElement('div');
        this.panel.className = 'help-panel';
        this.panel.innerHTML = `
            <div class="help-panel-header">
                <h3>Keyboard Shortcuts & Help</h3>
                <button class="help-panel-close">×</button>
            </div>
            <div class="help-panel-content">
                <div class="help-section">
                    <h4>Basic Operations</h4>
                    <div class="help-item">
                        <span class="help-key">Right-click / Shift+A</span>
                        <span class="help-desc">Open search menu to add nodes</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Double-click node</span>
                        <span class="help-desc">Edit node values</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Drag</span>
                        <span class="help-desc">Connect nodes, move nodes</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Middle-click drag</span>
                        <span class="help-desc">Pan view</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Mouse wheel</span>
                        <span class="help-desc">Zoom in/out</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Selection</h4>
                    <div class="help-item">
                        <span class="help-key">Shift+Click</span>
                        <span class="help-desc">Add to selection</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Click</span>
                        <span class="help-desc">Toggle selection</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Drag empty space</span>
                        <span class="help-desc">Box select</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">A</span>
                        <span class="help-desc">Select all</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Escape</span>
                        <span class="help-desc">Deselect all</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+I</span>
                        <span class="help-desc">Invert selection</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Editing</h4>
                    <div class="help-item">
                        <span class="help-key">Delete / X</span>
                        <span class="help-desc">Delete selected nodes</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+C</span>
                        <span class="help-desc">Copy</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+X</span>
                        <span class="help-desc">Cut</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+V</span>
                        <span class="help-desc">Paste</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Shift+D</span>
                        <span class="help-desc">Duplicate (Blender style)</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Z</span>
                        <span class="help-desc">Undo</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Shift+Z / Ctrl+Y</span>
                        <span class="help-desc">Redo</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>View</h4>
                    <div class="help-item">
                        <span class="help-key">Home</span>
                        <span class="help-desc">Frame all nodes</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">F</span>
                        <span class="help-desc">Frame selected node</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">R</span>
                        <span class="help-desc">Reset view</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">G</span>
                        <span class="help-desc">Toggle grid snap</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">P</span>
                        <span class="help-desc">Toggle node preview</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Alignment</h4>
                    <div class="help-item">
                        <span class="help-key">Shift+Arrow keys</span>
                        <span class="help-desc">Align nodes (left/right/top/bottom)</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+H</span>
                        <span class="help-desc">Horizontal center align</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+V</span>
                        <span class="help-desc">Vertical center align</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+D</span>
                        <span class="help-desc">Distribute horizontally</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+E</span>
                        <span class="help-desc">Distribute vertically</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Node Groups</h4>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Shift+G</span>
                        <span class="help-desc">Create node group</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+G</span>
                        <span class="help-desc">Ungroup nodes</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Double-click group title</span>
                        <span class="help-desc">Collapse/expand group</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Click group title</span>
                        <span class="help-desc">Rename group</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Comments</h4>
                    <div class="help-item">
                        <span class="help-key">Shift+C</span>
                        <span class="help-desc">Create comment box</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Click comment</span>
                        <span class="help-desc">Edit comment text</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Template Library</h4>
                    <div class="help-item">
                        <span class="help-key">Ctrl+M</span>
                        <span class="help-desc">Save selected nodes as template</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+M</span>
                        <span class="help-desc">Open template library</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Performance</h4>
                    <div class="help-item">
                        <span class="help-key">Ctrl+Shift+P</span>
                        <span class="help-desc">Toggle performance metrics</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Connections</h4>
                    <div class="help-item">
                        <span class="help-key">Click input socket</span>
                        <span class="help-desc">Redirect connection</span>
                    </div>
                    <div class="help-item">
                        <span class="help-key">Alt+Click connection</span>
                        <span class="help-desc">Disconnect</span>
                    </div>
                </div>

                <div class="help-section">
                    <h4>Template Storage</h4>
                    <div class="help-info">
                        Templates are saved in browser localStorage at:<br>
                        <code>localStorage['nodeTemplates']</code><br><br>
                        <strong>Note:</strong> Clearing browser data will delete templates.
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.panel);

        // 绑定关闭按钮
        this.panel.querySelector('.help-panel-close').onclick = () => {
            this.close();
        };

        // 点击面板外部关闭
        setTimeout(() => {
            document.addEventListener('click', this.outsideClickHandler = (e) => {
                if (this.panel && !this.panel.contains(e.target)) {
                    this.close();
                }
            });
        }, 0);
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
    }
}


export { HelpPanel };
