/**
 * 油猴 content-script
 *
 * v2 起，所有油猴脚本的注入完全由 background 通过 chrome.webNavigation
 * 三档触发器（onCommitted / onDOMContentLoaded / onCompleted / onHistoryStateUpdated）完成，
 * 不再依赖 content-script 主动通知，避免双重注入。
 *
 * 此函数保留是为了兼容 background 的 _injectContentScripts 自动调用机制，
 * 现在仅作为空 stub 存在。
 */
window.pagemonkeyContentScript = function () {
    /* no-op：注入逻辑已迁移至 background webNavigation 监听 */
};
