(function () {
    'use strict';

    const BOOT_ENABLED_KEY = 'alien_boot_played';
    const BOOT_DURATION_SESSION = false;

    function shouldPlayBoot() {
        if (BOOT_DURATION_SESSION) return !sessionStorage.getItem(BOOT_ENABLED_KEY);
        return true;
    }

    function markBootPlayed() {
        if (BOOT_DURATION_SESSION) sessionStorage.setItem(BOOT_ENABLED_KEY, '1');
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function applyLivery(profile) {
        if (window.KtbHouses && profile) window.KtbHouses.apply(profile);
    }

    async function resolveScenario() {
        let apiUrl = null;
        try {
            const module = await import('./config.js');
            apiUrl = module.default.API_URL;
        } catch (error) {
            console.warn('Boot config is unavailable, using the default scenario.', error);
        }
        const context = await window.BootScenarios.loadContext(apiUrl, { timeout: 3000 });
        const scenario = window.BootScenarios.buildScenario(context.theme, context.profile);
        scenario.skipBoot = context.skipBoot === true;
        applyLivery(context.profile);
        return scenario;
    }

    function applyTheme(theme) {
        try { localStorage.setItem('userTheme', theme); } catch (e) {}
        document.body.classList.remove('theme-yellow', 'theme-green', 'theme-ktb');
        document.body.classList.add(`theme-${theme}`);
    }

    function createOverlay(scenario) {
        const overlay = document.createElement('div');
        overlay.id = 'alien-boot-overlay';
        overlay.dataset.theme = scenario.theme;
        // Для КТБ: noble / ignoble / exile — определяет вид заставки.
        overlay.dataset.estate = scenario.standing || scenario.estate || '';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-label', `Запуск системы ${scenario.system}`);

        overlay.innerHTML = `
            <div id="alien-crt-circle"></div>
            <canvas id="alien-static-canvas"></canvas>
            <div id="alien-system-id"></div>
            <div id="alien-boot-text"></div>
            <div id="alien-corp-banner">
                <div class="alien-corp-line"></div>
                <div class="alien-corp-title"></div>
                <div class="alien-corp-subtitle"></div>
                <div class="alien-corp-line"></div>
            </div>
            <div id="alien-scanline-sweep"></div>
            <div id="alien-glitch-overlay"></div>
            <div class="alien-scanlines-bg"></div>
            <div class="alien-vignette"></div>
            <div class="alien-corner-markers">
                <div class="alien-corner tl"></div>
                <div class="alien-corner tr"></div>
                <div class="alien-corner bl"></div>
                <div class="alien-corner br"></div>
            </div>
            <div class="alien-progress-container">
                <div class="alien-progress-label"></div>
                <div class="alien-progress-bar-bg">
                    <div class="alien-progress-bar-fill"></div>
                </div>
            </div>
        `;
        overlay.querySelector('#alien-system-id').textContent = scenario.system;
        overlay.querySelector('.alien-corp-title').textContent = scenario.bannerTitle;
        overlay.querySelector('.alien-corp-subtitle').textContent = scenario.bannerSubtitle;
        overlay.querySelector('.alien-progress-label').textContent = scenario.progressLabel;
        return overlay;
    }

    function drawStatic(canvas, intensity, theme) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const scale = 4;
        const w = Math.ceil(window.innerWidth / scale);
        const h = Math.ceil(window.innerHeight / scale);
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.imageRendering = 'pixelated';
        const imageData = ctx.createImageData(w, h);
        const data = imageData.data;
        // Шум в цветах тем: позолота КТБ, синий IPS-N, красный GMS.
        const palette = theme === 'ktb' ? [0.78, 0.63, 0.32] : theme === 'yellow' ? [0.11, 0.6, 0.91] : [0.86, 0.1, 0.18];
        for (let i = 0; i < data.length; i += 4) {
            const value = Math.random() * 255 * intensity;
            data[i] = value * palette[0];
            data[i + 1] = value * palette[1];
            data[i + 2] = value * palette[2];
            data[i + 3] = Math.random() * 100 * intensity;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    function animateStatic(canvas, duration, theme) {
        return new Promise(resolve => {
            const start = performance.now();
            function frame(now) {
                const elapsed = now - start;
                if (elapsed > duration) {
                    resolve();
                    return;
                }
                drawStatic(canvas, Math.max(0, 1 - elapsed / duration), theme);
                setTimeout(() => requestAnimationFrame(frame), 30);
            }
            requestAnimationFrame(frame);
        });
    }

    function createTypingAudioPool(size) {
        const pool = [];
        let index = 0;
        for (let i = 0; i < size; i++) {
            const audio = new Audio('assets/sounds/tiping.mp3');
            audio.volume = 0.15;
            audio.playbackRate = 1.8;
            audio.preload = 'auto';
            pool.push(audio);
        }
        return function play() {
            const audio = pool[index];
            index = (index + 1) % pool.length;
            audio.currentTime = 0;
            audio.play().catch(() => {});
        };
    }

    async function typeText(container, text, speed, playType) {
        const line = document.createElement('div');
        line.classList.add('alien-boot-line');
        if (!text) line.classList.add('alien-boot-spacer');
        container.appendChild(line);
        requestAnimationFrame(() => line.classList.add('visible'));
        if (!text) {
            line.textContent = ' ';
            return;
        }
        for (let i = 0; i < text.length; i++) {
            line.textContent = text.substring(0, i + 1);
            if (i % 3 === 0) playType();
            await delay(speed + Math.random() * Math.min(15, speed));
        }
    }

    async function typeBootSequence(container, scenario) {
        const playType = createTypingAudioPool(4);
        for (const line of scenario.lines) {
            await typeText(container, line, scenario.typingSpeed, playType);
            await delay(140 + Math.random() * 180);
        }
        if (scenario.greeting) {
            const greeting = document.createElement('div');
            greeting.id = 'alien-boot-greeting';
            greeting.textContent = scenario.greeting;
            container.appendChild(greeting);
            requestAnimationFrame(() => greeting.classList.add('visible'));
            await delay(2400);
        }
        // Пауза на чтение напечатанного текста перед появлением кнопки подтверждения.
        if (scenario.holdMs) {
            await delay(scenario.holdMs);
        }
    }

    async function waitForIdentityConfirm(container, scenario) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'alien-boot-confirm';
        button.textContent = scenario.confirmLabel || 'Подтвердить личность';
        container.appendChild(button);
        requestAnimationFrame(() => button.classList.add('visible'));
        button.focus();

        await new Promise(resolve => {
            function cleanup() {
                window.removeEventListener('keydown', onKeyDown);
            }
            function onConfirm() {
                cleanup();
                resolve();
            }
            function onKeyDown(event) {
                if (event.key === 'Enter') onConfirm();
            }
            button.addEventListener('click', onConfirm, { once: true });
            window.addEventListener('keydown', onKeyDown);
        });

        button.classList.remove('visible');
        await delay(400);
    }

    function animateProgressBar(fillEl, duration) {
        return new Promise(resolve => {
            const start = performance.now();
            function step(now) {
                const elapsed = now - start;
                let progress = Math.min(elapsed / duration, 1);
                if (progress > 0.3 && progress < 0.35) progress = 0.3;
                if (progress > 0.6 && progress < 0.65) progress = 0.6;
                if (progress > 0.85 && progress < 0.9) progress = 0.85;
                fillEl.style.width = `${progress * 100}%`;
                if (progress < 1) requestAnimationFrame(step);
                else resolve();
            }
            requestAnimationFrame(step);
        });
    }

    // Порядок появления элементов интерфейса во время загрузки (сверху вниз, затем кнопки).
    const STAGE_TARGETS = ['#ktb-crest', '#contact_1', '#main-receiver', '#contact_2', '#text-con',
        '#terminal-background', '#header-buttons', '#music-float-btn', '#admin-float-btn'];

    function stageTargets() {
        return STAGE_TARGETS
            .map(selector => document.querySelector(selector))
            .filter(el => el && getComputedStyle(el).display !== 'none' && el.style.display !== 'none');
    }

    // Элементы появляются по одному в стиле темы (styles/themes.css: body.boot-staged и .ui-in).
    // Пока идёт показ, интерфейс не принимает нажатий; после — полностью доступен.
    async function stageInterface(duration) {
        const body = document.body;
        body.classList.remove('boot-phase');
        body.classList.add('boot-staged');
        const targets = stageTargets();
        const step = duration / (targets.length + 1);
        for (const el of targets) {
            el.classList.add('ui-in');
            await delay(step);
        }
        await delay(step);
    }

    function finishStaging() {
        document.body.classList.remove('boot-staged', 'boot-phase');
        // Пульт и кнопки на месте — пересчитываем масштаб с защитой от переполнения.
        if (window.UiScale) window.UiScale.refresh();
        // Снимаем классы показа после анимации, чтобы не мешать эффектам помех dialogue.js.
        setTimeout(() => {
            document.querySelectorAll('.ui-in').forEach(el => el.classList.remove('ui-in'));
        }, 1200);
        const asmCode = document.getElementById('assembly-code-overlay');
        if (asmCode) asmCode.style.display = '';
    }

    async function runBootSequence(scenario) {
        document.body.classList.add('boot-phase');
        let overlay = null;
        try {
            applyTheme(scenario.theme);
            document.title = `Терминал ${scenario.system}`;
            overlay = createOverlay(scenario);
            document.body.prepend(overlay);

            const crtCircle = overlay.querySelector('#alien-crt-circle');
            const staticCanvas = overlay.querySelector('#alien-static-canvas');
            const bootText = overlay.querySelector('#alien-boot-text');
            const corpBanner = overlay.querySelector('#alien-corp-banner');
            const scanlineSweep = overlay.querySelector('#alien-scanline-sweep');
            const glitchOverlay = overlay.querySelector('#alien-glitch-overlay');
            const scanlinesBg = overlay.querySelector('.alien-scanlines-bg');
            const vignetteEl = overlay.querySelector('.alien-vignette');
            const cornerMarkers = overlay.querySelector('.alien-corner-markers');
            const progressContainer = overlay.querySelector('.alien-progress-container');
            const progressFill = overlay.querySelector('.alien-progress-bar-fill');
            const asmCode = document.getElementById('assembly-code-overlay');

            if (asmCode) asmCode.style.display = 'none';
            await delay(300);
            crtCircle.classList.add('expand');
            await delay(600);
            staticCanvas.classList.add('flash');
            animateStatic(staticCanvas, 600, scenario.theme);
            await delay(400);
            scanlinesBg.classList.add('visible');
            vignetteEl.classList.add('visible');
            cornerMarkers.classList.add('visible');
            await delay(200);
            bootText.classList.add('visible');
            await typeBootSequence(bootText, scenario);
            await waitForIdentityConfirm(bootText, scenario);
            await delay(500);
            glitchOverlay.classList.add('active');
            bootText.classList.remove('visible');
            bootText.classList.add('fade-out');
            // Текст исчезает ~2 секунды — не снимаем его с экрана раньше анимации.
            await delay(2000);
            overlay.classList.add('alien-flicker-subtle');
            await delay(150);
            overlay.classList.remove('alien-flicker-subtle');

            const bannerAudio = new Audio('assets/sounds/global_assets_1166.mp3');
            bannerAudio.volume = 0.4;
            bannerAudio.preload = 'auto';
            corpBanner.classList.add('visible');
            bannerAudio.play().catch(() => {});
            await delay(3400);
            scanlineSweep.classList.add('sweep');
            await delay(800);
            glitchOverlay.classList.remove('active');
            void glitchOverlay.offsetWidth;
            glitchOverlay.classList.add('active');
            await delay(400);
            // Лого гаснет, экран загрузки становится прозрачным, шкала уходит к нижнему краю,
            // и пока она заполняется, элементы интерфейса появляются один за другим.
            overlay.classList.add('ui-stage');
            progressContainer.classList.add('visible');
            await delay(300);
            const STAGE_DURATION = 3600;
            await Promise.all([
                animateProgressBar(progressFill, STAGE_DURATION),
                stageInterface(STAGE_DURATION - 300)
            ]);
            await delay(250);
            progressContainer.classList.add('fade-out');
            await delay(400);
            finishStaging();
            overlay.classList.add('fade-out');
            await delay(600);
            overlay.classList.add('boot-complete');
            markBootPlayed();
            setTimeout(() => overlay.remove(), 1500);
        } catch (error) {
            console.error('Boot sequence failed:', error);
            finishStaging();
            if (overlay) overlay.remove();
        }
    }

    // Запуск без заставки: тот же поочерёдный показ, только быстрее.
    async function instantReveal(scenario) {
        applyTheme(scenario.theme);
        document.title = `Терминал ${scenario.system}`;
        document.body.classList.add('boot-phase');
        await delay(50);
        await stageInterface(900);
        finishStaging();
    }

    async function startBoot() {
        let scenario = null;
        try {
            scenario = await resolveScenario();
        } catch (error) {
            console.warn('Boot scenario resolution failed, using defaults.', error);
        }
        if (!scenario) {
            scenario = window.BootScenarios.buildScenario('yellow', null);
        }
        if (scenario.skipBoot) {
            instantReveal(scenario);
            return;
        }
        runBootSequence(scenario);
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (shouldPlayBoot()) startBoot();
    });
})();
