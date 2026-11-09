import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { UnreadableFileError } from './json-file.js';
import { journalDirectory, journalFile } from './paths.js';
import { redactSecrets } from './redact.js';
const PERSONAL = /@[a-z0-9.-]+\.[a-z]{2,}/i;
const QUOTED = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'/g;
const BARE_LITERAL = /((?:!=|<>|<=|>=|=|<|>)\s*)(?:true|false|-?\d[\w:.+-]*)/gi;
/** The choke point for literals. Callers pass binds already, and anything they miss stops here: strings, numbers, dates, and booleans. */
export function bindLiterals(soql) {
    return soql.replace(STRING_LITERAL, ':b').replace(BARE_LITERAL, '$1:b');
}
/** A note that looks personal is not kept, and what it quoted is dropped. */
export function appendJournal(projectRoot, line) {
    const file = journalFile(projectRoot, line.correlationId);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(redactLine(line))}\n`, 'utf8');
}
/** Empty when the journal is missing. Anything unreadable throws, so a caller cannot read it as "nothing happened". */
export function readJournal(projectRoot, correlationId) {
    const file = journalFile(projectRoot, correlationId);
    let text;
    try {
        text = readFileSync(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw new UnreadableFileError(file, error.code ?? 'read failed');
    }
    try {
        return text
            .split(/\r?\n/)
            .filter(line => line.length > 0)
            .map(line => JSON.parse(line));
    }
    catch {
        throw new UnreadableFileError(file, 'a line is not valid JSON');
    }
}
/** Every line of every journal in this project. Anything unreadable throws, so a caller can't read it as "nothing happened". */
export function readAllJournals(projectRoot) {
    const dir = journalDirectory(projectRoot);
    let names;
    try {
        names = readdirSync(dir);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw new UnreadableFileError(dir, error.code ?? 'read failed');
    }
    return names.filter(name => name.endsWith('.jsonl')).flatMap(name => readJournal(projectRoot, name.slice(0, -'.jsonl'.length)));
}
function redactLine(line) {
    const next = { ...line };
    if (next.soql !== undefined)
        next.soql = bindLiterals(redactSecrets(next.soql));
    if (next.note !== undefined) {
        next.note = PERSONAL.test(next.note) ? 'Personal values withheld from the journal.' : redactSecrets(next.note).replace(QUOTED, ':b');
    }
    return next;
}
