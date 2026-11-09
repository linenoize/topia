/**
 * One choke point. Every tool result, log line, and journal note passes through
 * here. Structured input is parsed and walked, because a regex over serialized
 * text misses the formats this service actually sees.
 */
const REDACTED = '[redacted]';
function normalizeKey(key) {
    return key
        .replace(/__c$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}
/** `sid` is here as a whole key only: normalized comparison, never a substring. */
const SECRET_KEYS = new Set([
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'sfdxauthurl',
    'privatekey',
    'password',
    'sessionid',
    'consumersecret',
    'sid',
    'authorization',
]);
/** Metadata elements known to hold secrets: connected apps, named credentials, auth providers. */
const SECRET_XML_ELEMENTS = new Set([...SECRET_KEYS, 'oauthtoken', 'oauthrefreshtoken', 'secret', 'apikey', 'token']);
export function isSecretKey(key) {
    return SECRET_KEYS.has(normalizeKey(key));
}
const VALUE_PATTERNS = [
    /force:\/\/[^\s"'<>]+/g,
    /\b00D[A-Za-z0-9]{5,}![A-Za-z0-9._]+/g,
    /\b5Aep[A-Za-z0-9._]{8,}/g,
    /\beyJ[A-Za-z0-9+=_-]+\.[A-Za-z0-9+=_-]+\.[A-Za-z0-9+=_-]+/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];
const ASSIGNMENT = /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|consumer[_-]?secret|session[_-]?id|sfdx[_-]?auth[_-]?url|private[_-]?key|password|sid)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',;}&]+)/gi;
function redactPatterns(text) {
    let out = text.replace(ASSIGNMENT, `$1$2${REDACTED}`);
    for (const pattern of VALUE_PATTERNS)
        out = out.replace(pattern, REDACTED);
    return out;
}
/** For text about to be committed, where the answer is to refuse it and not to mask it. */
export function holdsSecret(text) {
    return redactPatterns(text) !== text;
}
function looksLikeXml(text) {
    return /^<(?:\?xml|!--|[A-Za-z_])/.test(text);
}
const XML_TOKEN = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_][^<>]*>|[^<]+|</g;
function tagName(token) {
    const match = token.match(/^<\/?([A-Za-z_][\w:.-]*)/);
    const name = match?.[1] ?? '';
    return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}
function redactAttributes(token) {
    let count = 0;
    const text = token.replace(/([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g, (whole, name, equals) => {
        if (!SECRET_XML_ELEMENTS.has(normalizeKey(name)))
            return whole;
        count += 1;
        return `${name}${equals}"${REDACTED}"`;
    });
    return { text, count };
}
/** Walks the elements. Text under a known secret element is replaced, and the file stays well formed. */
export function redactXml(xml) {
    const open = [];
    let redactions = 0;
    let out = '';
    const inSecret = () => open.some(name => SECRET_XML_ELEMENTS.has(normalizeKey(name)));
    for (const match of xml.matchAll(XML_TOKEN)) {
        const token = match[0];
        if (token.startsWith('<![CDATA[')) {
            if (inSecret()) {
                out += REDACTED;
                redactions += 1;
            }
            else {
                out += redactPatterns(token);
            }
        }
        else if (token.startsWith('</')) {
            const name = tagName(token);
            const at = open.lastIndexOf(name);
            if (at >= 0)
                open.length = at;
            out += token;
        }
        else if (token.startsWith('<!') || token.startsWith('<?')) {
            out += token;
        }
        else if (token.startsWith('<') && token.length > 1) {
            const attributes = redactAttributes(token);
            redactions += attributes.count;
            out += attributes.text;
            if (!token.endsWith('/>'))
                open.push(tagName(token));
        }
        else if (inSecret() && token.trim().length > 0) {
            out += REDACTED;
            redactions += 1;
        }
        else {
            out += redactPatterns(token);
        }
    }
    return { text: out, redactions };
}
/** Parses JSON or XML when the text is that. Otherwise value patterns and key=value lines. */
export function redactSecrets(text) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.stringify(redactValue(JSON.parse(text)));
        }
        catch {
            return redactPatterns(text);
        }
    }
    if (looksLikeXml(trimmed))
        return redactXml(text).text;
    return redactPatterns(text);
}
export function redactValue(value) {
    if (typeof value === 'string')
        return redactSecrets(value);
    if (Array.isArray(value))
        return value.map(item => redactValue(item));
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, inner] of Object.entries(value)) {
            out[key] = isSecretKey(key) && inner !== null && inner !== undefined ? REDACTED : redactValue(inner);
        }
        return out;
    }
    return value;
}
