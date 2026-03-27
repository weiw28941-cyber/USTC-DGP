class ColorbarEditor {
    constructor(options = {}) {
        this.onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
        this.stops = Array.isArray(options.stops) && options.stops.length >= 2
            ? this.normalizeStops(options.stops)
            : this.normalizeStops([
                { position: 0.0, color: '#2c7bb6' },
                { position: 0.5, color: '#ffffbf' },
                { position: 1.0, color: '#d7191c' }
            ]);
        this.dragIndex = -1;
        this.handleRadius = 7;

        this.root = document.createElement('div');
        this.root.className = 'colorbar-editor';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'colorbar-canvas';
        this.canvas.width = 320;
        this.canvas.height = 40;
        this.root.appendChild(this.canvas);

        this.help = document.createElement('div');
        this.help.className = 'colorbar-help';
        this.help.textContent = 'Click add/edit, right-click delete';
        this.root.appendChild(this.help);

        this.colorInput = document.createElement('input');
        this.colorInput.type = 'color';
        this.colorInput.className = 'colorbar-picker';
        this.root.appendChild(this.colorInput);

        this.bindEvents();
        this.render();
    }

    getElement() {
        return this.root;
    }

    setVisible(visible) {
        this.root.style.display = visible ? 'block' : 'none';
        if (!visible) return;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => this.render());
            return;
        }
        this.render();
    }

    getStops() {
        return this.stops.map(s => ({ position: s.position, color: s.color }));
    }

    setStops(stops) {
        if (!Array.isArray(stops) || stops.length < 2) return;
        this.stops = this.normalizeStops(stops);
        this.render();
        this.onChange(this.getStops());
    }

    bindEvents() {
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => {
            this.dragIndex = -1;
        });
        this.colorInput.addEventListener('input', () => {
            const idx = Number.parseInt(this.colorInput.dataset.index || '-1', 10);
            if (!Number.isFinite(idx) || idx < 0 || idx >= this.stops.length) return;
            this.stops[idx].color = this.colorInput.value;
            this.render();
            this.onChange(this.getStops());
        });
    }

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1;
        const scaleY = rect.height > 0 ? (this.canvas.height / rect.height) : 1;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const idx = this.findHandleIndex(x, y);
        if (e.button === 2) {
            if (idx > 0 && idx < this.stops.length - 1) {
                this.stops.splice(idx, 1);
                this.render();
                this.onChange(this.getStops());
            }
            return;
        }
        if (idx >= 0) {
            this.dragIndex = idx;
            this.openColorPicker(idx);
            return;
        }
        const pos = this.xToPos(x);
        const color = this.sampleColor(pos);
        this.stops.push({ position: pos, color });
        this.stops = this.normalizeStops(this.stops);
        const nextIdx = this.findClosestStop(pos);
        this.dragIndex = nextIdx;
        this.render();
        this.openColorPicker(nextIdx);
        this.onChange(this.getStops());
    }

    onMouseMove(e) {
        if (this.dragIndex <= 0 || this.dragIndex >= this.stops.length - 1) return;
        if ((e.buttons & 1) === 0) return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1;
        const x = (e.clientX - rect.left) * scaleX;
        const left = this.stops[this.dragIndex - 1].position + 0.001;
        const right = this.stops[this.dragIndex + 1].position - 0.001;
        this.stops[this.dragIndex].position = Math.max(left, Math.min(right, this.xToPos(x)));
        this.render();
        this.onChange(this.getStops());
    }

    openColorPicker(index) {
        this.colorInput.dataset.index = String(index);
        this.colorInput.value = this.stops[index].color;
        this.colorInput.click();
    }

    findClosestStop(pos) {
        let best = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < this.stops.length; i++) {
            const d = Math.abs(this.stops[i].position - pos);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
        return best;
    }

    findHandleIndex(x, y) {
        const handleY = this.canvas.height - 10;
        for (let i = 0; i < this.stops.length; i++) {
            const hx = this.posToX(this.stops[i].position);
            const dx = hx - x;
            const dy = handleY - y;
            if ((dx * dx + dy * dy) <= (this.handleRadius * this.handleRadius)) return i;
        }
        return -1;
    }

    normalizeStops(stops) {
        const normalized = stops
            .map(s => ({
                position: Math.max(0, Math.min(1, Number(s.position) || 0)),
                color: this.normalizeColor(s.color)
            }))
            .sort((a, b) => a.position - b.position);
        normalized[0].position = 0;
        normalized[normalized.length - 1].position = 1;
        return normalized;
    }

    normalizeColor(color) {
        if (typeof color !== 'string') return '#ffffff';
        const c = color.trim();
        return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#ffffff';
    }

    posToX(pos) {
        return 10 + pos * (this.canvas.width - 20);
    }

    xToPos(x) {
        return (Math.max(10, Math.min(this.canvas.width - 10, x)) - 10) / (this.canvas.width - 20);
    }

    sampleColor(pos) {
        const p = Math.max(0, Math.min(1, pos));
        let left = this.stops[0];
        let right = this.stops[this.stops.length - 1];
        for (let i = 1; i < this.stops.length; i++) {
            if (this.stops[i].position >= p) {
                left = this.stops[i - 1];
                right = this.stops[i];
                break;
            }
        }
        const t = (right.position - left.position) > 1e-6
            ? (p - left.position) / (right.position - left.position)
            : 0;
        const lc = this.hexToRgb(left.color);
        const rc = this.hexToRgb(right.color);
        const r = Math.round(lc.r + (rc.r - lc.r) * t);
        const g = Math.round(lc.g + (rc.g - lc.g) * t);
        const b = Math.round(lc.b + (rc.b - lc.b) * t);
        return this.rgbToHex(r, g, b);
    }

    hexToRgb(hex) {
        const v = Number.parseInt(hex.slice(1), 16);
        return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }

    rgbToHex(r, g, b) {
        const c = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
        return `#${c.toString(16).padStart(6, '0')}`;
    }

    render() {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        const targetW = Math.max(1, Math.round(rect.width));
        const targetH = Math.max(1, Math.round(rect.height));
        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
        }
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const gx = 10;
        const gy = 8;
        const gw = this.canvas.width - 20;
        const gh = 16;
        const grad = ctx.createLinearGradient(gx, gy, gx + gw, gy);
        for (const s of this.stops) {
            grad.addColorStop(s.position, s.color);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(gx, gy, gw, gh);
        ctx.strokeStyle = '#2b3340';
        ctx.lineWidth = 1;
        ctx.strokeRect(gx, gy, gw, gh);

        const handleY = this.canvas.height - 10;
        for (let i = 0; i < this.stops.length; i++) {
            const x = this.posToX(this.stops[i].position);
            ctx.beginPath();
            ctx.arc(x, handleY, this.handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = this.stops[i].color;
            ctx.fill();
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }
}

export { ColorbarEditor };
