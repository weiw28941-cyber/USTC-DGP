class EditableHelpPanel {
    constructor(editor) {
        this.editor = editor;
        this.panel = null;
    }

    show() {
        this.editor.isEditingShortcuts = true;
        this.panel = document.createElement('div');
        this.panel.className = 'help-panel';
        this.panel.innerHTML = `
            <div class="help-panel-header">
                <h3>Keyboard Shortcuts & Help</h3>
                <div class="help-shortcut-actions">
                    <button class="help-shortcut-apply">Apply</button>
                    <button class="help-shortcut-reset">Reset</button>
                </div>
                <button class="help-panel-close">×</button>
            </div>
            <div class="help-panel-content"></div>
        `;

        document.body.appendChild(this.panel);
        this.renderContent();

        this.panel.querySelector('.help-panel-close').onclick = () => {
            this.close();
        };

        this.panel.querySelector('.help-shortcut-apply').onclick = () => {
            this.applyEdits();
        };

        this.panel.querySelector('.help-shortcut-reset').onclick = () => {
            this.editor.resetShortcutsToDefault();
            this.renderContent();
        };

        setTimeout(() => {
            document.addEventListener('click', this.outsideClickHandler = (e) => {
                if (this.panel && !this.panel.contains(e.target)) {
                    this.close();
                }
            });
        }, 0);
    }

    renderContent() {
        const content = this.panel.querySelector('.help-panel-content');
        content.innerHTML = '';

        const config = this.editor.getShortcutConfig();
        if (!config || !Array.isArray(config.sections)) {
            content.textContent = 'Shortcuts are loading...';
            return;
        }

        for (const section of config.sections) {
            const sectionEl = document.createElement('div');
            sectionEl.className = 'help-section';

            const title = document.createElement('h4');
            title.textContent = section.title;
            sectionEl.appendChild(title);

            for (const item of section.items) {
                const itemEl = document.createElement('div');
                itemEl.className = 'help-item';

                const keyEl = document.createElement('span');
                keyEl.className = 'help-key';

                if (item.editable && Array.isArray(item.keys)) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'help-key-input';
                    input.value = item.keys.join(', ');
                    input.setAttribute('data-action-id', item.id || '');
                    input.setAttribute('placeholder', 'Shortcut');
                    input.style.width = '160px';
                    keyEl.appendChild(input);
                } else {
                    keyEl.textContent = item.display || this.editor.formatShortcutKeys(item.keys);
                }

                const descEl = document.createElement('span');
                descEl.className = 'help-desc';
                descEl.textContent = item.desc || '';

                itemEl.appendChild(keyEl);
                itemEl.appendChild(descEl);
                sectionEl.appendChild(itemEl);
            }

            content.appendChild(sectionEl);
        }

        const infoSection = document.createElement('div');
        infoSection.className = 'help-section';
        infoSection.innerHTML = `
            <h4>Template Storage</h4>
            <div class="help-info">
                Templates are saved in browser localStorage at:<br>
                <code>localStorage['nodeTemplates']</code><br><br>
                <strong>Note:</strong> Clearing browser data will delete templates.
            </div>
        `;
        content.appendChild(infoSection);
    }

    applyEdits() {
        const inputs = this.panel.querySelectorAll('.help-key-input');
        const updates = {};

        inputs.forEach(input => {
            const actionId = input.getAttribute('data-action-id');
            if (!actionId) return;
            updates[actionId] = this.editor.parseShortcutInput(input.value);
        });

        this.editor.applyShortcutUpdates(updates);
        this.renderContent();
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
        this.editor.saveShortcutsToServer();
    }

    close() {
        this.editor.isEditingShortcuts = false;
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


export { EditableHelpPanel };
