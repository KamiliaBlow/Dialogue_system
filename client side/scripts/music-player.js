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
    border: 2px solid var(--primary-color, #03FB8D);
    background: rgba(0, 0, 0, 0.85);
    color: var(--primary-color, #03FB8D);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9999;
    font-family: 'Orbitron', sans-serif;
    font-size: 16px;
    user-select: none;
    box-shadow: 0 0 10px var(--glow-mid, rgba(3, 251, 141, 0.3));
}
#music-popup {
    position: fixed;
    bottom: 70px;
    right: 20px;
    border: 2px solid var(--primary-color, #03FB8D);
    background: rgba(0, 0, 0, 0.92);
    padding: 15px;
    display: none;
    flex-direction: column;
    z-index: 9999;
    min-width: 230px;
    box-shadow: 0 0 10px var(--glow-mid, rgba(3, 251, 141, 0.3));
}
#music-popup .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}
#music-popup button {
    background: #000;
    border: 1px solid var(--primary-color, #03FB8D);
    color: var(--primary-color, #03FB8D);
    padding: 4px 10px;
    cursor: pointer;
    font-family: 'Orbitron', sans-serif;
    font-size: 13px;
}
#music-popup button:hover {
    box-shadow: 0 0 5px var(--primary-color, #03FB8D);
}
#music-popup #track-name {
    color: var(--primary-color, #03FB8D);
    font-size: 11px;
    font-family: 'Orbitron', sans-serif;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 130px;
}
#music-popup input[type="range"] {
    width: 100%;
    accent-color: var(--primary-color, #03FB8D);
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
                this.tracks = [{ src: saved.src, name: saved.name || 'Трек', volume: 100 }];
                this.currentTrackIndex = 0;
                this.pendingSeekTime = saved.time || 0;
                this.desiredPlaying = !!saved.playing;
            }
            if (VALID_THEMES.includes(saved.theme)) this.currentTheme = saved.theme;
        }
        if (!this.tracks.length) {
            this.tracks = [{ src: 'assets/sounds/terminal.mp3', name: 'Aliens Signal', volume: 100 }];
        }

        this.bindEvents();
        this.updatePlayPauseButton();
        this.updateRepeatButton();
        this.volumeControl.value = this.masterVolume;
        this.loadTrack(this.currentTrackIndex);

        // Настройки пользователя и плейлист темы — сразу, чтобы восстановить состояние быстрее
        this.ensureSettingsAndPlaylist();
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
                <button id="play-pause-btn">▶️</button>
                <button id="next-track-btn" title="Следующий трек">⏭</button>
                <button id="repeat-btn" title="Повтор текущего трека">🔁</button>
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

        // Если воспроизведение заблокировано автоплеем — возобновляем по первому клику
        document.addEventListener('click', () => {
            if (this.desiredPlaying && this.music.paused && this._settingsLoaded) {
                this.music.play().catch(() => {});
            }
        });
    }

    applyVolume() {
        const trackVol = this.tracks[this.currentTrackIndex]?.volume ?? 100;
        this.music.volume = Math.min(1, this.masterVolume * trackVol / 100);
    }

    updatePlayPauseButton() {
        this.playPauseBtn.textContent = this.music.paused ? '▶️' : '⏸️';
    }

    updateRepeatButton() {
        if (!this.repeatBtn) return;
        this.repeatBtn.style.opacity = this.repeatOne ? '1' : '0.45';
        this.repeatBtn.title = this.repeatOne ? 'Повтор включён (клик — выключить)' : 'Повтор текущего трека';
    }

    loadTrack(index) {
        if (!this.tracks.length) return;
        this.currentTrackIndex = index;
        this._seekApplied = false;
        const t = this.tracks[index];
        this.music.src = t.src;
        this.trackName.textContent = `Трек: ${t.name}`;
        this.applyVolume();
        this.updatePlayPauseButton();
        this.persist();
    }

    nextTrack() {
        if (!this.tracks.length) return;
        this.loadTrack((this.currentTrackIndex + 1) % this.tracks.length);
        this.desiredPlaying = true;
        this.music.play().catch(() => {});
    }

    persist() {
        const t = this.tracks[this.currentTrackIndex];
        saveState({
            src: t ? t.src : null,
            name: t ? t.name : '',
            idx: this.currentTrackIndex,
            time: this.music.currentTime || 0,
            playing: this.desiredPlaying,
            master: this.masterVolume,
            repeat: this.repeatOne,
            theme: this.currentTheme
        });
    }

    async ensureSettingsAndPlaylist() {
        await this.loadMusicSettings();
        await this.loadPlaylist();
        this._settingsLoaded = true;
        if (this.desiredPlaying && this.autoPlayMusic) {
            this.music.play().catch(() => {});
        }
        this.updatePlayPauseButton();
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
        try {
            const response = await fetch(`${API_URL}/music-playlist/${this.currentTheme}`, { credentials: 'include' });
            if (!response.ok) return;
            const data = await response.json();
            if (!Array.isArray(data.tracks) || data.tracks.length === 0) return;

            const saved = loadState();
            const playlistSrcs = data.tracks.map(t =>
                /^https?:/.test(t.file_path) ? t.file_path : SERVER_ORIGIN + t.file_path);
            const savedIdx = playlistSrcs.indexOf(saved?.src);
            const savedTime = savedIdx >= 0 ? (saved?.time || 0) : 0;

            this.tracks = data.tracks.map((t, i) => ({
                src: playlistSrcs[i],
                name: t.title,
                volume: Math.max(0, Math.min(100, Number(t.volume ?? 100)))
            }));

            if (savedIdx >= 0) {
                this.pendingSeekTime = savedTime;
                this.loadTrack(savedIdx);
            } else if (!saved?.src) {
                this.loadTrack(0);
            }
            // Если сохранённый трек не входит в плейлист — продолжаем играть его как есть.
        } catch (e) {
            console.log('Не удалось загрузить плейлист:', e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const player = new MusicPlayer();
    player.init();
});
