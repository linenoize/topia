/**
 * Contract section 3. A tool.call hook stamps every stdio call, overwriting what
 * the model sent. There is no key behind a stamp, by design (section 1): a stamp is
 * believed only where the plugin manifest launched the server, because only there
 * can a hook have written it. On a host with no hooks, any stamp is forged. It is
 * refused, and it could only have earned reads those hosts already get. No Node
 * here: the mod and the server both read this.
 */
export const STAMP_KEY = 'sfStamp';
/** The launch environment says a hook can have stamped this call. It is a fact about the launch, not a secret. */
export const HOOK_HOST_ENV = 'TOPIA_SF_HOOK_HOST';
const MODES = ['read-only', 'explain', 'investigate', 'plan', 'validate', 'execute', 'review'];
/** Names a model might try beside the stamp. None of them means anything here. */
const MODEL_FIELDS = [STAMP_KEY, 'mode', 'confirmedBriefHash', 'briefConfirmed', 'ack'];
export function withoutStamp(e) {
    const out = { ...e };
    for (const name of MODEL_FIELDS)
        delete out[name];
    return out;
}
/** The stamp sits under one key, because the engine pins a top-level agentId. */
export function stampInput(e, stamp) {
    return { ...withoutStamp(e), [STAMP_KEY]: stamp };
}
function readAck(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'object')
        return undefined;
    const ack = value;
    return typeof ack.kind === 'string' && typeof ack.orgId === 'string' && typeof ack.user === 'string' && typeof ack.orgIdentityHash === 'string' ? { kind: ack.kind, orgId: ack.orgId, user: ack.user, orgIdentityHash: ack.orgIdentityHash } : undefined;
}
function readStamp(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    if (Object.keys(raw).some(key => !['mode', 'agentId', 'confirmedBriefHash', 'ack'].includes(key)))
        return null;
    const mode = raw.mode ?? 'read-only';
    if (typeof mode !== 'string' || !MODES.includes(mode))
        return null;
    const agentId = raw.agentId ?? null;
    if (agentId !== null && typeof agentId !== 'string')
        return null;
    const hash = raw.confirmedBriefHash ?? null;
    if (hash !== null && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))
        return null;
    const ack = readAck(raw.ack);
    if (ack === undefined)
        return null;
    return { mode: mode, agentId, confirmedBriefHash: hash, ack };
}
export function takeStamp(args, hookHost) {
    if (args === null || typeof args !== 'object' || Array.isArray(args) || !(STAMP_KEY in args))
        return { stamp: null, args, problem: null };
    const { [STAMP_KEY]: raw, ...rest } = args;
    if (!hookHost)
        return { stamp: null, args: rest, problem: 'A stamp arrived on a host with no hooks, so it did not come from Topia. Only a hook writes one. The call is refused.' };
    const stamp = readStamp(raw);
    return stamp === null ? { stamp: null, args: rest, problem: 'That stamp is not in the form the hook writes, so the call is refused.' } : { stamp, args: rest, problem: null };
}
