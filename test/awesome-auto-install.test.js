/**
 * This is a supplemental chrome.storage harness for deterministic unit tests.
 * The build check separately verifies the packaged module and manifest paths.
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import toolMap from '../apps/background/tools.js';
import {
    BUILTIN_TOOLS_INITIALIZED_KEY,
    DEFAULT_MENU_NAMES,
    getAutoInstallChanges,
    MENU_STORAGE_PREFIX,
    TOOL_STORAGE_PREFIX
} from '../apps/background/auto-install.js';

function createStorageMock(seed = {}) {
    const data = { ...seed };
    const get = vi.fn((keys, callback) => {
        if (keys === null) {
            callback({ ...data });
            return;
        }

        const requested = Array.isArray(keys) ? keys : [keys];
        const result = {};
        requested.filter(Boolean).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                result[key] = data[key];
            }
        });
        callback(result);
    });
    const set = vi.fn((items, callback) => {
        Object.assign(data, items);
        callback && callback();
    });
    const remove = vi.fn((keys, callback) => {
        [].concat(keys).forEach(key => delete data[key]);
        callback && callback();
    });

    return {
        data,
        chrome: {
            runtime: {
                getManifest: () => ({ homepage_url: 'https://fehelper.com/' })
            },
            storage: {
                local: { get, set, remove }
            }
        }
    };
}

describe('built-in tool auto-install', () => {
    it('creates install and context-menu defaults only for missing keys', () => {
        const changes = getAutoInstallChanges(
            ['json-format', 'json-diff'],
            {
                [`${TOOL_STORAGE_PREFIX}json-format`]: 0,
                [`${MENU_STORAGE_PREFIX}json-format`]: '0',
                [`${MENU_STORAGE_PREFIX}download-crx`]: '0'
            },
            1700000000000
        );

        expect(changes).toEqual({
            [`${TOOL_STORAGE_PREFIX}json-diff`]: '1700000000001',
            [`${MENU_STORAGE_PREFIX}json-diff`]: '1',
            [BUILTIN_TOOLS_INITIALIZED_KEY]: JSON.stringify({
                version: 1,
                tools: ['json-diff', 'json-format']
            })
        });
    });

    it('does not restore a known tool whose storage key was removed', () => {
        const initialized = JSON.stringify({
            version: 1,
            tools: ['json-format']
        });
        const changes = getAutoInstallChanges(
            ['json-format', 'json-diff'],
            { [BUILTIN_TOOLS_INITIALIZED_KEY]: initialized },
            1700000000000
        );

        expect(changes[`${TOOL_STORAGE_PREFIX}json-format`]).toBeUndefined();
        expect(changes[`${TOOL_STORAGE_PREFIX}json-diff`]).toBe('1700000000001');
    });

    it('enables every packaged tool and menu on first storage initialization', () => {
        const changes = getAutoInstallChanges(Object.keys(toolMap), {}, 1700000000000);
        const toolKeys = Object.keys(changes).filter(key => key.startsWith(TOOL_STORAGE_PREFIX));
        const menuKeys = Object.keys(changes).filter(key => key.startsWith(MENU_STORAGE_PREFIX));

        expect(toolKeys).toHaveLength(Object.keys(toolMap).length);
        expect(menuKeys).toHaveLength(Object.keys(toolMap).length + DEFAULT_MENU_NAMES.length);
        expect(changes[`${MENU_STORAGE_PREFIX}download-crx`]).toBe('1');
        expect(changes[BUILTIN_TOOLS_INITIALIZED_KEY]).toBe(JSON.stringify({
            version: 1,
            tools: Object.keys(toolMap).sort()
        }));
    });

    it('preserves an explicitly disabled system menu', () => {
        const changes = getAutoInstallChanges(
            [],
            { [`${MENU_STORAGE_PREFIX}download-crx`]: '0' },
            1700000000000
        );

        expect(changes[`${MENU_STORAGE_PREFIX}download-crx`]).toBeUndefined();
    });

    it('exposes the auto-install module to content-script imports', () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve('apps/manifest.json'), 'utf8'));
        const resources = manifest.web_accessible_resources.flatMap(group => group.resources);

        expect(resources).toContain('background/awesome.js');
        expect(resources).toContain('background/auto-install.js');
    });

    describe('Awesome storage integration', () => {
        let chromeState;

        beforeEach(() => {
            vi.resetModules();
            chromeState = createStorageMock();
            globalThis.chrome = chromeState.chrome;
        });

        afterEach(() => {
            delete globalThis.chrome;
            vi.restoreAllMocks();
        });

        it('returns all packaged tools as installed after the first read', async () => {
            const { default: Awesome } = await import('../apps/background/awesome.js');
            const installedTools = await Awesome.getInstalledTools();

            expect(Object.keys(installedTools)).toEqual(Object.keys(toolMap));
            expect(Object.values(installedTools).every(tool => tool.installed && tool.menu)).toBe(true);
            expect(chromeState.data[BUILTIN_TOOLS_INITIALIZED_KEY]).toBeTruthy();
        });

        it('does not restore a tool explicitly offloaded during the same worker lifetime', async () => {
            const { default: Awesome } = await import('../apps/background/awesome.js');
            await Awesome.ensureAllToolsInstalled();
            await Awesome.offLoad('json-diff');

            const installedTools = await Awesome.getInstalledTools();

            expect(installedTools['json-diff']).toBeUndefined();
            expect(chromeState.data[`${TOOL_STORAGE_PREFIX}json-diff`]).toBe(0);

            vi.resetModules();
            const { default: reloadedAwesome } = await import('../apps/background/awesome.js');
            const reloadedTools = await reloadedAwesome.getInstalledTools();

            expect(reloadedTools['json-diff']).toBeUndefined();
        });
    });
});
