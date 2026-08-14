const TOTP_VAULT_STORAGE_KEY = 'FH_TOTP_ENCRYPTED_VAULT';
const TOTP_LEGACY_STORAGE_KEY = 'FH_TOTP_ACCOUNTS';
const TOTP_CORE = window.FHTotpCore;

new Vue({
    el: '#pageContainer',
    data: {
        issuerInput: '',
        accountInput: '',
        secretInput: '',
        uriInput: '',
        digitsInput: 6,
        periodInput: 30,
        algorithmInput: 'SHA-1',
        revealSecrets: false,
        accounts: [],
        codes: {},
        noticeText: '',
        now: Date.now(),
        timerId: null,
        noticeTimerId: null,
        vaultPassphrase: '',
        vaultPassphraseConfirm: '',
        vaultSessionPassphrase: '',
        vaultExists: false,
        vaultUnlocked: false,
        vaultLoading: true,
        legacyPlainAccountsDetected: false
    },

    computed: {
        vaultReady() {
            return this.vaultUnlocked && !this.vaultLoading;
        },

        vaultTitle() {
            return this.vaultExists ? '解锁本地保险箱' : '创建本地保险箱';
        },

        vaultHint() {
            if (this.vaultExists) {
                return '输入本地口令后生成动态码。口令只用于本机解密，不会保存。';
            }
            if (this.legacyPlainAccountsDetected) {
                return '检测到旧版明文账号；创建保险箱后会迁移并删除明文数据。';
            }
            return '首次使用需设置本地口令，账号密钥会加密后保存。';
        }
    },

    mounted() {
        this.loadVaultState();
        this.timerId = setInterval(() => {
            this.now = Date.now();
            if (this.vaultUnlocked) {
                this.refreshCodes();
            }
        }, 1000);
    },

    beforeDestroy() {
        clearInterval(this.timerId);
    },

    methods: {
        storageGet(key) {
            return new Promise(resolve => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(key, result => resolve(result && result[key]));
                } else {
                    resolve(localStorage.getItem(key));
                }
            });
        },

        storageSet(key, value) {
            return new Promise(resolve => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({[key]: value}, resolve);
                } else {
                    localStorage.setItem(key, value);
                    resolve();
                }
            });
        },

        storageRemove(key) {
            return new Promise(resolve => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.remove(key, resolve);
                } else {
                    localStorage.removeItem(key);
                    resolve();
                }
            });
        },

        async loadVaultState() {
            const rawVault = await this.storageGet(TOTP_VAULT_STORAGE_KEY);
            const legacyRaw = await this.storageGet(TOTP_LEGACY_STORAGE_KEY);
            this.vaultExists = !!rawVault;
            this.legacyPlainAccountsDetected = !rawVault && !!legacyRaw;
            this.vaultLoading = false;
        },

        getVaultPassphrase() {
            const passphrase = String(this.vaultPassphrase || '');
            if (passphrase.length < 8) {
                throw new Error('保险箱口令至少 8 位');
            }
            return passphrase;
        },

        async createVault() {
            try {
                const passphrase = this.getVaultPassphrase();
                if (passphrase !== String(this.vaultPassphraseConfirm || '')) {
                    throw new Error('两次输入的保险箱口令不一致');
                }
                let accounts = [];
                const legacyRaw = await this.storageGet(TOTP_LEGACY_STORAGE_KEY);
                if (legacyRaw) {
                    try {
                        accounts = JSON.parse(legacyRaw || '[]').map(item => this.normalizeAccount(item));
                    } catch {
                        accounts = [];
                    }
                }
                this.accounts = accounts;
                await this.saveEncryptedAccounts(passphrase);
                await this.storageRemove(TOTP_LEGACY_STORAGE_KEY);
                this.vaultExists = true;
                this.vaultUnlocked = true;
                this.vaultSessionPassphrase = passphrase;
                this.vaultPassphrase = '';
                this.legacyPlainAccountsDetected = false;
                this.vaultPassphraseConfirm = '';
                await this.refreshCodes();
                this.showNotice(accounts.length ? '旧账号已迁移到加密保险箱' : '保险箱已创建');
            } catch (e) {
                this.showNotice(e.message || '创建失败');
            }
        },

        async unlockVault() {
            try {
                const passphrase = this.getVaultPassphrase();
                const rawVault = await this.storageGet(TOTP_VAULT_STORAGE_KEY);
                if (!rawVault) {
                    throw new Error('尚未创建保险箱');
                }
                const accounts = await TOTP_CORE.decryptVault(rawVault, passphrase);
                this.accounts = accounts.map(item => this.normalizeAccount(item));
                this.vaultExists = true;
                this.vaultUnlocked = true;
                this.vaultSessionPassphrase = passphrase;
                this.vaultPassphrase = '';
                await this.refreshCodes();
                this.showNotice('保险箱已解锁');
            } catch (e) {
                this.accounts = [];
                this.codes = {};
                this.vaultUnlocked = false;
                this.showNotice(e.message || '解锁失败');
            }
        },

        lockVault() {
            this.accounts = [];
            this.codes = {};
            this.vaultPassphrase = '';
            this.vaultPassphraseConfirm = '';
            this.vaultSessionPassphrase = '';
            this.vaultUnlocked = false;
            this.revealSecrets = false;
            this.showNotice('保险箱已锁定');
        },

        async saveEncryptedAccounts(passphrase) {
            const vault = await TOTP_CORE.encryptAccounts(this.accounts, passphrase || this.vaultSessionPassphrase || this.getVaultPassphrase());
            await this.storageSet(TOTP_VAULT_STORAGE_KEY, JSON.stringify(vault));
        },

        saveAccounts() {
            if (!this.vaultUnlocked) {
                throw new Error('请先解锁保险箱');
            }
            return this.saveEncryptedAccounts();
        },

        normalizeBase32Secret(secret) {
            return TOTP_CORE.normalizeBase32Secret(secret);
        },

        normalizeAlgorithm(algorithm) {
            return TOTP_CORE.normalizeAlgorithm(algorithm);
        },

        base32ToBytes(secret) {
            return TOTP_CORE.base32ToBytes(secret);
        },

        async generateTotp(secret, period, digits, algorithm) {
            return TOTP_CORE.generateTotp(secret, {
                period,
                digits,
                algorithm,
                timestamp: Date.now()
            });
        },

        async refreshCodes() {
            const nextCodes = {};
            for (const account of this.accounts) {
                try {
                    nextCodes[account.id] = await this.generateTotp(account.secret, account.period, account.digits, account.algorithm);
                } catch {
                    nextCodes[account.id] = 'ERROR';
                }
            }
            this.codes = nextCodes;
        },

        getCode(id) {
            return this.codes[id] || '------';
        },

        getRemainingSeconds(account) {
            const period = Number(account.period || 30);
            return period - (Math.floor(this.now / 1000) % period);
        },

        getProgress(account) {
            const period = Number(account.period || 30);
            return Math.round((this.getRemainingSeconds(account) / period) * 100);
        },

        normalizeAccount(account) {
            return {
                id: account.id || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
                issuer: String(account.issuer || '').trim(),
                name: String(account.name || account.account || '').trim(),
                secret: this.normalizeBase32Secret(account.secret),
                digits: [6, 8].includes(Number(account.digits)) ? Number(account.digits) : 6,
                period: Math.max(15, Math.min(120, Number(account.period) || 30)),
                algorithm: this.normalizeAlgorithm(account.algorithm)
            };
        },

        buildAccount(payload) {
            return this.normalizeAccount({
                id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
                issuer: payload.issuer,
                name: payload.name,
                secret: payload.secret,
                digits: payload.digits,
                period: payload.period,
                algorithm: payload.algorithm
            });
        },

        async addAccount() {
            try {
                if (!this.vaultUnlocked) {
                    throw new Error('请先解锁或创建保险箱');
                }
                const account = this.buildAccount({
                    issuer: this.issuerInput,
                    name: this.accountInput,
                    secret: this.secretInput,
                    digits: this.digitsInput,
                    period: this.periodInput,
                    algorithm: this.algorithmInput
                });
                this.base32ToBytes(account.secret);
                this.accounts.push(account);
                await this.saveAccounts();
                await this.refreshCodes();
                this.issuerInput = '';
                this.accountInput = '';
                this.secretInput = '';
                this.algorithmInput = 'SHA-1';
                this.showNotice('账号已加密保存');
            } catch (e) {
                this.showNotice(e.message || '保存失败');
            }
        },

        parseOtpAuthUri(uri) {
            const url = new URL(uri);
            if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') {
                throw new Error('只支持 otpauth://totp URI');
            }
            const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
            const labelParts = label.split(':');
            return {
                issuer: url.searchParams.get('issuer') || labelParts[0] || '',
                name: labelParts.length > 1 ? labelParts.slice(1).join(':') : label,
                secret: url.searchParams.get('secret') || '',
                digits: Number(url.searchParams.get('digits') || 6),
                period: Number(url.searchParams.get('period') || 30),
                algorithm: this.normalizeAlgorithm(url.searchParams.get('algorithm') || 'SHA-1')
            };
        },

        async importOtpAuthUri() {
            try {
                if (!this.vaultUnlocked) {
                    throw new Error('请先解锁或创建保险箱');
                }
                const account = this.buildAccount(this.parseOtpAuthUri(this.uriInput));
                this.base32ToBytes(account.secret);
                this.accounts.push(account);
                await this.saveAccounts();
                await this.refreshCodes();
                this.uriInput = '';
                this.showNotice('URI 已加密导入');
            } catch (e) {
                this.showNotice(e.message || '导入失败');
            }
        },

        removeAccount(account) {
            if (!window.confirm(`删除 ${account.issuer || account.name || '该账号'}？`)) {
                return;
            }
            this.accounts = this.accounts.filter(item => item.id !== account.id);
            delete this.codes[account.id];
            this.saveAccounts().then(() => this.showNotice('账号已删除'));
        },

        copyCode(account) {
            const code = this.getCode(account.id);
            const done = () => this.showNotice('动态码已复制');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).then(done).catch(() => this.showNotice('复制失败'));
                return;
            }
            const input = document.createElement('textarea');
            input.value = code;
            input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            done();
        },

        toggleSecretReveal() {
            this.revealSecrets = !this.revealSecrets;
        },

        showNotice(message) {
            this.noticeText = message;
            clearTimeout(this.noticeTimerId);
            this.noticeTimerId = setTimeout(() => {
                this.noticeText = '';
            }, 1800);
        }
    }
});
