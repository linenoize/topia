import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeJson } from './json-file.js';
import { localDirectory, localFile, safeId } from './paths.js';
const STATES = ['started', 'done', 'partial', 'unknown'];
function isEntry(value, planId) {
    if (value === null || typeof value !== 'object')
        return false;
    const entry = value;
    if (entry.version !== 1 || entry.planId !== planId || typeof entry.state !== 'string' || !STATES.includes(entry.state) || typeof entry.planHash !== 'string')
        return false;
    if (entry.kind === 'records')
        return Array.isArray(entry.attempts) && typeof entry.records === 'object';
    return entry.kind === 'deploy' && typeof entry.checks === 'object';
}
export function ledgerFile(storeRoot, projectRoot, planId) {
    return localFile(storeRoot, projectRoot, 'ledger', planId);
}
export function readLedger(storeRoot, projectRoot, planId) {
    const read = readJsonFile(ledgerFile(storeRoot, projectRoot, planId));
    switch (read.state) {
        case 'missing':
            return { state: 'missing' };
        case 'unreadable':
            return { state: 'unreadable', detail: read.detail };
        case 'ok':
            return isEntry(read.value, planId) ? { state: read.value.state, entry: read.value } : { state: 'unreadable', detail: 'not a ledger for this plan' };
        default: {
            const exhaustive = read;
            return exhaustive;
        }
    }
}
/** Temp file, fsync, rename. A crash leaves the old entry or the new one, never half of either. */
export function writeLedger(storeRoot, projectRoot, entry) {
    writeJson(ledgerFile(storeRoot, projectRoot, entry.planId), entry);
}
const TIMING = { staleMs: 15 * 60 * 1000, heartbeatMs: 10 * 1000, gateStaleMs: 30 * 1000, maxHeldMs: 60 * 60 * 1000 };
/** The locks this process holds, and since when. */
const HELD = new Map();
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/**
 * Free, or null for held or undecidable. A holder in this process is judged by this process, which knows: age
 * does not free it, because a stalled loop is not a dead run. A holder in another process is free when it is gone.
 * One that is old and still there is a suspended holder, a hung one, or an unrelated process given a dead
 * holder's pid, and a live one touches its lock every heartbeat, so this waits for one before it says which.
 */
function staleVerdict(file, timing, waited) {
    try {
        const text = readFileSync(file, 'utf8');
        const { pid } = JSON.parse(text);
        if (typeof pid === 'number' && pid === process.pid) {
            const since = HELD.get(file);
            return since === undefined || Date.now() - since >= timing.maxHeldMs ? { text } : null;
        }
        const mtime = statSync(file).mtimeMs;
        const old = Date.now() - mtime >= timing.staleMs;
        if (typeof pid !== 'number')
            return old ? { text } : null;
        if (!pidAlive(pid))
            return { text };
        if (!old)
            return null;
        if (!waited) {
            sleep(timing.heartbeatMs + 1000);
            if (statSync(file).mtimeMs > mtime || readFileSync(file, 'utf8') !== text)
                return null;
        }
        return { text };
    }
    catch {
        // Half written or just removed. It sorts itself out by age or on the next try.
        return null;
    }
}
/**
 * Held for a whole run. A runner that died leaves this behind, and a dead pid means it's free.
 * Null means another run holds it, or may. Clearing a stale lock goes through a gate that one
 * run at a time can hold, so two runs that saw the same stale lock can't each clear the
 * other's fresh one. Whatever can't be decided reads as held.
 */
export function acquireRun(storeRoot, projectRoot, planId, timingOver = {}) {
    const timing = { ...TIMING, ...timingOver };
    const dir = localDirectory(storeRoot, projectRoot, 'ledger');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${safeId(planId)}.lock`);
    const gate = `${file}.takeover`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const token = randomUUID();
            const handle = openSync(file, 'wx', 0o600);
            try {
                writeSync(handle, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
            }
            finally {
                closeSync(handle);
            }
            const since = Date.now();
            HELD.set(file, since);
            // A long run must not read as a dead one: its age is kept fresh while it lives, and for no longer than a run can last.
            const beat = setInterval(() => {
                if (Date.now() - since >= timing.maxHeldMs) {
                    clearInterval(beat);
                    return;
                }
                try {
                    const now = new Date();
                    utimesSync(file, now, now);
                }
                catch {
                    // The lock is gone or not ours to touch. The release decides.
                }
            }, timing.heartbeatMs);
            beat.unref();
            return {
                release: () => {
                    clearInterval(beat);
                    HELD.delete(file);
                    if (lockToken(file) === token)
                        rmSync(file, { force: true });
                },
            };
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES')
                throw error;
            const verdict = staleVerdict(file, timing, false);
            if (verdict === null)
                return null;
            if (!clearStale(file, gate, verdict, timing))
                return null;
        }
    }
    return null;
}
function lockToken(file) {
    try {
        const { token } = JSON.parse(readFileSync(file, 'utf8'));
        return typeof token === 'string' ? token : null;
    }
    catch {
        return null;
    }
}
/**
 * Removes the lock only while it still says what it said when it was judged free. A run that was held up inside
 * the gate (a suspended machine, a stopped process) can wake to find another run's fresh lock in the same place,
 * and that one is not its to remove. Two reads of a file are not one atomic step, and the gap is these two calls.
 */
export function removeIfUnchanged(file, text) {
    try {
        if (readFileSync(file, 'utf8') !== text)
            return false;
        rmSync(file, { force: true });
        return true;
    }
    catch {
        return false;
    }
}
/** True when the stale lock is gone and this run may try to create its own. */
function clearStale(file, gate, verdict, timing) {
    const mine = randomUUID();
    let handle;
    try {
        handle = openSync(gate, 'wx', 0o600);
    }
    catch {
        // Another run is clearing it. If that run died, the gate ages out and a later try gets through.
        try {
            if (Date.now() - statSync(gate).mtimeMs >= timing.gateStaleMs)
                rmSync(gate, { force: true });
        }
        catch {
            // Held, or gone already.
        }
        return false;
    }
    try {
        writeSync(handle, mine);
        // Look again under the gate: the lock may have been replaced while this run waited.
        const again = staleVerdict(file, timing, true);
        if (again === null || again.text !== verdict.text)
            return false;
        return removeIfUnchanged(file, verdict.text);
    }
    catch {
        return false;
    }
    finally {
        closeSync(handle);
        // The gate may have been taken from this run while it was held up, and then it is another run's.
        try {
            if (readFileSync(gate, 'utf8') === mine)
                rmSync(gate, { force: true });
        }
        catch {
            // It ages out.
        }
    }
}
