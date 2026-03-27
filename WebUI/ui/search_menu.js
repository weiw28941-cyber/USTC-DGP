class SearchMenu {
    constructor(editor) {
        this.editor = editor;
        this.menu = null;
        this.input = null;
        this.resultsList = null;
        this.x = 0;
        this.y = 0;
        this.selectedIndex = 0;
        this.filteredNodes = [];
        this.displayNodes = [];
        this.keyboardNavActive = false;
    }

    show(x, y) {
        this.hide();
        this.x = x;
        this.y = y;
        this.selectedIndex = 0;
        this.keyboardNavActive = false;

        this.menu = document.createElement('div');
        this.menu.className = 'search-menu';
        this.menu.style.left = x + 'px';
        this.menu.style.top = y + 'px';

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'search-input';
        this.input.placeholder = 'Search nodes... (type to filter)';
        this.input.addEventListener('input', () => this.updateResults());
        this.input.addEventListener('keydown', (e) => this.onKeyDown(e));

        this.menu.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        this.resultsList = document.createElement('div');
        this.resultsList.className = 'search-results';

        this.menu.appendChild(this.input);
        this.menu.appendChild(this.resultsList);
        document.body.appendChild(this.menu);

        this.updateResults();
        this.adjustPosition();

        setTimeout(() => {
            if (this.input) this.input.focus();
        }, 10);

        setTimeout(() => {
            const closeHandler = (e) => {
                if (this.menu && !this.menu.contains(e.target)) {
                    this.hide();
                    document.removeEventListener('mousedown', closeHandler);
                }
            };
            document.addEventListener('mousedown', closeHandler);
        }, 100);
    }

    updateResults() {
        const query = this.input.value.toLowerCase().trim();
        this.resultsList.innerHTML = '';
        this.selectedIndex = 0;
        this.displayNodes = [];

        this.filteredNodes = this.editor.nodeTypes.filter(nodeType => {
            const nameMatch = nodeType.name.toLowerCase().includes(query);
            const categoryMatch = nodeType.category.toLowerCase().includes(query);
            return nameMatch || categoryMatch;
        });

        const categories = {};
        for (const nodeType of this.filteredNodes) {
            if (!categories[nodeType.category]) categories[nodeType.category] = [];
            categories[nodeType.category].push(nodeType);
        }

        let itemIndex = 0;
        let first = true;
        for (const [category, types] of Object.entries(categories)) {
            if (!first) {
                const separator = document.createElement('div');
                separator.className = 'search-separator';
                this.resultsList.appendChild(separator);
            }
            first = false;

            const header = document.createElement('div');
            header.className = 'search-category-header';
            header.textContent = category;
            this.resultsList.appendChild(header);

            for (const nodeType of types) {
                const currentIndex = itemIndex;
                const item = document.createElement('div');
                item.className = 'search-item';
                item.dataset.index = currentIndex;
                item.innerHTML = `
                    <span class="node-color-indicator" style="background: ${nodeType.color}"></span>
                    <span class="search-item-name">${nodeType.name}</span>
                    <span class="search-item-category">${nodeType.category}</span>
                `;

                item.onclick = () => this.selectNode(nodeType);
                item.onmouseenter = () => {
                    // Keep keyboard selection priority over hover selection.
                    if (this.keyboardNavActive) return;
                    this.selectedIndex = currentIndex;
                    this.highlightSelected();
                };

                this.resultsList.appendChild(item);
                this.displayNodes.push(nodeType);
                itemIndex++;
            }
        }

        if (this.filteredNodes.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'search-no-results';
            noResults.textContent = 'No nodes found';
            this.resultsList.appendChild(noResults);
        }

        this.highlightSelected();
        this.adjustPosition();
    }

    highlightSelected() {
        const items = this.resultsList.querySelectorAll('.search-item');
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
            return;
        }

        const itemCount = this.displayNodes.length;
        if (itemCount <= 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.keyboardNavActive = true;
            this.selectedIndex = (this.selectedIndex + 1) % itemCount;
            this.highlightSelected();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.keyboardNavActive = true;
            this.selectedIndex = (this.selectedIndex - 1 + itemCount) % itemCount;
            this.highlightSelected();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.selectNode(this.displayNodes[this.selectedIndex]);
        }
    }

    selectNode(nodeType) {
        this.editor.addNode(nodeType.id, this.x, this.y);
        this.hide();
    }

    adjustPosition() {
        if (!this.menu) return;

        const margin = 10;
        const rect = this.menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = Number.parseInt(this.menu.style.left, 10);
        let top = Number.parseInt(this.menu.style.top, 10);

        if (!Number.isFinite(left)) left = margin;
        if (!Number.isFinite(top)) top = margin;

        if (rect.right > viewportWidth - margin) {
            left = Math.max(margin, viewportWidth - rect.width - margin);
        }
        if (rect.bottom > viewportHeight - margin) {
            top = Math.max(margin, viewportHeight - rect.height - margin);
        }

        this.menu.style.left = `${left}px`;
        this.menu.style.top = `${top}px`;
    }

    hide() {
        if (this.menu) {
            this.menu.remove();
            this.menu = null;
            this.input = null;
            this.resultsList = null;
        }
    }
}

export { SearchMenu };
