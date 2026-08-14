import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function readSource(file) {
    return fs.readFileSync(path.resolve(file), 'utf8');
}

describe('extension update safety', () => {
    it('Issue #631: automatic update checks notify by default instead of unconditional reload', () => {
        const background = readSource('apps/background/background.js');
        const settings = readSource('apps/options/settings.js');
        const optionsHtml = readSource('apps/options/index.html');
        const optionsSource = readSource('apps/options/index.js');

        expect(settings).toContain("'AUTO_APPLY_EXTENSION_UPDATE': false");
        expect(optionsHtml).toContain('value="AUTO_APPLY_EXTENSION_UPDATE"');
        expect(optionsHtml).toContain('避免更新重载关闭正在使用的工具页');
        expect(optionsSource).toContain("'AUTO_APPLY_EXTENSION_UPDATE'");
        expect(background).toContain('let _handleUpdateCheckStatus = function (result, options)');
        expect(background).toContain('opts.AUTO_APPLY_EXTENSION_UPDATE');
        expect(background).toContain('_notifyExtensionUpdateDeferred();');
        expect(background).toContain('setTimeout(() => chrome.runtime.reload(), 1000);');
        expect(background).not.toContain('if (status === "update_available") {\n                    chrome.runtime.reload();');
    });
});
