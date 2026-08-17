/* Minimal HTML entity helper for the two entity actions in en-decode. */
(function (root) {
    'use strict';

    const named = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function numeric(codePoint) {
        return `&#x${codePoint.toString(16)};`;
    }

    function encode(value, options) {
        const text = String(value);
        options = options || {};
        if (!options.encodeEverything) {
            if (options.allowUnsafeSymbols) return text;
            return text.replace(/[&<>"']/g, symbol => named[symbol]);
        }

        return Array.from(text).map(symbol => {
            if (options.useNamedReferences && named[symbol]) return named[symbol];
            return numeric(symbol.codePointAt(0));
        }).join('');
    }

    function decode(value) {
        const text = String(value);
        if (typeof document === 'undefined') {
            return text.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos|nbsp);?/gi, (match, decimal, hexadecimal) => {
                if (decimal) return String.fromCodePoint(Number(decimal));
                if (hexadecimal) return String.fromCodePoint(parseInt(hexadecimal, 16));
                return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' }[match.toLowerCase()] || match;
            });
        }
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }

    root.he = {
        version: 'xfehelper-lite',
        encode,
        decode,
        escape: encode,
        unescape: decode
    };
}(typeof globalThis === 'object' ? globalThis : window));
