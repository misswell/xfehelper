/**
 * 默认启用内置工具。
 *
 * JsHelper 原本把工具页面和右键菜单都当成按需安装项，扩展首次安装后
 * 只有 systemInstalled 工具可用。JsHelper 的发行包已经包含全部工具，
 * 因此这里仅负责把首次启动时缺失的状态补齐到 storage，不下载或执行远程代码。
 */

export const BUILTIN_TOOLS_INITIALIZED_KEY = 'FH_ALL_BUILTIN_TOOLS_INITIALIZED';
export const TOOL_STORAGE_PREFIX = 'DYNAMIC_TOOL:';
export const MENU_STORAGE_PREFIX = 'DYNAMIC_MENU:';
export const DEFAULT_MENU_NAMES = ['download-crx'];

const hasValue = (storage, key) => {
    return Object.prototype.hasOwnProperty.call(storage, key)
        && storage[key] !== null
        && storage[key] !== undefined;
};

const readKnownTools = value => {
    if (typeof value !== 'string') {
        return new Set();
    }

    try {
        const state = JSON.parse(value);
        return new Set(Array.isArray(state.tools) ? state.tools : []);
    } catch (_) {
        return new Set();
    }
};

/**
 * 生成首次启动所需的 storage 变更。
 *
 * 只填充缺失值，显式的 0/false 会被视为用户主动关闭，避免每次后台
 * Service Worker 重启时又把用户卸载的工具恢复回来。
 */
export function getAutoInstallChanges(
    toolNames,
    storage = {},
    now = Date.now(),
    menuNames = DEFAULT_MENU_NAMES
) {
    const changes = {};
    const knownTools = readKnownTools(storage[BUILTIN_TOOLS_INITIALIZED_KEY]);
    const firstRun = !hasValue(storage, BUILTIN_TOOLS_INITIALIZED_KEY);

    (toolNames || []).forEach((toolName, index) => {
        const toolKey = `${TOOL_STORAGE_PREFIX}${toolName}`;
        const menuKey = `${MENU_STORAGE_PREFIX}${toolName}`;

        // 首次启动启用全部工具。后续只为本版本新加入的工具补状态，
        // 已经见过但缺失的键表示用户主动卸载，不再自动恢复。
        if ((firstRun || !knownTools.has(toolName)) && !hasValue(storage, toolKey)) {
            changes[toolKey] = String(now + index);
        }
        if (!hasValue(storage, menuKey)) {
            changes[menuKey] = '1';
        }

        knownTools.add(toolName);
    });

    (menuNames || []).forEach(menuName => {
        const menuKey = `${MENU_STORAGE_PREFIX}${menuName}`;
        if (!hasValue(storage, menuKey)) {
            changes[menuKey] = '1';
        }
    });

    const nextState = JSON.stringify({
        version: 1,
        tools: Array.from(knownTools).sort()
    });
    if (storage[BUILTIN_TOOLS_INITIALIZED_KEY] !== nextState) {
        changes[BUILTIN_TOOLS_INITIALIZED_KEY] = nextState;
    }

    return changes;
}
