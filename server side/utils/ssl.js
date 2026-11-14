// SSL-сертификат HTTPS-сервера.
//
// Зачем: certbot кладёт рядом несколько файлов — cert.pem (только сертификат сайта),
// chain.pem (промежуточный сертификат Let's Encrypt) и fullchain.pem (оба). Если отдавать
// браузеру один cert.pem, часть устройств (часто Android) не может достроить цепочку до
// корня и выдаёт ERR_CERT_AUTHORITY_INVALID, хотя на других всё открывается.
//
// Что делает модуль:
//  - берёт полную цепочку: настроенный файл, а если в нём только сертификат сайта —
//    fullchain.pem из той же папки или cert.pem + chain.pem;
//  - при запуске проверяет: ключ подходит к сертификату, цепочка полная и связная,
//    срок действия; понятно пишет, что не так;
//  - сам перечитывает сертификат, когда файлы в папке обновились (продление certbot),
//    без перезапуска сервера.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const WARN_DAYS = 14;
const RECHECK_MS = 6 * 60 * 60 * 1000;   // запасная проверка, если наблюдение за папкой молчит
const DEBOUNCE_MS = 3000;                // certbot и копирование пишут файлы не одновременно

const splitCerts = pem => pem.match(PEM_CERT) || [];
const readIfExists = file => (file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function siblings(certPath) {
    const dir = path.dirname(certPath);
    return { dir, fullchain: path.join(dir, 'fullchain.pem'), chain: path.join(dir, 'chain.pem') };
}

// Есть ли из чего поднять HTTPS: ключ и хоть какой-то сертификат.
function isAvailable(keyPath, certPath) {
    return fs.existsSync(keyPath) && (fs.existsSync(certPath) || fs.existsSync(siblings(certPath).fullchain));
}

/**
 * Читает ключ и сертификат с полной цепочкой и проверяет их.
 * Бросает ошибку, если HTTPS поднять нельзя (нет файлов, ключ не от этого сертификата).
 * @returns {{ key: string, cert: string, sources: string[], certCount: number,
 *             subject: string, validTo: Date, daysLeft: number, warnings: string[] }}
 */
function load(keyPath, certPath) {
    const key = readIfExists(keyPath);
    if (!key) throw new Error(`не найден закрытый ключ: ${keyPath}`);

    const near = siblings(certPath);
    let certPem = readIfExists(certPath);
    let sources = certPem ? [certPath] : [];

    // Только сертификат сайта — ищем полную цепочку рядом.
    if (!certPem || splitCerts(certPem).length < 2) {
        const fullchain = path.resolve(near.fullchain) !== path.resolve(certPath) ? readIfExists(near.fullchain) : null;
        const chain = readIfExists(near.chain);
        if (fullchain && splitCerts(fullchain).length >= 2) {
            certPem = fullchain;
            sources = [near.fullchain];
        } else if (certPem && chain && splitCerts(chain).length >= 1) {
            certPem = `${certPem.trim()}\n${chain.trim()}\n`;
            sources = [certPath, near.chain];
        } else if (!certPem && fullchain) {
            certPem = fullchain;
            sources = [near.fullchain];
        }
    }
    if (!certPem) throw new Error(`не найден сертификат: ${certPath} (и нет ${near.fullchain})`);

    const pems = splitCerts(certPem);
    if (!pems.length) throw new Error(`в ${sources.join(' + ')} нет ни одного сертификата`);
    const certs = pems.map(pem => new crypto.X509Certificate(pem));
    const leaf = certs[0];

    let keyObject;
    try {
        keyObject = crypto.createPrivateKey(key);
    } catch (e) {
        throw new Error(`не удалось прочитать закрытый ключ ${keyPath}: ${e.message}`);
    }
    if (!leaf.checkPrivateKey(keyObject)) {
        throw new Error(`ключ ${path.basename(keyPath)} не подходит к сертификату ${path.basename(sources[0])} — файлы от разных выпусков сертификата`);
    }

    const warnings = [];
    if (certs.length < 2) {
        warnings.push('в сертификате нет промежуточного звена (только сертификат сайта). '
            + 'На части устройств браузер покажет ERR_CERT_AUTHORITY_INVALID. '
            + `Положите в ${near.dir} файл fullchain.pem (или chain.pem) из certbot.`);
    }
    for (let i = 0; i < certs.length - 1; i++) {
        if (!certs[i].checkIssued(certs[i + 1])) {
            warnings.push(`звено ${i + 2} цепочки не является издателем звена ${i + 1}: `
                + 'промежуточный сертификат не от этого выпуска (устаревший chain.pem?). '
                + 'Возьмите свежий fullchain.pem из certbot.');
            break;
        }
    }

    const validTo = new Date(leaf.validTo);
    const daysLeft = Math.floor((validTo - Date.now()) / 86400000);
    if (daysLeft < 0) {
        warnings.push(`сертификат ИСТЁК ${validTo.toLocaleDateString('ru-RU')} — браузеры не откроют сайт. Продлите его в certbot и положите новые файлы в ${near.dir}.`);
    } else if (daysLeft < WARN_DAYS) {
        warnings.push(`сертификат истекает через ${daysLeft} дн. (${validTo.toLocaleDateString('ru-RU')}). `
            + `После продления в certbot скопируйте новые файлы в ${near.dir} — сервер подхватит их сам.`);
    }

    const subject = (leaf.subjectAltName || leaf.subject || '').replace(/DNS:/g, '').trim();
    return { key, cert: certPem, sources, certCount: certs.length, subject, validTo, daysLeft, warnings };
}

// Строки для консоли при запуске и перечитывании.
function describe(state) {
    const chain = state.certCount >= 2 ? `полная цепочка (${state.certCount} серт.)` : 'БЕЗ промежуточного звена';
    const mark = state.warnings.length ? '•' : '✓';
    const lines = [`${mark} SSL: ${state.subject || 'сертификат'} · ${chain} · до ${state.validTo.toLocaleDateString('ru-RU')} (осталось ${state.daysLeft} дн.)`,
        `  файлы: ${state.sources.map(s => path.basename(s)).join(' + ')}`];
    state.warnings.forEach(w => lines.push(`⚠ SSL: ${w}`));
    return lines;
}

function fingerprint(keyPath, certPath) {
    const near = siblings(certPath);
    return [keyPath, certPath, near.fullchain, near.chain].map(file => {
        try {
            const st = fs.statSync(file);
            return `${st.size}:${st.mtimeMs}`;
        } catch {
            return '-';
        }
    }).join('|');
}

/**
 * Следит за папкой сертификата и подменяет его на лету (server.setSecureContext),
 * когда файлы изменились. Битые или недописанные файлы не применяются: работает старый.
 * log(level, message) — level: 'info' | 'warn'.
 */
function watch(server, keyPath, certPath, log, initialState) {
    let last = fingerprint(keyPath, certPath);
    let lastWarnDay = null;
    let timer = null;

    const check = () => {
        timer = null;
        const now = fingerprint(keyPath, certPath);
        if (now === last) return;
        try {
            const state = load(keyPath, certPath);
            server.setSecureContext({ key: state.key, cert: state.cert });
            last = now;
            log('info', 'Сертификат обновлён без перезапуска сервера.');
            describe(state).forEach(line => log(line.startsWith('⚠') ? 'warn' : 'info', line));
        } catch (e) {
            log('warn', `⚠ SSL: файлы сертификата изменились, но не применены (${e.message}). Работает прежний сертификат.`);
        }
    };
    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(check, DEBOUNCE_MS);
    };

    try {
        // Полный путь: на Windows наблюдение за коротким именем (C:\USERS~1\...) роняет процесс в libuv.
        const dir = fs.realpathSync.native(siblings(certPath).dir);
        const watcher = fs.watch(dir, schedule);
        watcher.on('error', () => {});
        watcher.unref?.();
    } catch {
        // Наблюдение недоступно — остаётся периодическая проверка.
    }

    // Раз в несколько часов: на случай, если наблюдение за папкой не сработало,
    // и напоминание о скором окончании срока (не чаще раза в день).
    const interval = setInterval(() => {
        check();
        try {
            const state = load(keyPath, certPath);
            const day = new Date().toDateString();
            if (state.daysLeft < WARN_DAYS && lastWarnDay !== day) {
                lastWarnDay = day;
                state.warnings.filter(w => /истека|ИСТЁК/.test(w)).forEach(w => log('warn', `⚠ SSL: ${w}`));
            }
        } catch { /* сообщит check() при изменении файлов */ }
    }, RECHECK_MS);
    interval.unref?.();

    if (initialState && initialState.daysLeft < WARN_DAYS) lastWarnDay = new Date().toDateString();
    return { check, stop: () => clearInterval(interval) };
}

module.exports = { isAvailable, load, describe, watch, splitCerts };
