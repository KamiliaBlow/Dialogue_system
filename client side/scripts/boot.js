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
        overlay.dataset.estate = scenario.estate || '';
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
        const palette = theme === 'ktb' ? [0.85, 0.66, 0.24] : theme === 'yellow' ? [1, 0.35, 0.12] : [0.2, 0.8, 0.5];
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
            const mCodec = document.getElementById('mCodec');
            const textCon = document.getElementById('text-con');
            const termBg = document.getElementById('terminal-background');
            const musicBtn = document.getElementById('music-float-btn');
            const adminBtn = document.getElementById('admin-float-btn');
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
            progressContainer.classList.add('visible');
            await delay(300);
            await animateProgressBar(progressFill, 2600);
            await delay(200);
            progressContainer.classList.add('fade-out');
            await delay(500);
            overlay.classList.add('reveal-phase');
            await delay(200);
            if (mCodec) mCodec.classList.add('boot-reveal-main');
            await delay(200);
            overlay.classList.add('reveal-phase-transparent');
            if (textCon) textCon.classList.add('boot-reveal-text');
            if (termBg) termBg.classList.add('boot-reveal-terminal');
            await delay(300);
            if (asmCode) {
                asmCode.style.display = '';
                asmCode.classList.add('boot-reveal-code');
            }
            await delay(200);
            if (musicBtn) musicBtn.classList.add('boot-reveal-btn');
            if (adminBtn && adminBtn.style.display !== 'none') adminBtn.classList.add('boot-reveal-btn');
            await delay(600);
            document.body.classList.remove('boot-phase');
            overlay.classList.add('fade-out');
            await delay(1300);
            overlay.classList.add('boot-complete');
            markBootPlayed();
            setTimeout(() => overlay.remove(), 2000);
        } catch (error) {
            console.error('Boot sequence failed:', error);
            document.body.classList.remove('boot-phase');
            if (overlay) overlay.remove();
            document.getElementById('mCodec')?.classList.add('boot-reveal-main');
            document.getElementById('text-con')?.classList.add('boot-reveal-text');
        }
    }

    function instantReveal(scenario) {
        applyTheme(scenario.theme);
        document.title = `Терминал ${scenario.system}`;
        document.getElementById('mCodec')?.classList.add('boot-reveal-main');
        document.getElementById('text-con')?.classList.add('boot-reveal-text');
        document.getElementById('terminal-background')?.classList.add('boot-reveal-terminal');
        document.getElementById('music-float-btn')?.classList.add('boot-reveal-btn');
        const adminBtn = document.getElementById('admin-float-btn');
        if (adminBtn && adminBtn.style.display !== 'none') adminBtn.classList.add('boot-reveal-btn');
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
