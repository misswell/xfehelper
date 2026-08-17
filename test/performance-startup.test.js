import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

function installChromeStorageMock() {
    const data = {};
    const reads = [];

    globalThis.chrome = {
        runtime: {
            getManifest: () => ({ homepage_url: 'https://fehelper.com/' })
        },
        storage: {
            local: {
                get: vi.fn((keys, callback) => {
                    reads.push(keys);
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
                }),
                set: vi.fn((items, callback) => {
                    Object.assign(data, items);
                    callback && callback();
                }),
                remove: vi.fn((keys, callback) => {
                    [].concat(keys).forEach(key => delete data[key]);
                    callback && callback();
                })
            }
        }
    };

    return { reads };
}

afterEach(() => {
    delete globalThis.chrome;
    vi.resetModules();
});

describe('startup performance guardrails', () => {
    it('loads all tool install and menu state with a bounded number of storage reads', async () => {
        const { reads } = installChromeStorageMock();
        const { default: Awesome } = await import('../apps/background/awesome.js');

        const tools = await Awesome.getAllTools();

        expect(Object.keys(tools)).not.toHaveLength(0);
        expect(reads.length).toBeLessThanOrEqual(3);
    });

    it('does not eagerly load page-wide dependency libraries on every website', () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve('apps/manifest.json'), 'utf8'));
        const background = fs.readFileSync(path.resolve('apps/background/background.js'), 'utf8');

        expect(manifest.content_scripts || []).toHaveLength(0);
        expect(background).toContain(
            "const CONTENT_SCRIPT_JQUERY_TOOLS = new Set(['json-format', 'code-beautify', 'grid-ruler']);"
        );
    });
});
