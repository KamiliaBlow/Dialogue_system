// Превью портрета в студии — настоящая рамка канала терминала.
// Размер рамки как у терминала при 1920×1080 (258×319), та же формула (portrait-frame.js),
// та же тонировка и рамка в теме админа. Рядом — заглушка пульта связи, чтобы было видно,
// в какую сторону смотрит персонаж в левом и правом окне.
import { BASE_FRAME, portraitCss } from '../portrait-frame.js';
import { assetUrl } from './studio-store.js';

const STATIC_IMAGE = 'assets/images/portraits/static.gif';
const THEMES = [
    { id: 'green', label: 'GMS' },
    { id: 'yellow', label: 'IPS-N' },
    { id: 'ktb', label: 'КТБ' },
    { id: 'horus', label: 'HORUS' },
    { id: 'ssc', label: 'SSC' },
    { id: 'ha', label: 'HA' }
];
const SCALE_MIN = 0.2;
const SCALE_MAX = 4;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

export default class PortraitEditor {
    constructor({ onChange } = {}) {
        this.onChange = onChange || (() => {});
        this.side = 1;
        this.state = { image: '', name: '', scale: 1, xRel: 0, yRel: 0, mirror: false };
        this.stage = document.getElementById('pf-stage');
        this.compare = document.getElementById('pf-compare');
        this.fields = {
            scaleRange: document.getElementById('pf-scale-range'),
            scale: document.getElementById('pf-scale'),
            x: document.getElementById('pf-x'),
            y: document.getElementById('pf-y'),
            mirror: document.getElementById('pf-mirror')
        };
        this.buildStage();
        this.bindControls();
        this.render();
    }

    // ---------- разметка ----------

    makeChannel(extraClass = '') {
        const channel = document.createElement('div');
        channel.className = `pf-channel ${extraClass}`.trim();
        channel.innerHTML = `
            <div class="pf-frame char-box" tabindex="0" role="img"><div class="overlay"></div></div>
            <div class="pf-receiver" aria-hidden="true"><span>СВЯЗЬ</span><i></i><i></i><i></i></div>`;
        return channel;
    }

    buildStage() {
        this.stage.textContent = '';
        this.channel = this.makeChannel();
        this.frame = this.channel.querySelector('.pf-frame');
        this.frame.setAttribute('aria-label', 'Превью портрета: перетащите, чтобы сдвинуть; колесо — масштаб');
        const caption = document.createElement('div');
        caption.className = 'pf-caption';
        caption.innerHTML = '<b class="pf-name"></b><span class="pf-line">Канал открыт. Слышите меня?</span>';
        this.nameEl = caption.querySelector('.pf-name');
        this.stage.append(this.channel, caption);
        this.bindFrame(this.frame);
    }

    buildCompare() {
        this.compare.textContent = '';
        this.compareFrames = THEMES.map(theme => {
            const cell = document.createElement('figure');
            cell.className = `pf-mini pf-theme-${theme.id}`;
            const channel = this.makeChannel();
            // Миниатюры только для просмотра: не в порядке табуляции и без подписи для чтения с экрана.
            const mini = channel.querySelector('.pf-frame');
            mini.removeAttribute('tabindex');
            mini.removeAttribute('role');
            channel.setAttribute('aria-hidden', 'true');
            const caption = document.createElement('figcaption');
            caption.textContent = theme.label;
            cell.append(channel, caption);
            this.compare.appendChild(cell);
            return channel;
        });
    }

    // ---------- состояние ----------

    set(portrait) {
        this.state = {
            image: portrait.image || '',
            name: portrait.name || '',
            scale: clamp(Number(portrait.scale) || 1, SCALE_MIN, SCALE_MAX),
            xRel: Number(portrait.xRel) || 0,
            yRel: Number(portrait.yRel) || 0,
            mirror: !!portrait.mirror
        };
        this.render();
    }

    get() {
        return { scale: round(this.state.scale), xRel: round(this.state.xRel), yRel: round(this.state.yRel), mirror: this.state.mirror };
    }

    setImage(image) {
        this.state.image = image || '';
        this.render();
    }

    setName(name) {
        this.state.name = name || '';
        this.render();
    }

    update(patch, { silent = false } = {}) {
        Object.assign(this.state, patch);
        this.state.scale = clamp(this.state.scale, SCALE_MIN, SCALE_MAX);
        this.render();
        if (!silent) this.onChange(this.get());
    }

    // ---------- отрисовка ----------

    paintChannel(channel) {
        const frame = channel.querySelector('.pf-frame');
        channel.classList.toggle('side-right', this.side === 2);
        if (this.state.image) {
            frame.style.backgroundImage = `url("${assetUrl(this.state.image)}")`;
            const css = portraitCss(this.state, BASE_FRAME.width);
            frame.style.backgroundSize = css.backgroundSize;
            frame.style.backgroundPosition = css.backgroundPosition;
            frame.style.transform = css.transform;
            frame.classList.remove('is-static');
        } else {
            // Без портрета терминал показывает помехи static.gif на всю рамку.
            frame.style.backgroundImage = `url("${assetUrl(STATIC_IMAGE)}")`;
            frame.style.backgroundSize = '';
            frame.style.backgroundPosition = '';
            frame.style.transform = '';
            frame.classList.add('is-static');
        }
    }

    render() {
        this.paintChannel(this.channel);
        (this.compareFrames || []).forEach(ch => this.paintChannel(ch));
        this.nameEl.textContent = this.state.name || 'Персонаж';

        const pct = Math.round(this.state.scale * 100);
        if (document.activeElement !== this.fields.scale) this.fields.scale.value = pct;
        this.fields.scaleRange.value = pct;
        if (document.activeElement !== this.fields.x) this.fields.x.value = round(this.state.xRel * 100, 1);
        if (document.activeElement !== this.fields.y) this.fields.y.value = round(this.state.yRel * 100, 1);
        this.fields.mirror.setAttribute('aria-pressed', String(this.state.mirror));
        this.fields.mirror.classList.toggle('active', this.state.mirror);
    }

    // ---------- управление ----------

    bindControls() {
        document.querySelectorAll('.pf-side [data-side]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.side = Number(btn.dataset.side);
                document.querySelectorAll('.pf-side [data-side]').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-checked', String(on));
                });
                this.render();
            });
        });

        const fromPercent = input => (parseFloat(input.value) || 0) / 100;
        this.fields.scaleRange.addEventListener('input', () => this.update({ scale: fromPercent(this.fields.scaleRange) }));
        this.fields.scale.addEventListener('input', () => {
            const v = fromPercent(this.fields.scale);
            if (v >= SCALE_MIN && v <= SCALE_MAX) this.update({ scale: v });
        });
        this.fields.scale.addEventListener('change', () => this.render());
        this.fields.x.addEventListener('input', () => this.update({ xRel: fromPercent(this.fields.x) }));
        this.fields.y.addEventListener('input', () => this.update({ yRel: fromPercent(this.fields.y) }));
        this.fields.mirror.addEventListener('click', () => this.update({ mirror: !this.state.mirror }));
        document.getElementById('pf-center')?.addEventListener('click', () => this.center());
        document.getElementById('pf-reset')?.addEventListener('click', () => this.update({ scale: 1, xRel: 0, yRel: 0, mirror: false }));

        const compareBtn = document.getElementById('pf-compare-btn');
        compareBtn?.addEventListener('click', () => {
            const open = this.compare.hidden;
            this.compare.hidden = !open;
            compareBtn.setAttribute('aria-expanded', String(open));
            compareBtn.textContent = open ? 'Скрыть другие темы' : 'Показать в других темах';
            if (open && !this.compareFrames) this.buildCompare();
            this.render();
        });
    }

    // По центру рамки с учётом пропорций картинки (если она загружена).
    center() {
        const img = new Image();
        img.onload = () => {
            const w = BASE_FRAME.width * this.state.scale;
            const h = w * (img.naturalHeight / img.naturalWidth || 1);
            this.update({
                xRel: (BASE_FRAME.width - w) / 2 / BASE_FRAME.width,
                yRel: (BASE_FRAME.height - h) / 2 / BASE_FRAME.width
            });
        };
        img.onerror = () => this.update({ xRel: 0, yRel: 0 });
        if (this.state.image) img.src = assetUrl(this.state.image);
        else this.update({ xRel: 0, yRel: 0 });
    }

    bindFrame(frame) {
        let drag = null;
        // Экранные пиксели → пиксели рамки (рамку может уменьшать zoom/масштаб страницы).
        // Ширина на экране включает рамку 1px с каждой стороны.
        const FRAME_OUTER = BASE_FRAME.width + 2;
        const toFrame = () => FRAME_OUTER / (frame.getBoundingClientRect().width || FRAME_OUTER);

        frame.addEventListener('pointerdown', e => {
            if (!this.state.image || e.button !== 0) return;
            e.preventDefault();
            frame.setPointerCapture(e.pointerId);
            frame.classList.add('dragging');
            drag = { x: e.clientX, y: e.clientY, xRel: this.state.xRel, yRel: this.state.yRel, k: toFrame() };
        });
        frame.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = (e.clientX - drag.x) * drag.k;
            const dy = (e.clientY - drag.y) * drag.k;
            // В зеркальной рамке ось X перевёрнута.
            const sx = this.state.mirror ? -1 : 1;
            this.update({ xRel: drag.xRel + sx * dx / BASE_FRAME.width, yRel: drag.yRel + dy / BASE_FRAME.width });
        });
        const stop = () => { drag = null; frame.classList.remove('dragging'); };
        frame.addEventListener('pointerup', stop);
        frame.addEventListener('pointercancel', stop);

        frame.addEventListener('wheel', e => {
            if (!this.state.image) return;
            e.preventDefault();
            this.update({ scale: this.state.scale * Math.exp(-e.deltaY * 0.0012) });
        }, { passive: false });

        frame.addEventListener('keydown', e => {
            if (!this.state.image) return;
            const step = (e.shiftKey ? 5 : 0.5) / 100;
            const sx = this.state.mirror ? -1 : 1;
            const moves = {
                ArrowLeft: { xRel: this.state.xRel - sx * step },
                ArrowRight: { xRel: this.state.xRel + sx * step },
                ArrowUp: { yRel: this.state.yRel - step },
                ArrowDown: { yRel: this.state.yRel + step },
                '+': { scale: this.state.scale * 1.05 },
                '=': { scale: this.state.scale * 1.05 },
                '-': { scale: this.state.scale / 1.05 }
            };
            if (!moves[e.key]) return;
            e.preventDefault();
            this.update(moves[e.key]);
        });
    }
}
