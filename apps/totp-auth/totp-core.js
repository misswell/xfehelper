/* global module, TextEncoder, TextDecoder, Buffer, btoa, atob */
(function (root, factory) {
    const core = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = core;
    }
    root.FHTotpCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    const VAULT_VERSION = 1;
    const KDF_ITERATIONS = 150000;

    function getCrypto(cryptoImpl) {
        const cryptoRef = cryptoImpl || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
        if (!cryptoRef || !cryptoRef.subtle || !cryptoRef.getRandomValues) {
            throw new Error('当前浏览器不支持 Web Crypto');
        }
        return cryptoRef;
    }

    function textToBytes(text) {
        return new TextEncoder().encode(String(text || ''));
    }

    function bytesToText(bytes) {
        return new TextDecoder().decode(bytes);
    }

    function bytesToBase64(bytes) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(data).toString('base64');
        }
        let binary = '';
        data.forEach(byte => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    function base64ToBytes(text) {
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(String(text || ''), 'base64'));
        }
        const binary = atob(String(text || ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    function normalizeBase32Secret(secret) {
        return String(secret || '').replace(/[\s-]/g, '').toUpperCase();
    }

    function normalizeAlgorithm(algorithm) {
        const normalized = String(algorithm || 'SHA-1').replace(/[\s_-]/g, '').toUpperCase();
        const map = {
            SHA1: 'SHA-1',
            SHA256: 'SHA-256',
            SHA512: 'SHA-512'
        };
        if (!map[normalized]) {
            throw new Error('仅支持 SHA-1、SHA-256、SHA-512');
        }
        return map[normalized];
    }

    function base32ToBytes(secret) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const normalized = normalizeBase32Secret(secret).replace(/=+$/g, '');
        if (!normalized || /[^A-Z2-7]/.test(normalized)) {
            throw new Error('Secret 必须是 Base32 字符串');
        }

        let bits = '';
        for (let index = 0; index < normalized.length; index++) {
            bits += alphabet.indexOf(normalized[index]).toString(2).padStart(5, '0');
        }

        const bytes = [];
        for (let index = 0; index + 8 <= bits.length; index += 8) {
            bytes.push(parseInt(bits.slice(index, index + 8), 2));
        }
        return new Uint8Array(bytes);
    }

    function counterToBytes(counter) {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        let value = BigInt(counter);
        for (let index = 7; index >= 0; index--) {
            view.setUint8(index, Number(value & 0xffn));
            value >>= 8n;
        }
        return buffer;
    }

    async function generateTotp(secret, options) {
        options = options || {};
        const cryptoRef = getCrypto(options.crypto);
        const period = Number(options.period || 30);
        const digits = [6, 8].includes(Number(options.digits)) ? Number(options.digits) : 6;
        const timestamp = typeof options.timestamp === 'number' ? options.timestamp : Date.now();
        const counter = Math.floor(timestamp / 1000 / period);
        const key = await cryptoRef.subtle.importKey(
            'raw',
            base32ToBytes(secret),
            {name: 'HMAC', hash: normalizeAlgorithm(options.algorithm)},
            false,
            ['sign']
        );
        const signature = new Uint8Array(await cryptoRef.subtle.sign('HMAC', key, counterToBytes(counter)));
        const offset = signature[signature.length - 1] & 0x0f;
        const binary = ((signature[offset] & 0x7f) << 24) |
            ((signature[offset + 1] & 0xff) << 16) |
            ((signature[offset + 2] & 0xff) << 8) |
            (signature[offset + 3] & 0xff);
        const otp = binary % Math.pow(10, digits);
        return String(otp).padStart(digits, '0');
    }

    async function deriveVaultKey(passphrase, saltBytes, cryptoImpl) {
        const cryptoRef = getCrypto(cryptoImpl);
        const baseKey = await cryptoRef.subtle.importKey(
            'raw',
            textToBytes(passphrase),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return cryptoRef.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: KDF_ITERATIONS,
                hash: 'SHA-256'
            },
            baseKey,
            {
                name: 'AES-GCM',
                length: 256
            },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptAccounts(accounts, passphrase, cryptoImpl) {
        const cryptoRef = getCrypto(cryptoImpl);
        const salt = cryptoRef.getRandomValues(new Uint8Array(16));
        const iv = cryptoRef.getRandomValues(new Uint8Array(12));
        const key = await deriveVaultKey(passphrase, salt, cryptoRef);
        const cipher = await cryptoRef.subtle.encrypt(
            {name: 'AES-GCM', iv},
            key,
            textToBytes(JSON.stringify(accounts || []))
        );
        return {
            version: VAULT_VERSION,
            cipher: 'AES-GCM',
            kdf: 'PBKDF2',
            hash: 'SHA-256',
            iterations: KDF_ITERATIONS,
            salt: bytesToBase64(salt),
            iv: bytesToBase64(iv),
            data: bytesToBase64(cipher)
        };
    }

    async function decryptVault(vaultInput, passphrase, cryptoImpl) {
        const cryptoRef = getCrypto(cryptoImpl);
        let vault;
        try {
            vault = typeof vaultInput === 'string' ? JSON.parse(vaultInput) : vaultInput;
        } catch (e) {
            throw new Error('保险箱数据已损坏', {cause: e});
        }
        if (!vault || vault.version !== VAULT_VERSION || vault.cipher !== 'AES-GCM') {
            throw new Error('不支持的保险箱格式');
        }
        const key = await deriveVaultKey(passphrase, base64ToBytes(vault.salt), cryptoRef);
        try {
            const plain = await cryptoRef.subtle.decrypt(
                {name: 'AES-GCM', iv: base64ToBytes(vault.iv)},
                key,
                base64ToBytes(vault.data)
            );
            return JSON.parse(bytesToText(new Uint8Array(plain)) || '[]');
        } catch (e) {
            throw new Error('保险箱口令不正确或数据已损坏', {cause: e});
        }
    }

    return {
        VAULT_VERSION,
        KDF_ITERATIONS,
        normalizeBase32Secret,
        normalizeAlgorithm,
        base32ToBytes,
        counterToBytes,
        generateTotp,
        encryptAccounts,
        decryptVault
    };
});
