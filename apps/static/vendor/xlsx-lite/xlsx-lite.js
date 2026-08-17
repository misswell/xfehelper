/*
 * XFeHelper XLSX reader
 *
 * This intentionally implements the small part of the SheetJS API used by
 * chart-maker and excel2json.  Keeping the ZIP/XML work in the browser lets us
 * share the already bundled fflate runtime and removes the much larger general
 * purpose spreadsheet bundle from the extension.
 */
(function (root) {
    'use strict';

    const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    function zipPath(base, target) {
        if (!target) return '';
        const parts = (target.charAt(0) === '/' ? target.slice(1) : `${base}/${target}`).split('/');
        const result = [];
        parts.forEach(part => {
            if (!part || part === '.') return;
            if (part === '..') result.pop();
            else result.push(part);
        });
        return result.join('/');
    }

    function asBytes(input, type) {
        if (type === 'binary' || typeof input === 'string') {
            const bytes = new Uint8Array(input.length);
            for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 255;
            return bytes;
        }
        if (input instanceof ArrayBuffer) return new Uint8Array(input);
        if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        throw new TypeError('XLSX.read expects an ArrayBuffer, typed array, or binary string');
    }

    function decode(bytes) {
        if (root.fflate && root.fflate.strFromU8) return root.fflate.strFromU8(bytes);
        return new TextDecoder().decode(bytes);
    }

    function parseXml(source, fileName) {
        const document = new DOMParser().parseFromString(source, 'application/xml');
        if (document.getElementsByTagName('parsererror').length) {
            throw new Error(`无法解析 Excel XML：${fileName}`);
        }
        return document;
    }

    function attr(node, name) {
        return node.getAttribute(name) || node.getAttributeNS(REL_NS, name) || '';
    }

    function all(node, name) {
        return Array.prototype.slice.call(node.getElementsByTagName(name));
    }

    function nodeText(node) {
        return node ? (node.textContent || '') : '';
    }

    function columnIndex(reference) {
        const letters = /^([A-Z]+)/i.exec(reference || '');
        if (!letters) return 0;
        return letters[1].toUpperCase().split('').reduce((index, letter) => {
            return index * 26 + letter.charCodeAt(0) - 64;
        }, 0) - 1;
    }

    function readSharedStrings(files) {
        const file = files['xl/sharedStrings.xml'];
        if (!file) return [];
        const document = parseXml(decode(file), 'sharedStrings.xml');
        return all(document, 'si').map(item => all(item, 't').map(nodeText).join(''));
    }

    function readCell(cell, sharedStrings) {
        const type = attr(cell, 't');
        const valueNode = all(cell, 'v')[0];
        const raw = nodeText(valueNode);

        if (type === 's') return sharedStrings[Number(raw)] || '';
        if (type === 'inlineStr') return nodeText(all(cell, 'is')[0]);
        if (type === 'b') return raw === '1' || raw.toLowerCase() === 'true';
        if (type === 'e' || type === 'str' || type === 'd') return raw;
        if (raw === '') return '';

        const number = Number(raw);
        return Number.isNaN(number) ? raw : number;
    }

    function readSheet(files, fileName, sharedStrings) {
        const document = parseXml(decode(files[fileName]), fileName);
        const rows = [];
        all(document, 'row').forEach((rowNode, rowPosition) => {
            const rowIndex = Math.max(0, Number(attr(rowNode, 'r')) - 1) || rowPosition;
            const row = [];
            all(rowNode, 'c').forEach((cell, cellPosition) => {
                const index = columnIndex(attr(cell, 'r')) || cellPosition;
                row[index] = readCell(cell, sharedStrings);
            });
            while (rows.length <= rowIndex) rows.push([]);
            rows[rowIndex] = row;
        });
        return { rows };
    }

    function read(input, options) {
        options = options || {};
        if (!root.fflate || !root.fflate.unzipSync) {
            throw new Error('XLSX 读取器需要 fflate');
        }
        const files = root.fflate.unzipSync(asBytes(input, options.type));
        const workbookFile = files['xl/workbook.xml'];
        if (!workbookFile) throw new Error('不是有效的 XLSX 文件');

        const workbook = parseXml(decode(workbookFile), 'workbook.xml');
        const relationshipsFile = files['xl/_rels/workbook.xml.rels'];
        const relationships = {};
        if (relationshipsFile) {
            const relationshipDocument = parseXml(decode(relationshipsFile), 'workbook.xml.rels');
            all(relationshipDocument, 'Relationship').forEach(item => {
                relationships[attr(item, 'Id')] = zipPath('xl', attr(item, 'Target'));
            });
        }

        const sharedStrings = readSharedStrings(files);
        const sheetNames = [];
        const sheets = {};
        all(workbook, 'sheet').forEach((sheetNode, index) => {
            const name = attr(sheetNode, 'name') || `Sheet${index + 1}`;
            const relationshipId = attr(sheetNode, 'id');
            const fileName = relationships[relationshipId] || `xl/worksheets/sheet${index + 1}.xml`;
            if (!files[fileName]) throw new Error(`找不到工作表：${name}`);
            sheetNames.push(name);
            sheets[name] = readSheet(files, fileName, sharedStrings);
        });

        return { SheetNames: sheetNames, Sheets: sheets };
    }

    function valueOrDefault(value, defaultValue) {
        return value === undefined || value === null ? defaultValue : value;
    }

    function sheetToJson(sheet, options) {
        options = options || {};
        const rows = sheet.rows || [];
        if (options.header === 1) {
            return rows.map(row => row.map(value => valueOrDefault(value, options.defval)));
        }

        const header = rows[0] || [];
        return rows.slice(1).map(row => {
            const result = {};
            header.forEach((key, index) => {
                const name = key === undefined || key === '' ? `__EMPTY${index ? '_' + index : ''}` : String(key);
                result[name] = valueOrDefault(row[index], options.defval);
            });
            return result;
        });
    }

    function csvValue(value) {
        const text = value === undefined || value === null ? '' : String(value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function sheetToCsv(sheet) {
        return (sheet.rows || []).map(row => row.map(csvValue).join(',')).join('\n');
    }

    root.XLSX = {
        read,
        utils: {
            sheet_to_json: sheetToJson,
            sheet_to_csv: sheetToCsv
        }
    };
}(typeof globalThis === 'object' ? globalThis : window));
