/*
 * XFeHelper JavaScript minifier
 *
 * This is a dependency-free lexical minifier. It preserves strings, template
 * literals, regular expressions, protected comments, and the whitespace that
 * is required between JavaScript tokens. It deliberately avoids unsafe AST
 * rewrites, so pasted code keeps its runtime behavior.
 */
(function (root) {
    'use strict';

    var identifierPart = /[A-Za-z0-9_$]/;
    var regexPrefix = /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|new|else|do)$/;

    function isIdentifierPart(char) {
        return !!char && identifierPart.test(char);
    }

    function isRegexStart(output) {
        var match = output.match(/([A-Za-z_$][\w$]*|[^\s])\s*$/);
        if (!match) return true;
        return regexPrefix.test(match[1]) || /[({[=,:;!?&|+*%^~<>-]/.test(match[1]);
    }

    function readQuoted(source, start, quote) {
        var index = start + 1;
        while (index < source.length) {
            if (source[index] === '\\') {
                index += 2;
            } else if (source[index] === quote) {
                return index + 1;
            } else {
                index += 1;
            }
        }
        return source.length;
    }

    function readRegex(source, start) {
        var index = start + 1;
        var inClass = false;
        while (index < source.length) {
            var char = source[index];
            if (char === '\\') {
                index += 2;
            } else if (char === '[') {
                inClass = true;
                index += 1;
            } else if (char === ']') {
                inClass = false;
                index += 1;
            } else if (char === '/' && !inClass) {
                index += 1;
                while (/[A-Za-z]/.test(source[index] || '')) index += 1;
                return index;
            } else {
                index += 1;
            }
        }
        return source.length;
    }

    function needsSpace(left, right) {
        if (isIdentifierPart(left) && isIdentifierPart(right)) return true;
        if ((left === '+' && right === '+') || (left === '-' && right === '-')) return true;
        if (left === '/' && right === '/') return true;
        return false;
    }

    function preserveComment(comment) {
        return /^\/\*!|@preserve|@license/i.test(comment);
    }

    function minify(source) {
        source = String(source == null ? '' : source);
        var output = '';
        var pendingSpace = false;
        var index = 0;

        while (index < source.length) {
            var char = source[index];

            if (/\s/.test(char)) {
                pendingSpace = true;
                index += 1;
                continue;
            }

            if (char === '/' && source[index + 1] === '/') {
                var lineEnd = source.indexOf('\n', index + 2);
                var lineComment = source.slice(index, lineEnd < 0 ? source.length : lineEnd);
                if (preserveComment(lineComment)) output += lineComment;
                pendingSpace = true;
                index = lineEnd < 0 ? source.length : lineEnd + 1;
                continue;
            }

            if (char === '/' && source[index + 1] === '*') {
                var commentEnd = source.indexOf('*/', index + 2);
                var blockEnd = commentEnd < 0 ? source.length : commentEnd + 2;
                var blockComment = source.slice(index, blockEnd);
                if (preserveComment(blockComment)) output += blockComment;
                pendingSpace = true;
                index = blockEnd;
                continue;
            }

            if (char === '"' || char === "'" || char === '`') {
                if (pendingSpace && needsSpace(output[output.length - 1], char)) output += ' ';
                pendingSpace = false;
                var quotedEnd = readQuoted(source, index, char);
                output += source.slice(index, quotedEnd);
                index = quotedEnd;
                continue;
            }

            if (char === '/' && isRegexStart(output)) {
                if (pendingSpace && needsSpace(output[output.length - 1], char)) output += ' ';
                pendingSpace = false;
                var regexEnd = readRegex(source, index);
                output += source.slice(index, regexEnd);
                index = regexEnd;
                continue;
            }

            if (pendingSpace && needsSpace(output[output.length - 1], char)) output += ' ';
            pendingSpace = false;
            output += char;
            index += 1;
        }

        return output.trim();
    }

    root.UglifyJs3 = {
        compress: function (input) {
            try {
                return { out: minify(input) || '/* 无内容输出！ */' };
            } catch (error) {
                return { error: error };
            }
        }
    };
}(window));
