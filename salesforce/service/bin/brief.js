import { createHash } from 'node:crypto';
import { readJson, UnreadableFileError, writeJson } from './json-file.js';
import { canonical } from './plans.js';
import { localFile } from './paths.js';
import { plainText } from './contract.js';
function canonicalBrief(input) {
    return {
        objective: plainText(input.objective, 2000),
        environment: plainText(input.environment, 300),
        subjects: input.subjects.map(item => ({ name: plainText(item.name, 200), status: item.status })),
        change: plainText(input.change, 2000),
        blockingQuestions: input.blockingQuestions.map(item => plainText(item, 500)),
    };
}
function hashOf(brief) {
    return createHash('sha256').update(canonical(brief)).digest('hex');
}
export function briefFileFor(storeRoot, projectRoot, briefId) {
    return localFile(storeRoot, projectRoot, 'briefs', briefId);
}
export function proposeBrief(storeRoot, projectRoot, input, at) {
    const brief = canonicalBrief(input);
    const briefHash = hashOf(brief);
    const briefId = `brief-${briefHash.slice(0, 16)}`;
    writeJson(briefFileFor(storeRoot, projectRoot, briefId), { brief, createdAt: at });
    return { briefId, briefHash };
}
function isBrief(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const brief = value;
    return (typeof brief.objective === 'string' &&
        typeof brief.environment === 'string' &&
        typeof brief.change === 'string' &&
        Array.isArray(brief.subjects) &&
        brief.subjects.every(item => item !== null && typeof item === 'object' && typeof item.name === 'string' && (item.status === 'known' || item.status === 'assumed')) &&
        Array.isArray(brief.blockingQuestions) &&
        brief.blockingQuestions.every(item => typeof item === 'string'));
}
/** Null when the brief is missing. Anything unreadable throws, so a caller refuses. */
export function readBrief(storeRoot, projectRoot, briefId) {
    const file = briefFileFor(storeRoot, projectRoot, briefId);
    const stored = readJson(file);
    if (stored === null)
        return null;
    if (typeof stored !== 'object' || !isBrief(stored.brief))
        throw new UnreadableFileError(file, 'not a brief');
    return { briefId, briefHash: hashOf(stored.brief), brief: stored.brief, createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : '' };
}
