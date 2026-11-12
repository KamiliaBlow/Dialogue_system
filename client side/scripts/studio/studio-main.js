// Студия: редактор диалогов и каталог персонажей в одном окне.
// Адреса: studio.html#dialogues, #dialogues/<id>, #characters, #characters/<id>, #characters/new.
// Старые editor.html и catalog.html перенаправляют сюда.
import { initShell } from '../admin/admin-shell.js';
import store from './studio-store.js';
import DialogueEditor from './dialogue-editor.js';
import CharacterCatalog from './character-catalog.js';

const MODES = ['dialogues', 'characters'];

const studio = {
    mode: 'dialogues',
    editor: null,
    catalog: null,
    applyingHash: false,

    setMode(mode) {
        if (!MODES.includes(mode)) mode = 'dialogues';
        this.mode = mode;
        document.getElementById('studio').dataset.mode = mode;
        document.querySelectorAll('[data-for]').forEach(pane => { pane.hidden = pane.dataset.for !== mode; });
        document.querySelectorAll('.studio-modes [data-mode]').forEach(tab => {
            const active = tab.dataset.mode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        this.updateHash();
    },

    openCharacter(id) {
        this.setMode('characters');
        this.catalog.openCharacter(id);
    },

    openDialogue(id) {
        this.setMode('dialogues');
        return this.editor.selectDialogue(id);
    },

    updateHash() {
        if (this.applyingHash) return;
        let hash = `#${this.mode}`;
        if (this.mode === 'dialogues' && this.editor?.currentDialogueId) hash += `/${this.editor.currentDialogueId}`;
        if (this.mode === 'characters' && this.catalog?.open) hash += `/${this.catalog.editingId ?? 'new'}`;
        if (location.hash !== hash) history.replaceState(null, '', hash);
    },

    async applyHash() {
        const [mode, id] = location.hash.replace('#', '').split('/');
        this.applyingHash = true;
        try {
            this.setMode(MODES.includes(mode) ? mode : 'dialogues');
            if (this.mode === 'dialogues' && id && id !== String(this.editor.currentDialogueId)) {
                await this.editor.selectDialogue(id);
            }
            if (this.mode === 'characters' && id) {
                this.catalog.openCharacter(id === 'new' ? null : id);
            }
        } finally {
            this.applyingHash = false;
        }
        this.updateHash();
    }
};

async function main() {
    const auth = await initShell({ page: 'studio', title: 'СТУДИЯ' });
    if (!auth) return;

    document.querySelectorAll('.studio-modes [data-mode]').forEach(tab =>
        tab.addEventListener('click', () => studio.setMode(tab.dataset.mode)));

    await Promise.all([
        store.loadCharacters().catch(error => console.error('Characters:', error)),
        store.loadFiles(),
        store.loadUsers()
    ]);

    studio.editor = new DialogueEditor(studio);
    studio.catalog = new CharacterCatalog(studio);
    studio.catalog.init();
    await studio.editor.init();

    await studio.applyHash();
    window.addEventListener('hashchange', () => studio.applyHash());
}

main();
