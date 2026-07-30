import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = path.resolve('src/client');
const localeRoot = path.resolve('src/shared/locales');
const failures = [];
const usedKeys = new Set();
const forbiddenCjk = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
const visibleAttributes = new Set(['alt', 'aria-label', 'description', 'hint', 'label', 'placeholder', 'title']);
const english = readMessages(path.join(localeRoot, 'en-US.ts'), 'EN_US_MESSAGES');
const chinese = readMessages(path.join(localeRoot, 'zh-CN.ts'), 'ZH_CN_MESSAGES');
for (const key of english.keys()) {
    if (!chinese.has(key))
        failures.push(`missing zh-CN message: ${key}`);
    if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/.test(key))
        failures.push(`invalid English message key: ${key}`);
    if (forbiddenCjk.test(key))
        failures.push(`Chinese text used as a message key: ${key}`);
}
for (const key of chinese.keys()) {
    if (!english.has(key))
        failures.push(`missing en-US message: ${key}`);
}
for (const [key, value] of english) {
    if (forbiddenCjk.test(value))
        failures.push(`untranslated en-US message: ${key}`);
    if (placeholders(value) !== placeholders(chinese.get(key) ?? ''))
        failures.push(`placeholder mismatch: ${key}`);
}
const englishOnlyPaths = [
    path.resolve('src'),
    path.resolve('scripts'),
    path.resolve('tests'),
    path.resolve('public'),
    path.resolve('.github'),
];
for (const file of englishOnlyPaths.flatMap((target) => fs.existsSync(target) ? [...walk(target)] : [])) {
    if (file === path.join(localeRoot, 'zh-CN.ts') || !isTextSource(file))
        continue;
    rejectHan(file);
}
for (const file of [
    'index.html',
    'package.json',
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'vite.config.ts',
    'vitest.config.ts',
    'wrangler.toml',
    ...fs.readdirSync(process.cwd()).filter((name) => /^tsconfig.*\.json$/.test(name)),
]) {
    const target = path.resolve(file);
    if (fs.existsSync(target))
        rejectHan(target);
}
for (const file of walk(root)) {
    if (!/\.tsx?$/.test(file) || file.includes(`${path.sep}locales${path.sep}`) || file.endsWith(`${path.sep}i18n.ts`))
        continue;
    const sourceText = fs.readFileSync(file, 'utf8');
    const isTestFile = file.includes('.test.');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    visit(source);
    function visit(node) {
        if (ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 't' &&
            node.arguments[0]) {
            if (!insideFunction(node))
                report(node, 'module-scope t() freezes the initial locale');
            const argument = node.arguments[0];
            if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
                usedKeys.add(argument.text);
                if (!english.has(argument.text))
                    report(argument, `unknown message key ${JSON.stringify(argument.text)}`);
                if (/\p{Script=Han}/u.test(argument.text))
                    report(argument, 'message keys must be English identifiers');
            }
        }
        if (!isTestFile && ts.isJsxText(node) && /[\p{L}\p{N}]/u.test(node.text) && node.text.trim())
            report(node, `unlocalized JSX text ${JSON.stringify(node.text.trim())}`);
        if (!isTestFile && ts.isJsxAttribute(node) && visibleAttributes.has(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) {
            const value = node.initializer.text.trim();
            if (value && !isTechnicalPlaceholder(node.name.text, value))
                report(node, `unlocalized ${node.name.text} attribute ${JSON.stringify(value)}`);
        }
        if (!isTestFile &&
            (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
            /\p{Script=Han}/u.test(node.text) &&
            !insideTranslationCall(node)) {
            report(node, JSON.stringify(node.text));
        }
        ts.forEachChild(node, visit);
    }
    function report(node, message) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(`${path.relative(process.cwd(), file)}:${position.line + 1}:${position.character + 1} ${message}`);
    }
}
if (failures.length) {
    console.error(`i18n validation failed (${failures.length}):`);
    failures.forEach((failure) => console.error(`  ${failure}`));
    process.exit(1);
}
console.log(`i18n check passed: ${english.size} English keys with complete en-US and zh-CN resources`);
function placeholders(value) {
    return [...value.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((match) => match[0]).sort().join('|');
}
function isTechnicalPlaceholder(name, value) {
    return name === 'placeholder' && (/^(?:https?:\/\/|[a-z0-9_.-]+\/?$)/i.test(value) || value === '…');
}
function isTextSource(file) {
    return /\.(?:css|html|js|jsx|json|md|mjs|svg|toml|ts|tsx)$/.test(file);
}
function rejectHan(file) {
    const source = fs.readFileSync(file, 'utf8');
    const match = forbiddenCjk.exec(source);
    if (!match)
        return;
    const before = source.slice(0, match.index);
    const line = before.split(/\r?\n/).length;
    const column = match.index - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
    failures.push(`${path.relative(process.cwd(), file)}:${line}:${column} Chinese text is allowed only in src/shared/locales/zh-CN.ts`);
}
function insideTranslationCall(node) {
    let current = node;
    while (current.parent && !ts.isStatement(current.parent) && !ts.isJsxElement(current.parent)) {
        const parent = current.parent;
        if (ts.isCallExpression(parent) &&
            ts.isIdentifier(parent.expression) &&
            parent.expression.text === 't' &&
            parent.arguments[0] &&
            contains(parent.arguments[0], node))
            return true;
        current = parent;
    }
    return false;
}
function contains(parent, child) {
    return child.pos >= parent.pos && child.end <= parent.end;
}
function insideFunction(node) {
    let current = node.parent;
    while (current) {
        if (ts.isFunctionLike(current))
            return true;
        if (ts.isSourceFile(current))
            return false;
        current = current.parent;
    }
    return false;
}
function readMessages(file, variableName) {
    const messages = new Map();
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    visit(source);
    return messages;
    function visit(node) {
        if (ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === variableName &&
            node.initializer) {
            const initializer = unwrap(node.initializer);
            if (!ts.isObjectLiteralExpression(initializer))
                return;
            for (const property of initializer.properties) {
                if (ts.isPropertyAssignment(property) &&
                    (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name)) &&
                    ts.isStringLiteralLike(property.initializer))
                    messages.set(property.name.text, property.initializer.text);
            }
        }
        ts.forEachChild(node, visit);
    }
}
function unwrap(node) {
    while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))
        node = node.expression;
    return node;
}
function* walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory())
            yield* walk(target);
        else
            yield target;
    }
}
