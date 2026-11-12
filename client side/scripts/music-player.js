// Единый музыкальный плеер для всех страниц (кроме логина).
// Воспроизведение продолжается между страницами за счёт сохранения состояния
// (трек, позиция, громкость, повтор) в localStorage и его восстановления на новой странице.
const SERVER_ORIGIN = `${window.location.protocol}//${window.location.hostname}:3000`;
const API_URL = `${SERVER_ORIGIN}/api`;
const STATE_KEY = 'musicPlayerStateV1';
const VALID_THEMES = ['yellow', 'green', 'ktb'];

const PLAYER_CSS = `
#music-float-btn {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 40px;
    height: 40px;
    border: 2px solid var(--primary-color, var(--accent, #db1a2d));
    background: rgba(0, 0, 0, 0.85);
    color: var(--primary-color, var(--accent, #db1a2d));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9999;
    font-family: var(--t-font-label, 'JetBrains Mono', monospace);
    font-size: 16px;
    user-select: none;
    box-shadow: 0 0 10px var(--glow-mid, rgba(0, 0, 0, 0.45));
}
#music-popup {
    position: fixed;
    bottom: 70px;
    right: 20px;
    border: 2px solid var(--primary-color, var(--accent, #db1a2d));
    background: rgba(0, 0, 0, 0.92);
    padding: 15px;
    display: none;
    flex-direction: column;
    z-index: 9999;
    min-width: 230px;
    box-shadow: 0 0 10px var(--glow-mid, rgba(0, 0, 0, 0.45));
}
#music-popup .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}
#music-popup button {
    background: #000;
    border: 1px solid var(--primary-color, var(--accent, #db1a2d));
    color: var(--primary-color, var(--accent, #db1a2d));
    padding: 4px 10px;
    cursor: pointer;
    font-family: var(--t-font-label, 'JetBrains Mono', monospace);
    font-size: 13px;
}
#music-popup button:hover {
    box-shadow: 0 0 5px var(--primary-color, var(--accent, #db1a2d));
}
#music-popup #track-name {
    color: var(--primary-color, var(--accent, #db1a2d));
    font-size: 11px;
    font-family: var(--t-font-label, 'JetBrains Mono', monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 130px;
}
#music-popup input[type="range"] {
    width: 100%;
    accent-color: var(--primary-color, var(--accent, #db1a2d));
}
`;

function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; }
    catch { return null; }
}

function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
}

class MusicPlayer {
    constructor() {
        this.currentTheme = 'yellow';
        this.masterVolume = 0.2;
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.repeatOne = false;
        this.autoPlayMusic = true;
        this.desiredPlaying = false;
        this.pendingSeekTime = 0;
        this._lastSaveTs = 0;
        this._settingsLoaded = false;
        this._seekApplied = false;
    }

    init() {
        this.injectDom();

        const saved = loadState();
        if (saved) {
            if (typeof saved.master === 'number') this.masterVolume = saved.master;
            this.repeatOne = !!saved.repeat;
            if (saved.src) {
                this.tracks = [{ src: saved.src, name: saved.name || 'Трек', volume: 100, carryOver: !!saved.carryOver }];
                this.currentTrackIndex = 0;
                this.pendingSeekTime = saved.time || 0;
                this.desiredPlaying = !!saved.playing;
            }
            if (VALID_THEMES.includes(saved.theme)) this.currentTheme = saved.theme;
        }
        if (!this.tracks.length) {
            this.tracks = [{ src: 'assets/sounds/terminal.mp3', name: 'Aliens Signal', volume: 100, isFallback: true }];
        }

        this.bindEvents();
        this.updatePlayPauseButton();
        this.updateRepeatButton();
        this.volumeControl.value = this.masterVolume;
        this.loadTrack(this.currentTrackIndex);

        // Настройки пользователя и плейлист темы — сразу, чтобы восстановить состояние быстрее
        this.ensureSettingsAndPlaylist();

        window.addEventListener('pilot-theme-change', event => this.switchTheme(event.detail?.theme));
    }

    injectDom() {
        const style = document.createElement('style');
        style.id = 'music-player-styles';
        style.textContent = PLAYER_CSS;
        document.head.appendChild(style);

        const floatBtn = document.createElement('div');
        floatBtn.id = 'music-float-btn';
        floatBtn.textContent = 'P';

        const popup = document.createElement('div');
        popup.id = 'music-popup';
        popup.innerHTML = `
            <audio id="background-music"></audio>
            <div class="controls">
                <button id="play-pause-btn" aria-label="Воспроизвести">▶︎</button>
                <button id="next-track-btn" title="Следующий трек" aria-label="Следующий трек">⏭︎</button>
                <button id="repeat-btn" title="Повтор текущего трека" aria-label="Повтор текущего трека">↻</button>
                <span id="track-name">Трек: Название</span>
            </div>
            <input type="range" id="volume-control" min="0" max="1" step="0.1">
        `;
        document.body.appendChild(floatBtn);
        document.body.appendChild(popup);

        this.floatBtn = floatBtn;
        this.popup = popup;
        this.music = popup.querySelector('#background-music');
        this.playPauseBtn = popup.querySelector('#play-pause-btn');
        this.nextBtn = popup.querySelector('#next-track-btn');
        this.repeatBtn = popup.querySelector('#repeat-btn');
        this.trackName = popup.querySelector('#track-name');
        this.volumeControl = popup.querySelector('#volume-control');
    }

    bindEvents() {
        this.floatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.popup.style.display = this.popup.style.display === 'none' || !this.popup.style.display ? 'flex' : 'none';
        });
        this.popup.addEventListener('click', (e) => e.stopPropagation());

        this.playPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.music.paused) {
                this.desiredPlaying = true;
                this.music.play().catch(() => {});
            } else {
                this.desiredPlaying = false;
                this.music.pause();
            }
        });

        this.nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.nextTrack();
        });

        this.repeatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.repeatOne = !this.repeatOne;
            this.updateRepeatButton();
            this.persist();
        });

        this.volumeControl.addEventListener('input', () => {
            this.masterVolume = Number(this.volumeControl.value);
            this.applyVolume();
            this.persist();
        });

        this.music.addEventListener('play', () => { this.updatePlayPauseButton(); this.persist(); });
        this.music.addEventListener('pause', () => { this.updatePlayPauseButton(); this.persist(); });

        this.music.addEventListener('loadedmetadata', () => {
            if (!this._seekApplied && this.pendingSeekTime > 0 && isFinite(this.music.duration)) {
                this.music.currentTime = Math.min(this.pendingSeekTime, this.music.duration || this.pendingSeekTime);
                this._seekApplied = true;
            }
        });

        this.music.addEventListener('timeupdate', () => {
            const now = Date.now();
            if (now - this._lastSaveTs > 2000) {
                this._lastSaveTs = now;
                this.persist();
            }
        });

        this.music.addEventListener('ended', () => {
            if (!this.tracks.length) return;
            if (this.repeatOne) {
                this.music.currentTime = 0;
                this.desiredPlaying = true;
                this.music.play().catch(() => {});
                return;
            }
            this.nextTrack();
        });

        // Если браузер заблокировал автовоспроизведение — продолжаем по первому действию пользователя.
        const resumeOnGesture = () => {
            if (this.desiredPlaying && this.music.paused && this._settingsLoaded) {
                this.music.play().catch(() => {});
            }
        };
        ['pointerdown', 'keydown', 'touchstart'].forEach(type =>
            document.addEventListener(type, resumeOnGesture, { capture: true, passive: true }));

        // Точная позиция при уходе со страницы: следующая страница продолжит с этого места.
        window.addEventListener('pagehide', () => this.persist());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.persist();
        });
    }

    applyVolume() {
        const trackVol = this.tracks[this.currentTrackIndex]?.volume ?? 100;
        this.music.volume = Math.min(1, this.masterVolume * trackVol / 100);
    }

    updatePlayPauseButton() {
        // Монохромные символы (︎) принимают цвет темы, в отличие от цветных эмодзи.
        this.playPauseBtn.textContent = this.music.paused ? '▶︎' : '❚❚';
        this.playPauseBtn.setAttribute('aria-label', this.music.paused ? 'Воспроизвести' : 'Пауза');
    }

    updateRepeatButton() {
        if (!this.repeatBtn) return;
        this.repeatBtn.style.opacity = this.repeatOne ? '1' : '0.45';
        this.repeatBtn.title = this.repeatOne ? 'Повтор включён (клик — выключить)' : 'Повтор текущего трека';
    }

    loadTrack(index) {
        if (!this.tracks.length) return;
        const t = this.tracks[index];
        const sameSource = this.music.src && new URL(t.src, location.href).href === this.music.src;
        this.currentTrackIndex = index;
        // Тот же файл уже загружен (плейлист пришёл после восстановления) — не перезапускаем его.
        if (!sameSource) {
            this._seekApplied = false;
            this.music.src = t.src;
        } else if (!this._seekApplied && this.pendingSeekTime > 0 && this.music.readyState >= 1) {
            this.music.currentTime = this.pendingSeekTime;
            this._seekApplied = true;
        }
        this.trackName.textContent = `Трек: ${t.name}`;
        this.applyVolume();
        this.updatePlayPauseButton();
        this.persist();
    }

    nextTrack() {
        if (!this.tracks.length) return;
        this.pendingSeekTime = 0;
        // Трек из плейлиста прошлой темы доиграл — дальше идёт плейлист новой темы.
        if (this.tracks[this.currentTrackIndex]?.carryOver && this.tracks.length > 1) {
            this.tracks.splice(this.currentTrackIndex, 1);
            this.loadTrack(this.currentTrackIndex % this.tracks.length);
            this.desiredPlaying = true;
            this.music.play().catch(() => {});
            return;
        }
        this.loadTrack((this.currentTrackIndex + 1) % this.tracks.length);
        this.desiredPlaying = true;
        this.music.play().catch(() => {});
    }

    // Текущая позиция трека. Пока сохранённая позиция ещё не применена (метаданные
    // не загружены), отдаём её, а не 0 у только что созданного <audio> — иначе при
    // каждом переходе между страницами трек начинался бы заново.
    currentPosition() {
        if (!this._seekApplied && this.pendingSeekTime > 0) return this.pendingSeekTime;
        return this.music.currentTime || 0;
    }

    persist() {
        const t = this.tracks[this.currentTrackIndex];
        saveState({
            src: t ? t.src : null,
            name: t ? t.name : '',
            idx: this.currentTrackIndex,
            time: this.currentPosition(),
            playing: this.desiredPlaying,
            master: this.masterVolume,
            repeat: this.repeatOne,
            theme: this.currentTheme,
            carryOver: !!t?.carryOver
        });
    }

    async ensureSettingsAndPlaylist() {
        await this.loadMusicSettings();
        await this.loadPlaylist();
        this._settingsLoaded = true;
        // Трек, который играл на прошлой странице, продолжается с того же места.
        if (this.desiredPlaying) {
            this.music.play().catch(() => {});
        }
        this.updatePlayPauseButton();
    }

    async switchTheme(theme) {
        if (!VALID_THEMES.includes(theme) || theme === this.currentTheme) return;
        this.currentTheme = theme;
        this.persist();
        await this.loadPlaylist();
    }

    async loadMusicSettings() {
        try {
            const response = await fetch(`${API_URL}/user-settings`, { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                this.autoPlayMusic = data.auto_play_music !== 0;
                localStorage.setItem('autoPlayMusic', this.autoPlayMusic ? '1' : '0');
                if (VALID_THEMES.includes(data.theme)) {
                    this.currentTheme = data.theme;
                }
            }
        } catch (e) {
            const saved = localStorage.getItem('autoPlayMusic');
            this.autoPlayMusic = saved !== null ? saved === '1' : true;
        }
    }

    async loadPlaylist() {
        const theme = this.currentTheme;
        try {
            const response = await fetch(`${API_URL}/music-playlist/${theme}`, { credentials: 'include' });
            if (!response.ok) return;
            const data = await response.json();
            if (!Array.isArray(data.tracks) || data.tracks.length === 0) return;

            if (theme !== this.currentTheme) return; // пока ждали ответ, тема сменилась ещё раз

            const current = this.tracks[this.currentTrackIndex] || null;
            const playlistSrcs = data.tracks.map(t =>
                /^https?:/.test(t.file_path) ? t.file_path : SERVER_ORIGIN + t.file_path);
            // Сравниваем абсолютные адреса: сохранённый путь может быть относительным.
            const abs = u => { try { return new URL(u, location.href).href; } catch { return u; } };
            const currentIdx = current ? playlistSrcs.map(abs).indexOf(abs(current.src)) : -1;

            const playlist = data.tracks.map((t, i) => ({
                src: playlistSrcs[i],
                name: t.title,
                volume: Math.max(0, Math.min(100, Number(t.volume ?? 100)))
            }));

            if (currentIdx >= 0) {
                this.tracks = playlist;
                this.loadTrack(currentIdx);
            } else if (current && !current.isFallback) {
                // Трек не из плейлиста этой темы (пилот сменил тему) — доигрывает, потом новый плейлист.
                this.tracks = [{ ...current, carryOver: true }, ...playlist];
                this.loadTrack(0);
            } else {
                this.tracks = playlist;
                this.pendingSeekTime = 0;
                this.loadTrack(0);
            }
        } catch (e) {
            console.log('Не удалось загрузить плейлист:', e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const player = new MusicPlayer();
    player.init();
});
