import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const TotpCore = require('../apps/totp-auth/totp-core.js');

function readSource(file) {
    return fs.readFileSync(path.resolve(file), 'utf8');
}

function base32EncodeAscii(text) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes = Buffer.from(text, 'ascii');
    let bits = '';
    for (const byte of bytes) {
        bits += byte.toString(2).padStart(8, '0');
    }
    let output = '';
    for (let index = 0; index < bits.length; index += 5) {
        const chunk = bits.slice(index, index + 5).padEnd(5, '0');
        output += alphabet[parseInt(chunk, 2)];
    }
    return output;
}

describe('totp-auth tool', () => {
    it('Issue #627: registers a local encrypted 2FA authenticator tool', () => {
        const tools = readSource('apps/background/tools.js');
        const options = readSource('apps/options/index.js');
        const popup = readSource('apps/popup/index.js');
        const html = readSource('apps/totp-auth/index.html');
        const js = readSource('apps/totp-auth/index.js');
        const core = readSource('apps/totp-auth/totp-core.js');

        expect(tools).toContain("'totp-auth'");
        expect(tools).toContain('2FA 动态口令');
        expect(options).toContain("'totp-auth': '2FA'");
        expect(options).toContain("'uuid-gen', 'totp-auth'");
        expect(popup).toContain("'totp-auth': '2FA'");
        expect(popup).toContain('2fa totp otp authenticator');
        expect(html).toContain('<title>2FA 动态口令</title>');
        expect(html).toContain('otpauth://totp/Issuer:account?secret=...');
        expect(html).toContain('本地保险箱口令');
        expect(html).toContain('账号密钥使用本地口令加密保存');
        expect(html).toContain('<script src="totp-core.js"></script>');
        expect(html).not.toContain('密钥仅保存在当前浏览器扩展本地存储中');
        expect(js).toContain("const TOTP_VAULT_STORAGE_KEY = 'FH_TOTP_ENCRYPTED_VAULT';");
        expect(js).toContain("const TOTP_CORE = window.FHTotpCore;");
        expect(js).toContain('TOTP_CORE.encryptAccounts');
        expect(js).toContain('TOTP_CORE.decryptVault');
        expect(js).toContain('vaultSessionPassphrase');
        expect(js).toContain("algorithmInput: 'SHA-1'");
        expect(core).toContain("hash: normalizeAlgorithm(options.algorithm)");
        expect(core).toContain("cipher: 'AES-GCM'");
        expect(js).not.toContain('JSON.stringify(this.accounts)');
        expect(js).not.toContain('storageSet(TOTP_LEGACY_STORAGE_KEY');
        expect(js).not.toContain('fetch(');
        expect(js).not.toContain('XMLHttpRequest');
    });

    it('Issue #627: generates RFC 6238 TOTP values for supported algorithms', async () => {
        const timestamp = 59000;

        await expect(TotpCore.generateTotp(base32EncodeAscii('12345678901234567890'), {
            timestamp,
            period: 30,
            digits: 8,
            algorithm: 'SHA-1'
        })).resolves.toBe('94287082');

        await expect(TotpCore.generateTotp(base32EncodeAscii('12345678901234567890123456789012'), {
            timestamp,
            period: 30,
            digits: 8,
            algorithm: 'SHA-256'
        })).resolves.toBe('46119246');

        await expect(TotpCore.generateTotp(base32EncodeAscii('1234567890123456789012345678901234567890123456789012345678901234'), {
            timestamp,
            period: 30,
            digits: 8,
            algorithm: 'SHA-512'
        })).resolves.toBe('90693936');
    });

    it('Issue #627: encrypts stored TOTP secrets and rejects wrong vault passwords', async () => {
        const accounts = [{
            issuer: 'GitHub',
            name: 'name@example.com',
            secret: 'GEZDGNBVGY3TQOJQ',
            digits: 6,
            period: 30,
            algorithm: 'SHA-1'
        }];

        const vault = await TotpCore.encryptAccounts(accounts, 'local-password');
        const serialized = JSON.stringify(vault);

        expect(vault.cipher).toBe('AES-GCM');
        expect(vault.kdf).toBe('PBKDF2');
        expect(serialized).not.toContain('GEZDGNBVGY3TQOJQ');
        expect(serialized).not.toContain('name@example.com');
        await expect(TotpCore.decryptVault(vault, 'local-password')).resolves.toEqual(accounts);
        await expect(TotpCore.decryptVault(vault, 'wrong-password')).rejects.toThrow('保险箱口令不正确');
    });

    it('Issue #627: rejects unsupported otpauth algorithms instead of silently generating wrong codes', () => {
        expect(TotpCore.normalizeAlgorithm('SHA256')).toBe('SHA-256');
        expect(TotpCore.normalizeAlgorithm('sha_512')).toBe('SHA-512');
        expect(() => TotpCore.normalizeAlgorithm('MD5')).toThrow('仅支持 SHA-1、SHA-256、SHA-512');
    });
});
