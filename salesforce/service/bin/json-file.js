import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** A file that exists but could not be read or parsed. Callers refuse; it never means "not there". */
export class UnreadableFileError extends Error {
    file;
    constructor(file, detail) {
        super(`Cannot read ${file}: ${detail}`);
        this.name = 'UnreadableFileError';
        this.file = file;
    }
}
export function readJsonFile(file) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { state: 'missing' };
        return { state: 'unreadable', detail: error.code ?? 'read failed' };
    }
    try {
        return { state: 'ok', value: JSON.parse(text) };
    }
    catch {
        return { state: 'unreadable', detail: 'not valid JSON' };
    }
}
/** Null only when the file is missing. Anything unreadable throws, so a caller cannot read it as "not started". */
export function readJson(file) {
    const read = readJsonFile(file);
    switch (read.state) {
        case 'missing':
            return null;
        case 'unreadable':
            throw new UnreadableFileError(file, read.detail);
        case 'ok':
            return read.value;
        default: {
            const exhaustive = read;
            return exhaustive;
        }
    }
}
/** Temp file, fsync, rename. A crash leaves the old file or the new one, never half of either. */
export function writeFileAtomic(file, text) {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
        const handle = openSync(temp, 'wx', 0o600);
        try {
            writeFileSync(handle, text);
            fsyncSync(handle);
        }
        finally {
            closeSync(handle);
        }
        renameWithRetry(temp, file);
    }
    catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
}
export function writeJson(file, value) {
    writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}
/** Windows refuses a rename while another process has the target open. That passes in moments. */
function renameWithRetry(from, to) {
    for (let attempt = 0;; attempt += 1) {
        try {
            renameSync(from, to);
            return;
        }
        catch (error) {
            const code = error.code;
            if ((code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') || attempt >= 40)
                throw error;
            sleepSync(25);
        }
    }
}
export function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
