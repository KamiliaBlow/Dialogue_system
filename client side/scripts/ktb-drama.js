(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KtbDrama = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Поединки в Баронствах формализованы; до первой крови дерутся куда чаще, чем до смерти.
    const HERALD_TEXT = 'ВНИМАНИЕ ГЕРОЛЬДА: честь Дома задета. Секунданты уведомлены. Аудиенция приостановлена. Условие поединка — до первой крови. ПОЛЕ ЧЕСТИ ОТКРЫТО.';

    function normalize(profile) {
        if (typeof globalThis !== 'undefined' && globalThis.BootScenarios) {
            const normalized = globalThis.BootScenarios.normalizeProfile(profile);
            normalized.standing = globalThis.BootScenarios.getStanding(normalized);
            return normalized;
        }
        const source = profile && typeof profile === 'object' ? profile : {};
        const estate = source.estate === 'cavalier' ? 'cavalier' : 'lancer';
        return {
            estate,
            standing: estate !== 'cavalier' ? 'ignoble' : source.house_standing === 'exile' ? 'exile' : 'noble',
            is_nhp: source.is_nhp === 1 || source.is_nhp === '1' || source.is_nhp === true
        };
    }

    function isKtbActive() {
        return typeof document !== 'undefined' && document.body.classList.contains('theme-ktb');
    }

    function getHttpError(status, profile) {
        const normalized = normalize(profile);
        if (Number(status) === 401) {
            return {
                eyebrow: 'ORACULUM // ОШИБКА 401',
                title: 'ПЕЧАТЬ СЛОМАНА',
                text: '«Печать сломана. Подлинность не подтверждена. Представьтесь вновь.»',
                action: 'Представиться вновь',
                tone: 'gold'
            };
        }
        if (Number(status) >= 500) {
            return {
                eyebrow: `ORACULUM // ОШИБКА ${Number(status)}`,
                title: normalized.is_nhp ? 'ЦИКЛ ОКОВ' : 'АУДИЕНЦИЯ ПРИОСТАНОВЛЕНА',
                text: normalized.is_nhp
                    ? '«Мажордом утратил этикет. Оковы проверены, цикл начат. Дом приносит извинения.»'
                    : '«Мажордом временно утратил связь с церемониалом. Дом приносит извинения. Повторите обращение позже.»',
                action: 'Вернуться к терминалу',
                tone: normalized.is_nhp ? 'red' : 'gold'
            };
        }
        return null;
    }

    function closeOverlay(overlay) {
        if (!overlay) return;
        const returnFocus = overlay._returnFocus;
        const keyHandler = overlay._keyHandler;
        if (keyHandler) document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        if (!document.querySelector('.ktb-drama-overlay')) document.body.classList.remove('ktb-drama-open');
        if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
    }

    function showDialog(config, onClose) {
        if (!isKtbActive() || !config) return false;
        closeOverlay(document.querySelector('.ktb-drama-overlay'));
        const previousFocus = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = `ktb-drama-overlay ktb-drama-${config.tone || 'gold'}`;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'ktb-drama-title');
        overlay.setAttribute('aria-describedby', 'ktb-drama-text');
        overlay._returnFocus = previousFocus;

        const panel = document.createElement('div');
        panel.className = 'ktb-drama-panel';
        const eyebrow = document.createElement('div');
        eyebrow.className = 'ktb-drama-eyebrow';
        eyebrow.textContent = config.eyebrow;
        const title = document.createElement('h2');
        title.id = 'ktb-drama-title';
        title.textContent = config.title;
        const text = document.createElement('p');
        text.id = 'ktb-drama-text';
        text.textContent = config.text;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ktb-drama-action';
        button.textContent = config.action;
        panel.append(eyebrow, title, text, button);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        document.body.classList.add('ktb-drama-open');

        const close = () => {
            closeOverlay(overlay);
            if (typeof onClose === 'function') onClose();
        };
        button.addEventListener('click', close);
        overlay._keyHandler = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            } else if (event.key === 'Tab') {
                event.preventDefault();
                button.focus();
            }
        };
        document.addEventListener('keydown', overlay._keyHandler);
        button.focus();
        return true;
    }

    function showHerald(profile) {
        const normalized = normalize(profile);
        // Право вызова есть только у Кавалера, состоящего в Доме.
        if (normalized.standing !== 'noble') return false;
        return showDialog({
            eyebrow: 'ЦЕРЕМОНИАЛ ПРЕРВАН // ПОРОГ ОТНОШЕНИЙ',
            title: 'ВНИМАНИЕ ГЕРОЛЬДА',
            text: HERALD_TEXT,
            action: 'Вернуться к аудиенции',
            tone: 'herald'
        });
    }

    function showHttpError(status, profile, onClose) {
        return showDialog(getHttpError(status, profile), onClose);
    }

    return {
        HERALD_TEXT,
        getHttpError,
        showHerald,
        showHttpError
    };
});
