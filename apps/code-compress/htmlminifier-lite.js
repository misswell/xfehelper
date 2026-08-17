/*
 * XFeHelper HTML minifier
 *
 * A small, dependency-free replacement for HTMLMinifier. It intentionally
 * favors valid output over aggressive optional-tag removal so pasted pages
 * keep their behavior after compression.
 */
(function (root) {
    'use strict';

    var protectedTagPattern = /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
    var booleanAttributes = [
        'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
        'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap',
        'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
        'playsinline', 'readonly', 'required', 'reversed', 'selected'
    ];

    function isBooleanAttribute(name) {
        return booleanAttributes.indexOf(name.toLowerCase()) !== -1;
    }

    function protectBlocks(html, options) {
        var blocks = [];
        var result = html.replace(protectedTagPattern, function (block) {
            var index = blocks.length;
            var tagName = /^<([\w-]+)/.exec(block);
            var lowerTagName = tagName ? tagName[1].toLowerCase() : '';

            if (options.minifyCSS && lowerTagName === 'style') {
                block = block.replace(/>([\s\S]*)<\/style\s*>$/i, function (_, css) {
                    return '>' + css
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/\s*([{}:;,])\s*/g, '$1')
                        .trim() + '</style>';
                });
            }

            blocks.push(block);
            return '\u0000XFE_BLOCK_' + index + '\u0000';
        });

        return { html: result, blocks: blocks };
    }

    function restoreBlocks(html, blocks) {
        return html.replace(/\u0000XFE_BLOCK_(\d+)\u0000/g, function (_, index) {
            return blocks[Number(index)] || '';
        });
    }

    function normalizeOpeningTag(tag, options) {
        var normalized = tag
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+\/>$/, options.keepClosingSlash ? ' />' : '>');

        if (options.collapseBooleanAttributes !== false) {
            normalized = normalized.replace(
                /\s+([\w:-]+)(?:\s*=\s*(?:"\1"|'\1'|\1))(?=\s|\/>|>)/gi,
                function (_, name) {
                    return isBooleanAttribute(name) ? ' ' + name : _;
                }
            );
        }

        if (options.removeEmptyAttributes !== false) {
            normalized = normalized.replace(/\s+(class|id|style|title|lang|dir)=(['"])\2/gi, '');
        }

        if (options.removeRedundantAttributes !== false) {
            normalized = normalized
                .replace(/\s+type=(['"])text\/javascript\1/gi, '')
                .replace(/\s+type=(['"])text\/css\1/gi, '')
                .replace(/\s+language=(['"])javascript\1/gi, '');
        }

        if (options.removeAttributeQuotes !== false) {
            normalized = normalized.replace(
                /\s([\w:-]+)=(['"])([A-Za-z0-9._:/#?&=+\-]+)\2/g,
                ' $1=$3'
            );
        }

        return normalized;
    }

    function minify(input, options) {
        options = options || {};
        var html = String(input == null ? '' : input);

        if (options.removeComments !== false) {
            html = html.replace(/<!--(?!\[if[\s\S]*?\])[\s\S]*?-->/gi, '');
        }

        var protectedContent = protectBlocks(html, options);
        html = protectedContent.html
            .replace(/<!doctype\s+html[^>]*>/i, '<!doctype html>')
            .replace(/\s+/g, ' ')
            .replace(/>\s+</g, '><')
            .replace(/<([a-z][\w:-]*)([^<>]*?)>/gi, function (whole, name, attributes) {
                return normalizeOpeningTag('<' + name + attributes + '>', options);
            })
            .trim();

        return restoreBlocks(html, protectedContent.blocks);
    }

    root.XFeHtmlMinifier = { minify: minify };
}(window));
