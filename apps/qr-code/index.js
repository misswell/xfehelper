/**
 * XFeHelper QR Code Tools
 */

function syncQrPageDarkMode(enabled) {
    document.body.classList.toggle('theme-dark', !!enabled);
    document.body.classList.toggle('theme-default', !enabled);
    document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    document.documentElement.setAttribute('dark-mode', enabled ? 'on' : 'off');
}

new Vue({
    el: '#pageContainer',
    data: {
        textContent: '',
        qrSize: 200,
        qrColor: '#000000',
        useIcon: 'no',
        previewSrc: '',
        resultContent: '',
        qrEncodeMode: true,
        showResult: false,
        codeType: 'qrcode',
        barcodeFormat: 'CODE128',
        barcodeMode: false
    },
    mounted: function () {
        if (window.DarkModeMgr && DarkModeMgr.watchAutoDarkMode) {
            DarkModeMgr.watchAutoDarkMode(syncQrPageDarkMode, {applyFilter: false});
        } else if (window.chrome && chrome.runtime && window.DarkModeMgr) {
            DarkModeMgr.turnLightAuto();
        }

        let mode = new URL(location.href).searchParams.get('mode');
        this.qrEncodeMode = mode !== 'decode';

        // 在tab创建或者更新时候，监听事件，看看是否有参数传递过来
        if (location.protocol === 'chrome-extension:') {
            chrome.tabs.query({currentWindow: true,active: true, }, (tabs) => {
                let activeTab = tabs.filter(tab => tab.active)[0];
                chrome.runtime.sendMessage({
                    type: 'fh-dynamic-any-thing',
                    thing: 'request-page-content',
                    tabId: activeTab.id
                }).then(resp => {
                    if(!resp) return ;
                    let text = resp.content || (resp.tab ? (resp.tab.fromTab ? resp.tab.fromTab.url : '') : '');
                    if (text) {
                        if (!this.qrEncodeMode) {
                            // 解码模式
                            this._qrDecode(text);
                        } else {
                            this.textContent = text;
                            this.convert();
                        }
                    }
                });
            });
        }

        this.$refs.codeSource && this.$refs.codeSource.focus();

        // 拖拽注册
        document.addEventListener('drop', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            let files = evt.dataTransfer.files;
            if (files.length) {
                if (this.qrEncodeMode) {
                    this._drawIcon(files[0]);
                } else {
                    this._decodeLocal(files[0]);
                }
            }
        }, false);

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);


        //监听paste事件
        document.addEventListener('paste', (event) => {
            if (this.qrEncodeMode) return;
            this.paste(event);
        }, false);

        // color picker绑定
        $("#opt_fc").colorpicker({
            fillcolor: true,
            success: (obj, color) => {
                this.qrColor = color;
                this.convert();
            }
        })

        this.loadPatchHotfix();
    },
    methods: {

        loadPatchHotfix() {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
                return;
            }
            // 页面加载时自动获取并注入页面的补丁
            chrome.runtime.sendMessage({
                type: 'fh-dynamic-any-thing',
                thing: 'fh-get-tool-patch',
                toolName: 'qr-code'
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
                            console.error('qr-code补丁JS执行失败', e);
                        }
                    }
                }
            });
        },
        convert: function () {
            this.showResult = true;
            this.$nextTick(() => {
                if (!this.textContent) {
                    $('#preview').html('请在输入框里输入内容');
                    this.barcodeMode = false;
                    return;
                }
                if (this.codeType === 'barcode') {
                    this.barcodeMode = true;
                    $('#preview').html('<svg id="barcodeSvg"></svg>');
                    try {
                        JsBarcode('#barcodeSvg', this.textContent, {
                            format: this.barcodeFormat,
                            width: 2,
                            height: 100,
                            displayValue: true,
                            fontSize: 14,
                            valid: function(valid) {
                                if (!valid) throw new Error('输入内容不符合所选格式要求');
                            }
                        });
                    } catch(e) {
                        var hints = {
                            'EAN13': '需要 13 位纯数字（最后一位为校验位，可只输 12 位自动补全）',
                            'EAN8': '需要 8 位纯数字（可只输 7 位自动补全校验位）',
                            'UPC': '需要 12 位纯数字（可只输 11 位自动补全校验位）',
                            'ITF14': '需要 14 位纯数字'
                        };
                        var msg = (e && (e.message || String(e))) || '未知错误';
                        msg = msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                        var hint = hints[this.barcodeFormat];
                        if (hint) msg += '<br><span style="font-size:12px;color:#666">提示：' + hint + '</span>';
                        $('#preview').html('<div style="color:red;text-align:center;padding:20px">条形码生成失败<br>' + msg + '</div>');
                        this.barcodeMode = false;
                    }
                } else {
                    this.barcodeMode = false;
                    $('#preview').html('').qrcode(this._createOptions());
                }
            });
        },

        fileChanged: function (event) {
            if (event.target.files.length) {
                if (this.qrEncodeMode) {
                    this._drawIcon(event.target.files[0]);
                } else {
                    this._decodeLocal(event.target.files[0]);
                }
                event.target.value = '';
            }
        },

        _drawIcon: function (file) {
            if (/image\//.test(file.type)) {
                this.useIcon = 'custom';
                let reader = new FileReader();
                reader.onload = (evt) => {
                    this.$refs.logoCustom.src = evt.target.result;
                    this.convert();
                };
                reader.readAsDataURL(file);
            } else {
                alert('请选择图片文件！');
            }
        },

        _createOptions: function () {
            let defaultOptions = {
                render: 'canvas',
                minVersion: 1,
                maxVersion: 40,
                ecLevel: 'L',
                left: 0,
                top: 0,
                size: +this.qrSize || 200,
                fill: this.qrColor,
                background: '#fff',
                radius: 0,
                quiet: 0,
                text: this.textContent,
                mode: 0,
                mSize: 0.15,
                mPosX: 0.5,
                mPosY: 0.5,
                label: 'FH',
                fontname: 'sans',
                fontcolor: '#f00',
                image: false
            };

            // 判断是否需要设置icon
            switch (this.useIcon) {
                case 'default':
                    defaultOptions.mode = 4;
                    defaultOptions.image = this.$refs.logoDefault;
                    break;
                case 'custom':
                    defaultOptions.mode = 4;
                    defaultOptions.image = this.$refs.logoCustom;
                    break;
            }

            return defaultOptions;
        },

        trans: function () {
            this.qrEncodeMode = !this.qrEncodeMode;
        },
        select: function () {
            this.$refs.resultBox.select();
        },

        _decodeLocal: function (file) {
            let reader = new FileReader();
            reader.onload = (e) => {
                this._qrDecode(e.target.result);
            };
            reader.readAsDataURL(file);
        },

        paste: function (event) {
            let items = event.clipboardData.items || {};

            // 优先处理图片
            for (let index in items) {
                let item = items[index];
                if (/image\//.test(item.type)) {
                    let file = item.getAsFile();
                    return this._decodeLocal(file);
                }
            }

            // 然后处理url
            try {
                // 逐个遍历
                (async () => {
                    for (let index in items) {
                        let item = items[index];
                        if (/text\/plain/.test(item.type)) {
                            let url = await new Promise(resolve => {
                                item.getAsString(url => resolve(url))
                            });
                            let flag = await new Promise(resolve => {
                                this._qrDecode(url, flag => resolve(flag));
                            });
                            if (flag) break;
                        }
                    }
                })();
            } catch (ex) {
                // 只能处理一个了
                for (let index in items) {
                    let item = items[index];
                    if (/text\/plain/.test(item.type)) {
                        return item.getAsString(url => {
                            this._qrDecode(url);
                        });
                    }
                }
            }
        },

        /**
         * 二维码转码
         * @param imgSrc
         * @param callback
         */
        _qrDecode: function (imgSrc, callback) {

            let self = this;
            let image = new Image();
            image.setAttribute('crossOrigin', 'Anonymous');
            image.onload = async function () {
                try {
                    const result = await self._decodeImageWithRetries(this);
                    self._showDecodeResult(imgSrc, result.text);
                    callback && callback(result.text);
                } catch (err) {
                    const message = self._formatQrDecodeError(err);
                    console.warn('二维码解码失败', err);
                    self._showDecodeResult(imgSrc, message);
                    callback && callback(false);
                }
            };
            image.onerror = function (e) {
                callback && callback(false);
                alert('抱歉，当前图片无法被解码，请保存图片再拖拽进来试试！')
            };
            image.src = imgSrc;
        },

        _decodeImageWithRetries: async function(image) {
            const candidates = this._createQrDecodeCandidates(image);
            let lastError = null;

            for (let i = 0; i < candidates.length; i++) {
                try {
                    const result = this._decodeQrSource(candidates[i].source);
                    if (result && result.text) {
                        return result;
                    }
                } catch (err) {
                    lastError = err;
                }
            }

            throw lastError || new Error('二维码解析失败');
        },

        _decodeQrSource: function(source) {
            if (typeof jsQR !== 'function') {
                throw new Error('二维码解码器未加载');
            }

            const width = source.naturalWidth || source.videoWidth || source.width || 0;
            const height = source.naturalHeight || source.videoHeight || source.height || 0;
            if (!width || !height) {
                throw new Error('二维码图片尺寸无效');
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            if (!context) throw new Error('浏览器不支持图像读取');

            context.drawImage(source, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height, {
                inversionAttempts: 'attemptBoth'
            });
            if (!result || !result.data) {
                throw new Error('NotFoundException: 未识别到二维码');
            }
            return {text: result.data};
        },

        _createQrDecodeCandidates: function(image) {
            const candidates = [{ label: 'original', source: image }];
            const width = image.naturalWidth || image.width || 0;
            const height = image.naturalHeight || image.height || 0;

            if (!width || !height) {
                return candidates;
            }

            [
                { label: 'padded', padding: 32, scale: 1 },
                { label: 'scaled', padding: 48, scale: Math.max(2, Math.ceil(800 / Math.max(width, height))) },
                { label: 'contrast', padding: 64, scale: Math.max(2, Math.ceil(1000 / Math.max(width, height))), grayscale: true, contrast: 1.35 }
            ].forEach(config => {
                const source = this._drawQrDecodeCanvas(image, config);
                if (source) {
                    candidates.push({ label: config.label, source });
                }
            });

            return candidates;
        },

        _drawQrDecodeCanvas: function(image, config) {
            try {
                const sourceWidth = image.naturalWidth || image.width;
                const sourceHeight = image.naturalHeight || image.height;
                const scale = Math.max(1, Math.min(config.scale || 1, 4));
                const padding = config.padding || 0;
                const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
                const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { willReadFrequently: !!config.grayscale });

                if (!context) {
                    return null;
                }

                canvas.width = targetWidth + padding * 2;
                canvas.height = targetHeight + padding * 2;
                context.fillStyle = '#fff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.imageSmoothingEnabled = false;
                context.drawImage(image, padding, padding, targetWidth, targetHeight);

                if (config.grayscale) {
                    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imageData.data;
                    const contrast = config.contrast || 1;

                    for (let i = 0; i < data.length; i += 4) {
                        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                        const adjusted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
                        data[i] = adjusted;
                        data[i + 1] = adjusted;
                        data[i + 2] = adjusted;
                    }

                    context.putImageData(imageData, 0, 0);
                }

                return canvas;
            } catch (err) {
                console.warn('二维码候选图生成失败', err);
                return null;
            }
        },

        _formatQrDecodeError: function(err) {
            const details = err && (err.message || String(err)) || '';

            if (/tainted|cross-origin|cors|security/i.test(details)) {
                return '二维码解析失败：当前图片存在跨域限制。请保存图片后拖拽上传，或截图后粘贴到这里再试。';
            }

            if (/No MultiFormat Readers|detect the code|NotFound/i.test(details)) {
                return '未识别到二维码内容。请确认图片中二维码完整清晰，或尝试截图后粘贴、保存原图后上传。';
            }

            return '二维码解析失败。请换用更清晰的原图，或截图后粘贴到这里再试。';
        },

        _showDecodeResult: function (src, txt) {
            this.previewSrc = src;
            this.$refs.panelBox.style.backgroundImage = 'none';
            this.resultContent = txt;
        },

        copyQR: function() {
            const canvas = this.$el.querySelector('#preview canvas');
            const copyButton = this.$el.querySelector('#copy_button');
            const originalText = '复制';

            if (!canvas || !copyButton) {
                alert('请先生成二维码！');
                return;
            }

            canvas.toBlob(blob => {
                if (navigator.clipboard && navigator.clipboard.write) {
                    navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
                    .then(() => {
                        copyButton.textContent = '√ 已复制';
                        copyButton.classList.add('btn-action-success');

                        setTimeout(() => {
                            copyButton.textContent = originalText;
                            copyButton.classList.remove('btn-action-success');
                        }, 2000);
                    }).catch(err => {
                        console.error('无法复制二维码: ', err);
                        alert('复制失败，请检查浏览器权限或手动截图。');
                    });
                } else {
                    alert('当前浏览器不支持自动复制图片，请手动截图。');
                }
            });
        },

        downloadQR: function() {
            if (this.codeType === 'barcode' && this.barcodeMode) {
                const svg = document.getElementById('barcodeSvg');
                if (svg) {
                    const svgData = new XMLSerializer().serializeToString(svg);
                    const blob = new Blob([svgData], {type: 'image/svg+xml'});
                    const link = document.createElement('a');
                    link.download = 'barcode.svg';
                    link.href = URL.createObjectURL(blob);
                    link.click();
                    URL.revokeObjectURL(link.href);
                } else {
                    alert('请先生成条形码！');
                }
            } else {
                const canvas = this.$el.querySelector('#preview canvas');
                if (canvas) {
                    const link = document.createElement('a');
                    link.download = 'qrcode.png';
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                } else {
                    alert('请先生成二维码！');
                }
            }
        },

        openOptionsPage: function(event ){
            event.preventDefault();
            event.stopPropagation();
            if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
                 chrome.runtime.openOptionsPage();
            } else {
                 console.error('无法打开选项页。');
            }
        },

    }
});
