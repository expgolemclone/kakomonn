// ==UserScript==
// @name         ChatGPT Initial Prompt
// @namespace    local
// @version      1.4.0
// @description  ChatGPTを開いたとき,最初の1回だけ複数行プロンプトを入力し,カーソルを末尾へ移動する
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // プロンプトの上に作る空行数.
    const LEADING_BLANK_LINES = 3;

    const BASE_PROMPT = __SYSTEM_PROMPT_JSON__;

    const PROMPT = '\n'.repeat(LEADING_BLANK_LINES) + BASE_PROMPT;

    let started = false;
    let completed = false;

    const findEditor = () =>
    document.querySelector(
        '#prompt-textarea[contenteditable="true"], textarea#prompt-textarea',
    );

    const getEditorText = (editor) => {
        if (editor instanceof HTMLTextAreaElement) {
            return editor.value;
        }

        return editor.innerText;
    };

    const setTextareaText = (editor, text) => {
        const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
        )?.set;

        if (!valueSetter) {
            throw new Error('textareaのvalue setterを取得できませんでした.');
        }

        valueSetter.call(editor, text);

        editor.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: 'insertText',
                data: text,
            }),
        );
    };

    const setContentEditableText = (editor, text) => {
        editor.focus({ preventScroll: true });

        const selection = window.getSelection();
        const range = document.createRange();

        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);

        const inserted = document.execCommand('insertText', false, text);

        selection.removeAllRanges();

        if (!inserted) {
            throw new Error('プロンプトを入力できませんでした.');
        }
    };

    const placeCaretAtEnd = (editor) => {
        editor.focus({ preventScroll: true });

        if (editor instanceof HTMLTextAreaElement) {
            const end = editor.value.length;
            editor.setSelectionRange(end, end);
            editor.scrollTop = editor.scrollHeight;
            return;
        }

        const selection = window.getSelection();
        const range = document.createRange();

        range.selectNodeContents(editor);
        range.collapse(false);

        selection.removeAllRanges();
        selection.addRange(range);
        editor.scrollTop = editor.scrollHeight;
    };

    const stabilizeCaretAtEnd = (editor) => {
        placeCaretAtEnd(editor);

        requestAnimationFrame(() => {
            placeCaretAtEnd(editor);

            requestAnimationFrame(() => {
                placeCaretAtEnd(editor);
            });
        });

        setTimeout(() => {
            placeCaretAtEnd(editor);
        }, 100);
    };

    const insertPrompt = (editor) => {
        if (editor instanceof HTMLTextAreaElement) {
            setTextareaText(editor, PROMPT);
        } else if (editor instanceof HTMLElement && editor.isContentEditable) {
            setContentEditableText(editor, PROMPT);
        } else {
            throw new Error('対応していない入力欄です.');
        }

        stabilizeCaretAtEnd(editor);
    };

    const observer = new MutationObserver(() => {
        insertOnce();
    });

    const finish = () => {
        completed = true;
        observer.disconnect();
    };

    function insertOnce() {
        if (completed) {
            return;
        }

        const editor = findEditor();

        if (!editor) {
            return;
        }

        // 既に文章が入力されている場合は上書きしない.
        if (getEditorText(editor).trim() !== '') {
            finish();
            return;
        }

        try {
            insertPrompt(editor);
        } finally {
            finish();
        }
    }

    const start = () => {
        if (started || !document.documentElement) {
            return;
        }

        started = true;

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        insertOnce();
    };

    document.addEventListener('DOMContentLoaded', start, { once: true });
    start();
})();
