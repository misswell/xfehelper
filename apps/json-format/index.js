/**
 * XFeHelper Json Format Tools
 */

import { buildRenderableTableViewData, canBuildTableViewData } from './table-utils.js';

// 一些全局变量
let editor = {};
let LOCAL_KEY_OF_LAYOUT = 'local-layout-key';
let JSON_LINT = 'jsonformat:json-lint-switch';
let EDIT_ON_CLICK = 'jsonformat:edit-on-click';
let AUTO_DECODE = 'jsonformat:auto-decode';
let JSON_WINDOW_NOTE = 'jsonformat:window-note';
let FH_UI_MODE = 'FH_UI_MODE';
let JSON_FORMAT_UI_MODE = 'JSON_FORMAT_UI_MODE';


function syncJsonPageDarkMode(enabled) {
    document.body.classList.toggle('theme-dark', !!enabled);
    document.body.classList.toggle('theme-default', !enabled);
    document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
}

function syncJsonPageUiMode(mode) {
    const isLiteMode = mode !== 'omni';
    document.body.classList.toggle('fh-ui-mode-lite', isLiteMode);
    document.body.classList.toggle('fh-ui-mode-omni', !isLiteMode);
}

new Vue({
    el: '#pageContainer',
    data: {
        defaultResultTpl: '<div class="x-placeholder"><div class="fh-empty-state"><div class="fh-empty-mark">JSON</div><strong>粘贴 JSON 后自动格式化</strong><p>支持 BigInt、JSONP、嵌套转义解析和 JSONPath 提取。</p></div></div>',
        placeHolder: '',
        jsonFormattedSource: '',
        errorMsg: '',
        jsonActionReady: false,
        tableViewReady: false,
        errorJsonCode: '',
        errorPos: '',
        jfCallbackName_start: '',
        jfCallbackName_end: '',
        jsonLintSwitch: true,
        autoDecode: false,
        fireChange: true,
        overrideJson: false,
        nestedEscapeParse: false,
        nodeEditSnapshot: '',
        nodeEditActive: false,
        currentLayout: 'left-right',
        uiMode: 'lite',
        windowNote: '',
        windowNoteEditorOpen: false,
        sortType: '0',
        // JSONPath查询相关
        jsonPathQuery: '',
        showJsonPathModal: false,
        showJsonPathExamplesModal: false,
        jsonPathResults: [],
        jsonPathError: '',
        copyButtonState: 'normal', // normal, copying, success, error
        jsonPathCopyNotice: '',
        jsonPathCopyNoticeTimer: null,
        showTableViewModal: false,
        tableViewError: '',
        tableViewMode: 'grid',
        tableViewTitle: '',
        tableViewSourcePath: '',
        tableViewColumns: [],
        tableViewRows: [],
        jsonPathExamples: [
            { path: '$', description: '根对象（类似 jq: .）' },
            { path: '$.data', description: '获取data属性（类似 jq: .data）' },
            { path: '$.data.*', description: '获取data下的所有属性' },
            { path: '$.data[0]', description: '获取data数组的第一个元素' },
            { path: '$.data[*]', description: '获取data数组的所有元素（类似 jq: .data[]）' },
            { path: '$.data[?(@.name)]', description: '获取data数组中有name属性的元素' },
            { path: '$..name', description: '递归查找所有name属性' },
            { path: '$.data[0:3]', description: '获取data数组的前3个元素' },
            { path: '$.data[-1]', description: '获取data数组的最后一个元素' },
            { path: '$.*.price', description: '获取所有子对象的price属性' }
        ]
    },
    mounted: function () {
        // JSON 工具有原生暗色主题，优先使用主题类，避免全局反色滤镜影响语法高亮。
        if (window.DarkModeMgr && DarkModeMgr.watchAutoDarkMode) {
            DarkModeMgr.watchAutoDarkMode(syncJsonPageDarkMode, {applyFilter: false});
        } else if (window.chrome && chrome.runtime && window.DarkModeMgr) {
            DarkModeMgr.turnLightAuto();
        }

        this.setResultPlaceholder(this.defaultResultTpl);

        // 安全获取localStorage值（在沙盒环境中可能不可用）
        this.autoDecode = this.safeGetLocalStorage(AUTO_DECODE) === 'true';

        this.jsonLintSwitch = (this.safeGetLocalStorage(JSON_LINT) !== 'false');
        this.overrideJson = (this.safeGetLocalStorage(EDIT_ON_CLICK) === 'true');
        this.nestedEscapeParse = (this.safeGetLocalStorage('jsonformat:nested-escape-parse') === 'true');
        this.currentLayout = this.normalizeLayout(this.safeGetLocalStorage(LOCAL_KEY_OF_LAYOUT));
        this.windowNote = this.safeGetSessionStorage(JSON_WINDOW_NOTE) || '';
        this.syncWindowNote();
        this.changeLayout(this.currentLayout);
        this.loadUiMode();

        editor = CodeMirror.fromTextArea(this.$refs.jsonBox, {
            mode: "text/javascript",
            lineNumbers: true,
            matchBrackets: true,
            styleActiveLine: true,
            lineWrapping: true
        });

        //输入框聚焦
        editor.focus();

        // 格式化以后的JSON，点击以后可以重置原内容
        window._OnJsonItemClickByFH = (jsonTxt) => {
            if (this.overrideJson) {
                this.enterNodeEdit(jsonTxt);
            }
        };
        editor.on('change', (editor, changes) => {
            this.fireChange && this.format();
        });

        // 在tab创建或者更新时候，监听事件，看看是否有参数传递过来
        if (location.protocol === 'chrome-extension:') {
            chrome.tabs.query({currentWindow: true,active: true, }, (tabs) => {
                let activeTab = tabs.filter(tab => tab.active)[0];
                chrome.runtime.sendMessage({
                    type: 'fh-dynamic-any-thing',
                    thing: 'request-page-content',
                    tabId: activeTab.id
                }).then(resp => {
                    if(!resp || !resp.content) return ;
                    editor.setValue(resp.content || '');
                    this.format();
                });
            });
        }

        // 页面加载时自动获取并注入json-format页面的补丁
        this.loadPatchHotfix();
        document.addEventListener('keydown', this.handleGlobalKeydown, true);
        document.addEventListener('click', this.handleWindowNoteOutsideClick, true);
    },
    beforeDestroy: function () {
        document.removeEventListener('keydown', this.handleGlobalKeydown, true);
        document.removeEventListener('click', this.handleWindowNoteOutsideClick, true);
        window.clearTimeout(this.jsonPathCopyNoticeTimer);
    },
    computed: {
        sortLabel() {
            return {
                '0': '默认',
                '1': '升序',
                '-1': '降序'
            }[String(this.sortType)] || '默认';
        }
    },
    methods: {
        handleGlobalKeydown(event) {
            if (!event || event.key !== 'Escape') {
                return;
            }

            let handled = false;
            if (this.windowNoteEditorOpen) {
                this.closeWindowNoteEditor();
                handled = true;
            } else if (this.showJsonPathExamplesModal) {
                this.closeJsonPathExamplesModal();
                handled = true;
            } else if (this.showTableViewModal) {
                this.closeTableViewModal();
                handled = true;
            } else if (this.showJsonPathModal) {
                this.closeJsonPathModal();
                handled = true;
            }

            if (!handled) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation && event.stopImmediatePropagation();
        },

        setResultPlaceholder(html) {
            this.placeHolder = html || '';
            const resultEl = document.querySelector('#jfContent');
            if (resultEl) {
                resultEl.innerHTML = this.placeHolder;
            }
        },

        escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        buildErrorPlaceholder(message) {
            const currentValue = editor && typeof editor.getValue === 'function' ? editor.getValue() : '';
            const escapedMessage = this.escapeHtml(message);
            const nestedHint = this.nestedEscapeParse
                ? '<li>当前已开启“嵌套解析”，如果接口返回的是普通字符串，可先关闭后重试。</li>'
                : '';
            const rawHint = currentValue.trim()
                ? '<li>原文已保留在左侧输入框，可按错误位置修正。</li>'
                : '';
            return [
                '<div class="fh-error-state">',
                '  <div class="fh-error-badge">解析失败</div>',
                '  <strong>当前内容没有稳定解析成可展示的 JSON 结构。</strong>',
                `  <p class="fh-error-message">${escapedMessage}</p>`,
                '  <ul class="fh-error-hints">',
                '    <li>如果接口混入了前缀、注释或半截响应，先看原文最稳。</li>',
                nestedHint,
                rawHint,
                '  </ul>',
                '</div>'
            ].join('');
        },

        setResultActionAvailability(enabled) {
            if (typeof window !== 'undefined') {
                window.__fhJsonResultActionsEnabled = !!enabled;
            }
            if (!enabled) {
                this.clearOptionBar();
            }
        },

        clearOptionBar() {
            const optionBar = document.querySelector('#optionBar');
            if (optionBar) {
                optionBar.innerHTML = '';
                optionBar.style.display = 'none';
            }
        },

        resetResultActions() {
            this.jsonActionReady = false;
            this.tableViewReady = false;
            this.setResultActionAvailability(false);
            this.resetTableViewState();
        },

        resetTableViewState() {
            this.showTableViewModal = false;
            this.tableViewError = '';
            this.tableViewTitle = '';
            this.tableViewSourcePath = '';
            this.tableViewColumns = [];
            this.tableViewRows = [];
            this.tableViewMode = 'grid';
        },

        syncResultActions(source) {
            this.resetResultActions();
            if (!source || this.errorMsg) {
                return;
            }
            try {
                const jsonObj = parseWithBigInt(source);
                this.jsonActionReady = jsonObj !== null && typeof jsonObj === 'object';
                this.tableViewReady = this.jsonActionReady && canBuildTableViewData(jsonObj);
                this.setResultActionAvailability(this.jsonActionReady && !this.errorMsg);
            } catch (_) {
                this.resetResultActions();
            }
        },

        loadUiMode() {
            if (!window.chrome || !chrome.storage || !chrome.storage.local) {
                syncJsonPageUiMode(this.uiMode);
                return;
            }
            chrome.storage.local.get([JSON_FORMAT_UI_MODE, FH_UI_MODE], result => {
                this.uiMode = String(result[JSON_FORMAT_UI_MODE] || result[FH_UI_MODE] || '').toLowerCase() === 'omni' ? 'omni' : 'lite';
                syncJsonPageUiMode(this.uiMode);
                this.$nextTick(() => {
                    this.changeLayout(this.currentLayout);
                });
            });
        },

        setUiMode(mode) {
            this.uiMode = mode === 'omni' ? 'omni' : 'lite';
            syncJsonPageUiMode(this.uiMode);
            this.$nextTick(() => {
                this.changeLayout(this.currentLayout);
            });
            if (window.chrome && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({
                    [JSON_FORMAT_UI_MODE]: this.uiMode
                });
            }
        },

        normalizeLayout(type) {
            return type === 'up-down' ? 'up-down' : 'left-right';
        },

        setNestedEscapeParse(enabled) {
            this.nestedEscapeParse = !!enabled;
            this.safeSetLocalStorage('jsonformat:nested-escape-parse', this.nestedEscapeParse);
            this.format();
        },

        retryWithoutNestedEscapeParse() {
            if (!this.nestedEscapeParse) {
                return;
            }
            this.setNestedEscapeParse(false);
        },

        // 安全的JSON.stringify：
        // - 让 BigInt 在最终字符串中显示为未加引号的纯数字（用于显示与再解析）
        // - 普通 number 若为科学计数法，转为完整字符串（仍是数字）
        // - BigNumberLike（json-bigint 对长小数的表示）转换为普通数字文本，避免输出 {s,e,c}
        safeStringify(obj, space) {
            if (
                typeof window !== 'undefined' &&
                window.FHJsonAutoUtils &&
                typeof window.FHJsonAutoUtils.safeStringify === 'function'
            ) {
                return window.FHJsonAutoUtils.safeStringify(obj, space);
            }

            const tagged = JSON.stringify(obj, function(key, value) {
                if (typeof value === 'bigint') {
                    // 用占位符标记，稍后去掉外层引号
                    return `__FH_BIGINT__${value.toString()}`;
                }
                if (typeof value === 'number' && value.toString().includes('e')) {
                    // 转成完整字符串，再在末尾转换为数字文本（通过占位）
                    return `__FH_NUMSTR__${value.toLocaleString('fullwide', {useGrouping: false})}`;
                }
                if (value && typeof value === 'object' && typeof value.s === 'number' && typeof value.e === 'number' && Array.isArray(value.c)) {
                    let numText = '';
                    try {
                        if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
                            const result = value.toString();
                            if (typeof result === 'string' && result !== '[object Object]') {
                                numText = result;
                            }
                        }
                    } catch (_) {}
                    if (!numText) {
                        const sign = value.s < 0 ? '-' : '';
                        const CHUNK_SIZE = 14;
                        let digits = '';
                        for (let i = 0; i < value.c.length; i++) {
                            let chunkStr = Math.abs(value.c[i]).toString();
                            if (i > 0) chunkStr = chunkStr.padStart(CHUNK_SIZE, '0');
                            digits += chunkStr;
                        }
                        digits = digits.replace(/^0+/, '') || '0';
                        const decimalIndex = value.e + 1;
                        if (decimalIndex <= 0) {
                            const zeros = '0'.repeat(Math.abs(decimalIndex));
                            let fraction = (zeros + digits).replace(/0+$/, '');
                            numText = fraction ? (sign + '0.' + fraction) : (sign + '0');
                        } else if (decimalIndex >= digits.length) {
                            numText = sign + digits + '0'.repeat(decimalIndex - digits.length);
                        } else {
                            const intPart = digits.slice(0, decimalIndex);
                            let fracPart = digits.slice(decimalIndex).replace(/0+$/, '');
                            numText = fracPart ? (sign + intPart + '.' + fracPart) : (sign + intPart);
                        }
                    }
                    return `__FH_BIGNUM__${numText}`;
                }
                return value;
            }, space);
            // 去掉占位符外层引号，恢复为裸数字文本
            return tagged
                .replace(/"__FH_BIGINT__(-?\d+)"/g, '$1')
                .replace(/"__FH_NUMSTR__(-?\d+)"/g, '$1')
                .replace(/"__FH_BIGNUM__(-?\d+(?:\.\d+)?)"/g, '$1')
                .replace(/"__FH_PRESERVE_INTEGER_KEY__(\d+)":/g, '"$1":');
        },
        // 安全获取localStorage值（在沙盒环境中可能不可用）
        safeGetLocalStorage(key) {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                console.warn('localStorage不可用，使用默认值:', key);
                return null;
            }
        },

        // 安全设置localStorage值（在沙盒环境中可能不可用）
        safeSetLocalStorage(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn('localStorage不可用，跳过保存:', key);
            }
        },

        safeGetSessionStorage(key) {
            try {
                return sessionStorage.getItem(key);
            } catch (e) {
                console.warn('sessionStorage不可用，使用默认值:', key);
                return null;
            }
        },

        safeSetSessionStorage(key, value) {
            try {
                sessionStorage.setItem(key, value);
            } catch (e) {
                console.warn('sessionStorage不可用，跳过保存:', key);
            }
        },

        safeRemoveSessionStorage(key) {
            try {
                sessionStorage.removeItem(key);
            } catch (e) {
                console.warn('sessionStorage不可用，跳过删除:', key);
            }
        },

        syncWindowNote() {
            const note = String(this.windowNote || '').trim().slice(0, 48);
            if (note !== this.windowNote) {
                this.windowNote = note;
            }
            if (note) {
                this.safeSetSessionStorage(JSON_WINDOW_NOTE, note);
                document.title = note + ' - JSON 格式化工具';
            } else {
                this.safeRemoveSessionStorage(JSON_WINDOW_NOTE);
                document.title = 'JSON 格式化工具';
            }
        },

        toggleWindowNoteEditor() {
            this.windowNoteEditorOpen = !this.windowNoteEditorOpen;
            if (this.windowNoteEditorOpen) {
                this.$nextTick(() => {
                    if (this.$refs.jsonWindowNote) {
                        this.$refs.jsonWindowNote.focus();
                        this.$refs.jsonWindowNote.select();
                    }
                });
            }
        },

        closeWindowNoteEditor() {
            this.windowNoteEditorOpen = false;
        },

        clearWindowNote() {
            this.windowNote = '';
            this.syncWindowNote();
            this.$nextTick(() => {
                if (this.$refs.jsonWindowNote) {
                    this.$refs.jsonWindowNote.focus();
                }
            });
        },

        handleWindowNoteOutsideClick(event) {
            if (!this.windowNoteEditorOpen) {
                return;
            }
            const target = event && event.target;
            const control = document.querySelector('.fh-window-note-control');
            if (control && target && control.contains(target)) {
                return;
            }
            this.closeWindowNoteEditor();
        },

        handleSortChange() {
            this.$nextTick(() => {
                this.format();
            });
        },

        loadPatchHotfix() {
            if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                return;
            }
            // 页面加载时自动获取并注入页面的补丁
            chrome.runtime.sendMessage({
                type: 'fh-dynamic-any-thing',
                thing: 'fh-get-tool-patch',
                toolName: 'json-format'
            }, patch => {
                if (patch) {
                    if (patch.css) {
                        const style = document.createElement('style');
                        style.textContent = patch.css;
                        document.head.appendChild(style);
                    }
                    if (patch.js && typeof patch.js === 'string' && patch.js.length < 50000) {
                        try {
                            new Function(patch.js)();
                        } catch (e) {
                            console.error('json-format补丁JS执行失败', e);
                        }
                    }
                }
            });
        },

        getJsonResultText() {
            if (this.errorMsg) {
                return this.errorMsg;
            }
            const pre = document.querySelector('#jfContent_pre');
            if (pre && pre.textContent.trim()) {
                return pre.textContent.trim();
            }
            const content = document.querySelector('#jfContent');
            return content ? content.textContent.trim() : '';
        },

        format: function () {
            this.errorMsg = '';
            this.jsonFormattedSource = '';
            this.resetResultActions();
            this.setResultPlaceholder(this.defaultResultTpl);
            this.jfCallbackName_start = '';
            this.jfCallbackName_end = '';

            let source = editor.getValue().replace(/\n/gm, ' ');
            if (!source) {
                return false;
            }

            // JSONP形式下的callback name
            let funcName = null;
            // json对象
            let jsonObj = null;

            // 下面校验给定字符串是否为一个合法的json（优先：宽松修正 + BigInt 安全解析）
            try {
                // 再看看是不是jsonp的格式
                let reg = /^([\w\.]+)\(\s*([\s\S]*)\s*\)$/igm;
                let matches = reg.exec(source);
                if (matches != null) {
                    funcName = matches[1];
                    source = matches[2];
                }
                jsonObj = parseWithBigInt(source);
            } catch (ex) {
                // 兜底：仅当 BigInt 安全解析失败时，才尝试 eval 系列
                try {
                    jsonObj = new Function("return " + source)();
                } catch (exx) {
                    try {
                        jsonObj = new Function("return '" + source + "'")();
                        if (typeof jsonObj === 'string') {
                            try {
                                jsonObj = parseWithBigInt(jsonObj);
                            } catch (ie) {
                                jsonObj = new Function("return " + jsonObj)();
                            }
                        }
                } catch (exxx) {
                        this.errorMsg = exxx.message;
                        // 常见场景：Windows 路径等包含未转义反斜杠，JSON.parse 会报 Invalid escape / Unexpected token
                        try {
                            const msg = String(this.errorMsg || '');
                            if (
                                (msg.includes('Invalid escape') || msg.includes('Unexpected token') || msg.includes('Bad escaped character')) &&
                                source.includes('\\')
                            ) {
                                this.errorMsg +=
                                    '（提示：JSON 字符串中的反斜杠需要写成 \\\\。例如 Windows 路径应写为 "C:\\\\a\\\\b"；请贴出可复制的原始 JSON 文本以便确认）';
                            }
                        } catch (_) {}
                    }
                }
            }

            if (!this.errorMsg.length && this.nestedEscapeParse && typeof jsonObj === 'string') {
                jsonObj = unpackTopLevelEscapedJSON(jsonObj);
            }

            // 是json格式，可以进行JSON自动格式化
            if (jsonObj != null && typeof jsonObj === "object" && !this.errorMsg.length) {
                try {
                    // 嵌套转义解析：深度解析字符串值中的JSON
                    if (this.nestedEscapeParse && jsonObj != null && typeof jsonObj === 'object') {
                        jsonObj = deepParseJSONStrings(jsonObj);
                    }
                    
                    const selectedSortInput = document.querySelector('[name="jsonsort"]:checked');
                    const sortType = String(this.sortType || (selectedSortInput ? selectedSortInput.value : '0'));
                    if (sortType !== '0') {
                        jsonObj = JsonABC.sortObj(jsonObj, parseInt(sortType), true);
                    }
                    
                    // 关闭转义功能（因为已经深度解析为实际JSON了）
                    if (typeof window.Formatter !== 'undefined' && window.Formatter.setEscapeEnabled) {
                        window.Formatter.setEscapeEnabled(false);
                    }
                    
                    source = this.safeStringify(jsonObj);
                } catch (ex) {
                    // 通过JSON反解不出来的，一定有问题
                    this.errorMsg = ex.message;
                }

                if (!this.errorMsg.length) {

                    if (this.autoDecode) {
                        (async () => {
                            let txt = await JsonEnDecode.urlDecodeByFetch(source);
                            source = JsonEnDecode.uniDecode(txt);
                            await Formatter.format(source, null, this.escapeJsonString);
                        })();
                    } else {
                        (async () => {
                            await Formatter.format(source, null, this.escapeJsonString);
                        })();
                    }

                    this.placeHolder = '';
                    this.jsonFormattedSource = source;
                    this.syncResultActions(source);

                    // 如果是JSONP格式的，需要把方法名也显示出来
                    if (funcName != null) {
                        this.jfCallbackName_start = funcName + '(';
                        this.jfCallbackName_end = ')';
                    } else {
                        this.jfCallbackName_start = '';
                        this.jfCallbackName_end = '';
                    }

                    this.$nextTick(() => {
                        this.updateWrapperHeight();
                    })
                }
            }

            if (this.errorMsg.length) {
                if (this.jsonLintSwitch) {
                    return this.lintOn();
                } else {
                    this.setResultPlaceholder(this.buildErrorPlaceholder(this.errorMsg));
                    return false;
                }
            }

            return true;
        },

        compress: function () {
            if (this.format()) {
                let jsonTxt = this.jfCallbackName_start + this.jsonFormattedSource + this.jfCallbackName_end;
                this.disableEditorChange(jsonTxt);
            }
        },

        autoDecodeFn: function () {
            this.$nextTick(() => {
                this.safeSetLocalStorage(AUTO_DECODE, this.autoDecode);
                this.format();
            });
        },

        uniEncode: function () {
            editor.setValue(JsonEnDecode.uniEncode(editor.getValue()));
        },

        uniDecode: function () {
            editor.setValue(JsonEnDecode.uniDecode(editor.getValue()));
        },

        urlDecode: function () {
            JsonEnDecode.urlDecodeByFetch(editor.getValue()).then(text => editor.setValue(text));
        },

        updateWrapperHeight: function () {
            let curLayout = this.safeGetLocalStorage(LOCAL_KEY_OF_LAYOUT);
            let elPc = document.querySelector('#pageContainer');
            if (!elPc) {
                return;
            }
            if (curLayout === 'up-down') {
                elPc.style.height = 'auto';
            } else {
                elPc.style.height = '100dvh';
            }
        },

        changeLayout: function (type) {
            let elPc = document.querySelector('#pageContainer');
            type = this.normalizeLayout(type);
            this.currentLayout = type;
            if (!elPc) {
                return;
            }
            if (type === 'up-down') {
                elPc.classList.remove('layout-left-right');
                elPc.classList.add('layout-up-down');
            } else {
                elPc.classList.remove('layout-up-down');
                elPc.classList.add('layout-left-right');
            }
            this.safeSetLocalStorage(LOCAL_KEY_OF_LAYOUT, type);
            this.updateWrapperHeight();
            this.$nextTick(() => {
                if (editor && typeof editor.refresh === 'function') {
                    editor.refresh();
                }
            });
        },

        setCache: function () {
            this.$nextTick(() => {
                this.safeSetLocalStorage(EDIT_ON_CLICK, this.overrideJson);
            });
        },

        enterNodeEdit: function (jsonTxt) {
            const currentValue = editor && typeof editor.getValue === 'function' ? editor.getValue() : '';
            if (!this.nodeEditActive) {
                this.nodeEditSnapshot = currentValue;
            }
            this.nodeEditActive = true;
            this.disableEditorChange(jsonTxt);
        },

        restoreNodeEditSource: function () {
            if (!this.nodeEditActive || !this.nodeEditSnapshot) {
                return;
            }
            const source = this.nodeEditSnapshot;
            this.nodeEditActive = false;
            this.nodeEditSnapshot = '';
            this.disableEditorChange(source);
            this.$nextTick(() => {
                this.$nextTick(() => {
                    this.format();
                });
            });
        },

        lintOn: function () {
            this.$nextTick(() => {
                this.safeSetLocalStorage(JSON_LINT, this.jsonLintSwitch);
            });
            if (!editor.getValue().trim()) {
                return true;
            }
            this.$nextTick(() => {
                if (!this.jsonLintSwitch) {
                    return;
                }
                const raw = editor.getValue();
                let lintResult = JsonLint.lintDetect(raw);
                if (!isNaN(lintResult.line)) {
                    let backslashHint = '';
                    try {
                        const lines = String(raw).split(/\r?\n/);
                        const lineText = lines[lintResult.line] || '';
                        const ch = lineText[lintResult.col] || '';
                        if (String(raw).includes('\\') && (ch === '\\' || lineText.includes('\\'))) {
                            backslashHint =
                                '<div style="margin-top:8px;color:#b94a48;">' +
                                '提示：JSON 字符串中的反斜杠需要写成 <code>\\\\</code>。例如 Windows 路径应写为：<code>\"C:\\\\a\\\\b\"</code>' +
                                '</div>';
                        }
                    } catch (_) {}
                    this.setResultPlaceholder('<div id="errorTips">' +
                        '<div id="tipsBox">错误位置：' + (lintResult.line + 1) + '行，' + (lintResult.col + 1) + '列；缺少字符或字符不正确</div>' +
                        backslashHint +
                        '<div id="errorCode">' + lintResult.dom + '</div></div>');
                } else if (this.errorMsg) {
                    this.setResultPlaceholder(this.buildErrorPlaceholder(this.errorMsg));
                }
            });
            return false;
        },

        disableEditorChange: function (jsonTxt) {
            this.fireChange = false;
            this.$nextTick(() => {
                editor.setValue(jsonTxt);
                this.$nextTick(() => {
                    this.fireChange = true;
                })
            })
        },

        openOptionsPage: function(event){
            event.preventDefault();
            event.stopPropagation();
            chrome.runtime.openOptionsPage();
        },

        setDemo: function () {
            let demo = '{"BigIntSupported":995815895020119788889,"date":"20180322","url":"https://www.baidu.com?wd=fehelper","img":"http://gips0.baidu.com/it/u=1490237218,4115737545&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=720","message":"Success !","status":200,"city":"北京","count":632,"data":{"shidu":"34%","pm25":73,"pm10":91,"quality":"良","wendu":"5","ganmao":"极少数敏感人群应减少户外活动","yesterday":{"date":"21日星期三","sunrise":"06:19","high":"高温 11.0℃","low":"低温 1.0℃","sunset":"18:26","aqi":85,"fx":"南风","fl":"<3级","type":"多云","notice":"阴晴之间，谨防紫外线侵扰"},"forecast":[{"date":"22日星期四","sunrise":"06:17","high":"高温 17.0℃","low":"低温 1.0℃","sunset":"18:27","aqi":98,"fx":"西南风","fl":"<3级","type":"晴","notice":"愿你拥有比阳光明媚的心情"},{"date":"23日星期五","sunrise":"06:16","high":"高温 18.0℃","low":"低温 5.0℃","sunset":"18:28","aqi":118,"fx":"无持续风向","fl":"<3级","type":"多云","notice":"阴晴之间，谨防紫外线侵扰"},{"date":"24日星期六","sunrise":"06:14","high":"高温 21.0℃","low":"低温 7.0℃","sunset":"18:29","aqi":52,"fx":"西南风","fl":"<3级","type":"晴","notice":"愿你拥有比阳光明媚的心情"},{"date":"25日星期日","sunrise":"06:13","high":"高温 22.0℃","low":"低温 7.0℃","sunset":"18:30","aqi":71,"fx":"西南风","fl":"<3级","type":"晴","notice":"愿你拥有比阳光明媚的心情"},{"date":"26日星期一","sunrise":"06:11","high":"高温 21.0℃","low":"低温 8.0℃","sunset":"18:31","aqi":97,"fx":"西南风","fl":"<3级","type":"多云","notice":"阴晴之间，谨防紫外线侵扰"}]}}';
            editor.setValue(demo);
            this.$nextTick(() => {
                this.format();
            })
        },

        nestedEscapeParseFn: function () {
            this.$nextTick(() => {
                this.setNestedEscapeParse(this.nestedEscapeParse);
            });
        },

        openTableViewModal: function() {
            if (!this.tableViewReady) {
                return;
            }
            this.resetTableViewState();

            let source = this.jsonFormattedSource;
            if (!source.trim()) {
                return;
            }

            try {
                const jsonObj = parseWithBigInt(source);
                const tableViewData = buildRenderableTableViewData(jsonObj);
                this.tableViewMode = tableViewData.mode;
                this.tableViewTitle = tableViewData.title;
                this.tableViewSourcePath = tableViewData.sourcePath;
                this.tableViewRows = tableViewData.rows;
                this.tableViewColumns = tableViewData.columns || [];
                this.showTableViewModal = true;
            } catch (error) {
                this.tableViewError = error.message || '表格视图生成失败';
                this.showTableViewModal = true;
            }
        },

        closeTableViewModal: function() {
            this.showTableViewModal = false;
        },

        // JSONPath查询功能
        executeJsonPath: function() {
            this.jsonPathError = '';
            this.jsonPathResults = [];
            this.jsonPathCopyNotice = '';

            if (!this.jsonPathQuery.trim()) {
                this.jsonPathError = '请输入JSONPath查询表达式';
                return;
            }

            let source = this.jsonFormattedSource || editor.getValue();
            if (!source.trim()) {
                this.jsonPathError = '请先输入JSON数据';
                return;
            }

            try {
                let jsonObj = parseWithBigInt(source);
                this.jsonPathResults = this.queryJsonPath(jsonObj, this.jsonPathQuery.trim());
                this.showJsonPathModal = true;
            } catch (error) {
                this.jsonPathError = 'JSON格式错误：' + error.message;
                this.showJsonPathModal = true;
            }
        },

        // JSONPath查询引擎
        queryJsonPath: function(obj, path) {
            let results = [];
            
            try {
                // 简化的JSONPath解析器
                if (path === '$') {
                    results.push({ path: '$', value: obj });
                    return results;
                }

                // 移除开头的$
                if (path.startsWith('$.')) {
                    path = path.substring(2);
                } else if (path.startsWith('$')) {
                    path = path.substring(1);
                }

                // 执行查询
                this.evaluateJsonPath(obj, path, '$', results);
                
            } catch (error) {
                throw new Error('JSONPath表达式错误：' + error.message);
            }

            return results;
        },

        // 递归评估JSONPath
        evaluateJsonPath: function(current, path, currentPath, results) {
            if (!path) {
                results.push({ path: currentPath, value: current });
                return;
            }

            // 处理递归搜索 ..
            if (path.startsWith('..')) {
                let remainPath = path.substring(2);
                this.recursiveSearch(current, remainPath, currentPath, results);
                return;
            }

            // 解析下一个路径片段
            let match;
            
            // 处理数组索引 [index] 或 [*] 或 [start:end]
            if ((match = path.match(/^\[([^\]]+)\](.*)$/))) {
                let indexExpr = match[1];
                let remainPath = match[2];
                let quotedPropMatch = indexExpr.match(/^['"](.+)['"]$/);

                if (quotedPropMatch) {
                    let prop = quotedPropMatch[1];
                    if (typeof current === 'object' && current !== null && current.hasOwnProperty(prop)) {
                        this.evaluateJsonPath(current[prop], remainPath, currentPath + '[' + JSON.stringify(prop) + ']', results);
                    }
                    return;
                }
                
                if (!Array.isArray(current)) {
                    return;
                }

                if (indexExpr === '*') {
                    // 通配符：所有元素
                    current.forEach((item, index) => {
                        this.evaluateJsonPath(item, remainPath, currentPath + '[' + index + ']', results);
                    });
                } else if (indexExpr.includes(':')) {
                    // 数组切片 [start:end]
                    let [start, end] = indexExpr.split(':').map(s => s.trim() === '' ? undefined : parseInt(s));
                    let sliced = current.slice(start, end);
                    sliced.forEach((item, index) => {
                        let actualIndex = (start || 0) + index;
                        this.evaluateJsonPath(item, remainPath, currentPath + '[' + actualIndex + ']', results);
                    });
                } else if (indexExpr.startsWith('?(')) {
                    // 过滤表达式 [?(@.prop)]
                    current.forEach((item, index) => {
                        if (this.evaluateFilter(item, indexExpr)) {
                            this.evaluateJsonPath(item, remainPath, currentPath + '[' + index + ']', results);
                        }
                    });
                } else {
                    // 具体索引
                    let index = parseInt(indexExpr);
                    if (index < 0) {
                        index = current.length + index; // 负索引
                    }
                    if (index >= 0 && index < current.length) {
                        this.evaluateJsonPath(current[index], remainPath, currentPath + '[' + index + ']', results);
                    }
                }
                return;
            }

            // 处理属性访问 .property 或直接属性名
            if ((match = path.match(/^\.?([^.\[]+)(.*)$/))) {
                let prop = match[1];
                let remainPath = match[2];
                
                if (prop === '*') {
                    // 通配符：所有属性
                    if (typeof current === 'object' && current !== null) {
                        Object.keys(current).forEach(key => {
                            this.evaluateJsonPath(current[key], remainPath, currentPath + '.' + key, results);
                        });
                    }
                } else {
                    // 具体属性
                    if (typeof current === 'object' && current !== null && current.hasOwnProperty(prop)) {
                        this.evaluateJsonPath(current[prop], remainPath, currentPath + '.' + prop, results);
                    }
                }
                return;
            }

            // 处理方括号属性访问 ['property']
            if ((match = path.match(/^\['([^']+)'\](.*)$/))) {
                let prop = match[1];
                let remainPath = match[2];
                
                if (typeof current === 'object' && current !== null && current.hasOwnProperty(prop)) {
                    this.evaluateJsonPath(current[prop], remainPath, currentPath + "['" + prop + "']", results);
                }
                return;
            }

            // 如果没有特殊符号，当作属性名处理
            if (typeof current === 'object' && current !== null && current.hasOwnProperty(path)) {
                results.push({ path: currentPath + '.' + path, value: current[path] });
            }
        },

        // 递归搜索
        recursiveSearch: function(current, targetProp, currentPath, results) {
            if (typeof current === 'object' && current !== null) {
                // 检查当前对象的属性
                if (current.hasOwnProperty(targetProp)) {
                    results.push({ path: currentPath + '..' + targetProp, value: current[targetProp] });
                }
                
                // 递归搜索子对象
                Object.keys(current).forEach(key => {
                    if (Array.isArray(current[key])) {
                        current[key].forEach((item, index) => {
                            this.recursiveSearch(item, targetProp, currentPath + '.' + key + '[' + index + ']', results);
                        });
                    } else if (typeof current[key] === 'object' && current[key] !== null) {
                        this.recursiveSearch(current[key], targetProp, currentPath + '.' + key, results);
                    }
                });
            }
        },

        // 简单的过滤器评估
        evaluateFilter: function(item, filterExpr) {
            // 简化的过滤器实现，只支持基本的属性存在性检查
            // 如 ?(@.name) 检查是否有name属性
            let match = filterExpr.match(/^\?\(@\.(\w+)\)$/);
            if (match) {
                let prop = match[1];
                return typeof item === 'object' && item !== null && item.hasOwnProperty(prop);
            }
            
            // 支持简单的比较 ?(@.age > 18)
            match = filterExpr.match(/^\?\(@\.(\w+)\s*([><=!]+)\s*(.+)\)$/);
            if (match) {
                let prop = match[1];
                let operator = match[2];
                let value = match[3];
                
                if (typeof item === 'object' && item !== null && item.hasOwnProperty(prop)) {
                    let itemValue = item[prop];
                    let compareValue = isNaN(value) ? value.replace(/['"]/g, '') : parseFloat(value);
                    
                    switch (operator) {
                        case '>': return itemValue > compareValue;
                        case '<': return itemValue < compareValue;
                        case '>=': return itemValue >= compareValue;
                        case '<=': return itemValue <= compareValue;
                        case '==': return itemValue == compareValue;
                        case '!=': return itemValue != compareValue;
                    }
                }
            }
            
            return false;
        },

        // 显示JSONPath示例
        showJsonPathExamples: function() {
            this.showJsonPathExamplesModal = true;
        },

        // 使用JSONPath示例
        useJsonPathExample: function(path) {
            this.jsonPathQuery = path;
            this.closeJsonPathExamplesModal();
        },

        // 打开JSONPath查询模态框
        openJsonPathModal: function() {
            if (!this.jsonActionReady) {
                return;
            }
            this.showJsonPathModal = true;
            // 清空之前的查询结果
            this.jsonPathResults = [];
            this.jsonPathError = '';
            this.copyButtonState = 'normal';
            this.jsonPathCopyNotice = '';
        },

        // 关闭JSONPath结果模态框
        closeJsonPathModal: function() {
            this.showJsonPathModal = false;
            this.copyButtonState = 'normal'; // 重置复制按钮状态
            this.jsonPathCopyNotice = '';
        },

        // 关闭JSONPath示例模态框
        closeJsonPathExamplesModal: function() {
            this.showJsonPathExamplesModal = false;
        },

        // 格式化JSONPath查询结果
        formatJsonPathResult: function(value) {
            return this.serializeJsonPathValue(value);
        },

        serializeJsonPathValue: function(value) {
            let output = this.safeStringify(value, 2);
            return output === undefined ? String(value) : output;
        },

        buildJsonPathValuePayload: function() {
            let values = this.jsonPathResults.map(result => result.value);
            let payload = values.length === 1 ? values[0] : values;
            return this.serializeJsonPathValue(payload);
        },

        buildJsonPathDetailsPayload: function() {
            return this.safeStringify(this.jsonPathResults.map((result, index) => ({
                index: index + 1,
                path: result.path,
                type: this.getJsonPathResultType(result.value),
                value: result.value
            })), 2);
        },

        buildJsonPathPathsPayload: function() {
            return this.jsonPathResults.map(result => result.path).join('\n');
        },

        getJsonPathResultType: function(value) {
            if (value === null) return 'null';
            if (Array.isArray(value)) return 'array';
            if (typeof value === 'bigint') return 'bigint';
            return typeof value;
        },

        getJsonPathResultPreview: function(value) {
            let output = this.serializeJsonPathValue(value);
            return output.length > 600 ? output.slice(0, 600) + '\n...' : output;
        },

        copyTextToClipboard: function(text) {
            let payload = String(text === undefined || text === null ? '' : text);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(payload).catch(() => this.copyTextFallback(payload));
            }
            return this.copyTextFallback(payload);
        },

        copyTextFallback: function(text) {
            return new Promise((resolve, reject) => {
                let textArea = null;
                try {
                    textArea = document.createElement('textarea');
                    textArea.value = text;
                    textArea.setAttribute('readonly', 'readonly');
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-9999px';
                    document.body.appendChild(textArea);
                    textArea.select();
                    if (document.execCommand('copy') === false) {
                        throw new Error('copy command failed');
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                } finally {
                    if (textArea && textArea.parentNode) {
                        textArea.parentNode.removeChild(textArea);
                    }
                }
            });
        },

        showJsonPathCopyNotice: function(message) {
            window.clearTimeout(this.jsonPathCopyNoticeTimer);
            this.jsonPathCopyNotice = message;
            this.jsonPathCopyNoticeTimer = window.setTimeout(() => {
                this.jsonPathCopyNotice = '';
            }, 1800);
        },

        copyJsonPathText: function(text, successMessage) {
            return this.copyTextToClipboard(text).then(() => {
                this.showJsonPathCopyNotice(successMessage);
            }).catch(() => {
                this.showJsonPathCopyNotice('复制失败');
            });
        },

        // 复制可直接使用的 JSONPath 值结果
        copyJsonPathValues: function() {
            if (this.jsonPathResults.length === 0) {
                return;
            }

            this.copyButtonState = 'copying';

            this.copyTextToClipboard(this.buildJsonPathValuePayload()).then(() => {
                this.copyButtonState = 'success';
                this.showJsonPathCopyNotice('值 JSON 已复制');
                setTimeout(() => {
                    this.copyButtonState = 'normal';
                }, 2000);
            }).catch(() => {
                this.copyButtonState = 'error';
                this.showJsonPathCopyNotice('复制失败');
                setTimeout(() => {
                    this.copyButtonState = 'normal';
                }, 2000);
            });
        },

        // 复制JSONPath查询明细
        copyJsonPathResults: function() {
            this.copyJsonPathText(this.buildJsonPathDetailsPayload(), '明细 JSON 已复制');
        },

        copyJsonPathPaths: function() {
            this.copyJsonPathText(this.buildJsonPathPathsPayload(), '路径已复制');
        },

        copyJsonPathRowPath: function(result) {
            this.copyJsonPathText(result.path, '路径已复制');
        },

        copyJsonPathRowValue: function(result) {
            this.copyJsonPathText(this.serializeJsonPathValue(result.value), '值 JSON 已复制');
        },

        // 下载可直接使用的 JSONPath 值结果
        downloadJsonPathResults: function() {
            let resultText = this.buildJsonPathValuePayload();
            
            // 基于JSONPath生成文件名
            let filename = this.generateFilenameFromPath(this.jsonPathQuery);
            
            let blob = new Blob([resultText], { type: 'application/json;charset=utf-8' });
            let url = window.URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = filename + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        },

        // 根据JSONPath生成文件名
        generateFilenameFromPath: function(path) {
            if (!path || path === '$') {
                return 'jsonpath_root';
            }
            
            // 移除开头的$和.
            let cleanPath = path.replace(/^\$\.?/, '');
            
            // 替换特殊字符为下划线，保留数字、字母、点号、中划线
            let filename = cleanPath
                .replace(/[\[\]]/g, '_')  // 方括号替换为下划线
                .replace(/[^\w\u4e00-\u9fa5.-]/g, '_')  // 特殊字符替换为下划线，保留中文
                .replace(/_{2,}/g, '_')   // 多个连续下划线合并为一个
                .replace(/^_|_$/g, '');   // 移除开头和结尾的下划线
            
            // 如果处理后为空，使用默认名称
            if (!filename) {
                return 'jsonpath_query';
            }
            
            // 限制文件名长度
            if (filename.length > 50) {
                filename = filename.substring(0, 50) + '_truncated';
            }
            
            return 'jsonpath_' + filename;
        },

        jumpToMockDataTool: function(event) {
            event.preventDefault();
            // 1. 先判断mock-data工具是否已安装
            // 方案：直接读取chrome.storage.local，判断DYNAMIC_TOOL:mock-data是否存在
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get('DYNAMIC_TOOL:mock-data', result => {
                    if (result && result['DYNAMIC_TOOL:mock-data']) {
                        // 已安装，直接打开mock-data工具
                        window.open('/mock-data/index.html', '_blank');
                    } else {
                        // 未安装，跳转到原href
                        window.open('/options/index.html?query=数据Mock工具', '_blank');
                    }
                });
            } else {
                // 兜底：如果无法访问chrome.storage，直接跳原href
                window.open('/options/index.html?query=数据Mock工具', '_blank');
            }
        }
    }
});

// 新增：递归解包嵌套JSON字符串的函数
function deepParseJSONStrings(obj) {
    if (Array.isArray(obj)) {
        return obj.map(item => {
            // 对于数组中的字符串元素，也尝试解析为JSON
            if (typeof item === 'string' && item.trim()) {
                try {
                    const parsed = JSON.parse(item);
                    // 只递归对象或数组，且排除BigInt结构（如{s,e,c}）和纯数字
                    if (
                        typeof parsed === 'object' &&
                        parsed !== null &&
                        (Array.isArray(parsed) || Object.prototype.toString.call(parsed) === '[object Object]') &&
                        !(
                            parsed &&
                            typeof parsed.s === 'number' &&
                            typeof parsed.e === 'number' &&
                            Array.isArray(parsed.c) &&
                            Object.keys(parsed).length === 3
                        )
                    ) {
                        return deepParseJSONStrings(parsed);
                    }
                } catch (e) {
                    // 解析失败，保持原字符串
                }
            }
            return deepParseJSONStrings(item);
        });
    } else if (typeof obj === 'object' && obj !== null) {
        const newObj = {};
        for (const key in obj) {
            if (!obj.hasOwnProperty(key)) continue;
            const val = obj[key];
            if (typeof val === 'string' && val.trim()) {
                try {
                    const parsed = JSON.parse(val);
                    // 只递归对象或数组，且排除BigInt结构（如{s,e,c}）和纯数字
                    if (
                        typeof parsed === 'object' &&
                        parsed !== null &&
                        (Array.isArray(parsed) || Object.prototype.toString.call(parsed) === '[object Object]') &&
                        !(
                            parsed &&
                            typeof parsed.s === 'number' &&
                            typeof parsed.e === 'number' &&
                            Array.isArray(parsed.c) &&
                            Object.keys(parsed).length === 3
                        )
                    ) {
                        newObj[key] = deepParseJSONStrings(parsed);
                        continue;
                    }
                } catch (e) {
                    // 解析失败，保持原值
                }
            }
            newObj[key] = deepParseJSONStrings(val);
        }
        return newObj;
    }
    return obj;
}

function unpackTopLevelEscapedJSON(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return value;
    }

    try {
        const parsed = parseWithBigInt(value);
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            (Array.isArray(parsed) || Object.prototype.toString.call(parsed) === '[object Object]') &&
            !(
                parsed &&
                typeof parsed.s === 'number' &&
                typeof parsed.e === 'number' &&
                Array.isArray(parsed.c) &&
                Object.keys(parsed).length === 3
            )
        ) {
            return deepParseJSONStrings(parsed);
        }
    } catch (e) {
        // 保持原字符串，沿用旧行为
    }

    return value;
}


function isInsideQuotedSegment(text, offset) {
    let quote = '';
    let escaped = false;

    for (let i = 0; i < offset; i++) {
        const char = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = '';
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
        }
    }

    return !!quote;
}

function replaceOutsideQuotedSegments(text, regex, replacer) {
    return text.replace(regex, function () {
        const args = Array.prototype.slice.call(arguments);
        const offset = args[args.length - 2];
        if (isInsideQuotedSegment(text, offset)) {
            return args[0];
        }
        return replacer.apply(null, args);
    });
}

function normalizeLooseJSONSource(text) {
    let fixed = String(text).trim();

    fixed = replaceOutsideQuotedSegments(fixed, /([\{,]\s*)'([^'\\]*?)'(\s*:)/g, function (match, prefix, key, suffix) {
        return prefix + '"' + key + '"' + suffix;
    });
    fixed = replaceOutsideQuotedSegments(fixed, /([\{,]\s*)(\w+)(\s*:)/g, function (match, prefix, key, suffix) {
        return prefix + '"' + key + '"' + suffix;
    });
    fixed = replaceOutsideQuotedSegments(fixed, /(:\s*)'([^'\\]*?)'/g, function (match, prefix, value) {
        return prefix + '"' + value + '"';
    });

    return fixed;
}

// 统一的 BigInt 安全解析（与 json-auto-utils/format-lib/worker 思路一致）：
// 1) 只在引号外修正宽松 key；2) 为可能的超长数字加标记；3) 用 reviver 还原为 BigInt
function parseWithBigInt(text) {
    if (
        typeof window !== 'undefined' &&
        window.FHJsonAutoUtils &&
        typeof window.FHJsonAutoUtils.parseWithBigInt === 'function'
    ) {
        return window.FHJsonAutoUtils.parseWithBigInt(text);
    }

    let fixed = normalizeLooseJSONSource(text);

    // 标记 16 位及以上的整数（允许值后有空白，再跟 , ] } 或结尾）
    // 使用 offset 检查匹配位置是否在 JSON 字符串内部，避免破坏嵌套转义的 JSON 字符串
    fixed = fixed.replace(/([:,\[]\s*)(-?\d{16,})(\s*)(?=(?:,|\]|\}|$))/g, function(m, p1, num, sp, offset) {
        if (isInsideQuotedSegment(fixed, offset)) return m;
        return p1 + '"__BigInt__' + num + '"' + sp;
    });
    return JSON.parse(fixed, function(key, value) {
        if (typeof value === 'string' && value.indexOf('__BigInt__') === 0) {
            try { return BigInt(value.slice(10)); } catch(e) { return value.slice(10); }
        }
        return value;
    });
}
