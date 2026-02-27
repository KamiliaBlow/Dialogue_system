import AppConfig from './config.js';

const { DEBUG } = AppConfig;

export function debug(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

export function debugGroup(label) {
    if (DEBUG) {
        console.group(`[DEBUG] ${label}`);
    }
}

export function debugGroupEnd() {
    if (DEBUG) {
        console.groupEnd();
    }
}

export function debugTime(label) {
    if (DEBUG) {
        console.time(`[DEBUG] ${label}`);
    }
}

export function debugTimeEnd(label) {
    if (DEBUG) {
        console.timeEnd(`[DEBUG] ${label}`);
    }
}

export default debug;
