import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import EncodeUtils from '../apps/en-decode/endecode-lib.js';

function readSource(file) {
    return fs.readFileSync(path.resolve(file), 'utf8');
}

describe('en-decode manual regressions', () => {
    it('Issue #625: Base64 decode accepts URL-safe input and 4-byte UTF-8 characters', () => {
        const base64UrlEmoji = Buffer.from('😀', 'utf8').toString('base64url');

        expect(base64UrlEmoji).toBe('8J-YgA');
        expect(EncodeUtils.utf8Decode(EncodeUtils.base64Decode(base64UrlEmoji))).toBe('😀');
    });

    it('Issue #625: decoded complete JSON is pretty printed', () => {
        const encoded = Buffer.from(JSON.stringify({ok: true, name: 'FeHelper'}), 'utf8').toString('base64url');
        const decoded = EncodeUtils.utf8Decode(EncodeUtils.base64Decode(encoded));

        expect(EncodeUtils.formatDecodedText(decoded)).toBe('{\n    "ok": true,\n    "name": "FeHelper"\n}');
    });

    it('Issue #622: URL decode keeps malformed percent sequences instead of throwing', () => {
        expect(EncodeUtils.tolerantUrlDecode('%E4%BD%A0%XX%')).toBe('你%XX%');
        expect(() => EncodeUtils.tolerantUrlDecode('%E0%A4%A')).not.toThrow();
    });

    it('manual and AI decode paths use tolerant URL decode helpers', () => {
        const page = readSource('apps/en-decode/index.js');
        const analyzer = readSource('apps/en-decode/ai-decode-analyzer.js');

        expect(page).toContain('EncodeUtils.tolerantUrlDecode(this.sourceContent)');
        expect(page).toContain('EncodeUtils.formatDecodedText(EncodeUtils.utf8Decode(EncodeUtils.base64Decode(this.sourceContent)))');
        expect(analyzer).toContain('EncodeUtils.tolerantUrlDecode(text, {plusAsSpace: true})');
        expect(analyzer).toContain('EncodeUtils.tolerantUrlDecode(rawValue)');
    });
});
