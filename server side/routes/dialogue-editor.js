// Роуты редактора (/api/editor/*). Разделены по ответственности, API не изменился:
//  - editor/dialogues.js  — диалоги, их персонажи, реплики, ветки, выборы, экспорт;
//  - editor/characters.js — каталог персонажей и отношения игроков;
//  - editor/files.js      — списки и загрузка медиафайлов;
//  - briefings.js         — брифинги: сценарии, доступ, прослушивания, звуки.
const express = require('express');
const dialoguesRoutes = require('./editor/dialogues');
const charactersRoutes = require('./editor/characters');
const filesRoutes = require('./editor/files');
const { editorRoutes:briefingRoutes } = require('./briefings');

const dialogueEditorRoutes = (db, upload) => {
    const router = express.Router();
    router.use(dialoguesRoutes(db, upload));
    router.use(charactersRoutes(db, upload));
    router.use(filesRoutes(db, upload));
    router.use(briefingRoutes(db));
    return router;
};

module.exports = dialogueEditorRoutes;
