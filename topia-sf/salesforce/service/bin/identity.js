const SUFFIX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
/** A 15 character id is case sensitive. The 18 character form appends a checksum of that case. */
export function to18(id) {
    if (id.length !== 15)
        return id;
    let suffix = '';
    for (let block = 0; block < 3; block += 1) {
        let bits = 0;
        for (let position = 0; position < 5; position += 1) {
            const char = id.charAt(block * 5 + position);
            if (char >= 'A' && char <= 'Z')
                bits += 1 << position;
        }
        suffix += SUFFIX.charAt(bits);
    }
    return `${id}${suffix}`;
}
export function sameId(left, right) {
    return to18(left) === to18(right);
}
/** Production comes from the org's live flag, never from a file. */
export function classFromLive(isSandbox) {
    return isSandbox ? 'sandbox' : 'production';
}
export function hostOf(url) {
    try {
        return new URL(url).host.toLowerCase();
    }
    catch {
        return '';
    }
}
/**
 * Compares a live read with what was registered. An org id or class change is
 * never acknowledgeable: it takes a new registration, with old and new side by side.
 */
export function compareLive(record, live, extras = {}) {
    if (!sameId(live.orgId, record.orgId)) {
        return { ok: false, kind: 'org-id-mismatch', message: `The live org id ${live.orgId} is not the registered ${record.orgId}. Re-register with /topia-sf:connect.` };
    }
    if (live.isSandbox !== record.isSandbox) {
        return { ok: false, kind: 'org-id-mismatch', message: 'The live sandbox flag does not match what was registered. Re-register with /topia-sf:connect.' };
    }
    if (extras.display !== undefined) {
        if (!sameId(extras.display.orgId, record.orgId)) {
            return { ok: false, kind: 'org-id-mismatch', message: 'The CLI login for this username points at a different org. Re-register with /topia-sf:connect.' };
        }
        if (hostOf(extras.display.instanceUrl) !== hostOf(record.instanceUrl)) {
            return { ok: false, kind: 'org-id-mismatch', message: 'The live instance host does not match what was registered. Re-register with /topia-sf:connect.' };
        }
        if (extras.display.username.toLowerCase() !== record.username.toLowerCase()) {
            return { ok: false, kind: 'user-changed-on-read', message: `The CLI user changed on a read (registered ${record.username}, live ${extras.display.username}).` };
        }
    }
    if (extras.user !== undefined) {
        if (extras.user.username.toLowerCase() !== record.username.toLowerCase()) {
            return { ok: false, kind: 'user-changed-on-read', message: `The CLI user changed on a read (registered ${record.username}, live ${extras.user.username}).` };
        }
        if (!extras.user.isActive)
            return { ok: false, kind: 'unknown', message: `The registered user ${record.username} is not active in this org.` };
    }
    return { ok: true };
}
