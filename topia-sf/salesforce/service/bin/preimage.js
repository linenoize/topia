import { closeSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomic } from './json-file.js';
import { MS_PER_DAY, RETENTION_DAYS } from './log-retention.js';
import { localFile } from './paths.js';
import { sha256 } from './plans.js';
export function preImageFile(storeRoot, projectRoot, planId) {
    return localFile(storeRoot, projectRoot, 'preimages', planId);
}
export function retainUntil(now) {
    return new Date(now + RETENTION_DAYS * MS_PER_DAY).toISOString();
}
/** A rename isn't durable on POSIX until its folder is. Windows can't open a folder this way, and doesn't need to. */
function fsyncFolder(folder) {
    try {
        const handle = openSync(folder, 'r');
        try {
            fsyncSync(handle);
        }
        finally {
            closeSync(handle);
        }
    }
    catch {
        // Nothing else can be done here, and the file itself is already synced.
    }
}
/** Temp file, fsync, rename. Returns the hash of what landed, for the journal. */
export function savePreImage(storeRoot, projectRoot, image) {
    const file = preImageFile(storeRoot, projectRoot, image.planId);
    const text = `${JSON.stringify(image, null, 2)}\n`;
    writeFileAtomic(file, text);
    fsyncFolder(dirname(file));
    return sha256(text);
}
function isPreImage(value, planId) {
    if (value === null || typeof value !== 'object')
        return false;
    const image = value;
    return image.version === 1 && image.planId === planId && Array.isArray(image.records) && Array.isArray(image.fields) && typeof image.retainUntil === 'string' && typeof image.object === 'string';
}
export function readPreImage(storeRoot, projectRoot, planId, now) {
    let text;
    try {
        text = readFileSync(preImageFile(storeRoot, projectRoot, planId), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { state: 'missing' };
        return { state: 'unreadable', detail: error.code ?? 'read failed' };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { state: 'unreadable', detail: 'not valid JSON' };
    }
    if (!isPreImage(parsed, planId))
        return { state: 'unreadable', detail: 'not a pre-image for this plan' };
    const until = Date.parse(parsed.retainUntil);
    if (Number.isNaN(until) || now >= until)
        return { state: 'expired', retainUntil: parsed.retainUntil };
    return { state: 'ok', image: parsed, hash: sha256(text) };
}
