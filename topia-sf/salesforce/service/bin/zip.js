import { deflateRawSync, inflateRawSync } from 'node:zlib';
/** Salesforce's own limits on a metadata deploy, so a zip that can't ship is refused here first. */
export const MAX_ZIP_BYTES = 39 * 1024 * 1024;
export const MAX_UNZIPPED_BYTES = 400 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 10_000;
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1)
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        table[index] = value;
    }
    return table;
})();
function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes)
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}
const VERSION = 20;
const UTF8_FLAG = 0x0800;
const DEFLATE = 8;
// 1980-01-01, the first date a ZIP can hold.
const DOS_DATE = 0x0021;
export function writeZip(entries) {
    const sorted = [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of sorted) {
        const name = Buffer.from(entry.path, 'utf8');
        const data = deflateRawSync(entry.bytes, { level: 9 });
        const crc = crc32(entry.bytes);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(VERSION, 4);
        local.writeUInt16LE(UTF8_FLAG, 6);
        local.writeUInt16LE(DEFLATE, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(entry.bytes.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, data);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(VERSION, 4);
        central.writeUInt16LE(VERSION, 6);
        central.writeUInt16LE(UTF8_FLAG, 8);
        central.writeUInt16LE(DEFLATE, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(entry.bytes.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(sorted.length, 8);
    end.writeUInt16LE(sorted.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}
function safePath(path) {
    if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.includes('\0'))
        return false;
    return !path.split('/').some(part => part === '..' || part === '.');
}
export class ZipError extends Error {
}
/** Throws a ZipError on anything this can't read for certain. Folders are skipped: a file's path says where it goes. */
export function readZip(bytes) {
    if (bytes.length > MAX_ZIP_BYTES)
        throw new ZipError(`That zip is over ${MAX_ZIP_BYTES} bytes, which is more than a metadata deploy takes.`);
    let end = bytes.length - 22;
    const floor = Math.max(0, bytes.length - 22 - 0xffff);
    while (end >= floor && !(bytes.readUInt32LE(end) === 0x06054b50))
        end -= 1;
    if (end < floor)
        throw new ZipError('That is not a zip file.');
    const count = bytes.readUInt16LE(end + 10);
    if (count === 0xffff || bytes.readUInt32LE(end + 16) === 0xffffffff)
        throw new ZipError('That zip uses a form this version does not read.');
    if (count > MAX_ZIP_ENTRIES)
        throw new ZipError(`That zip holds over ${MAX_ZIP_ENTRIES} entries, which is more than a metadata deploy takes.`);
    let at = bytes.readUInt32LE(end + 16);
    const entries = [];
    const seen = new Set();
    let total = 0;
    for (let index = 0; index < count; index += 1) {
        if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50)
            throw new ZipError('That zip is damaged.');
        const flags = bytes.readUInt16LE(at + 8);
        const method = bytes.readUInt16LE(at + 10);
        const crc = bytes.readUInt32LE(at + 16);
        const packed = bytes.readUInt32LE(at + 20);
        const size = bytes.readUInt32LE(at + 24);
        const nameLength = bytes.readUInt16LE(at + 28);
        const extra = bytes.readUInt16LE(at + 30);
        const comment = bytes.readUInt16LE(at + 32);
        const offset = bytes.readUInt32LE(at + 42);
        const path = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
        at += 46 + nameLength + extra + comment;
        if ((flags & 1) !== 0)
            throw new ZipError('That zip is encrypted, so what it holds can not be shown.');
        if (path.endsWith('/'))
            continue;
        if (!safePath(path))
            throw new ZipError('That zip holds a path outside its own folder.');
        if (seen.has(path))
            throw new ZipError('That zip holds the same path twice, so what ships would be ambiguous.');
        seen.add(path);
        total += size;
        if (total > MAX_UNZIPPED_BYTES)
            throw new ZipError(`That zip unpacks to over ${MAX_UNZIPPED_BYTES} bytes, which is more than a metadata deploy takes.`);
        if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50)
            throw new ZipError('That zip is damaged.');
        const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
        const raw = bytes.subarray(start, start + packed);
        let data;
        if (method === 0)
            data = Buffer.from(raw);
        else if (method === DEFLATE) {
            try {
                data = inflateRawSync(raw, { maxOutputLength: size + 1 });
            }
            catch {
                throw new ZipError('That zip is damaged.');
            }
        }
        else
            throw new ZipError('That zip uses a compression this version does not read.');
        if (data.length !== size || crc32(data) !== crc)
            throw new ZipError('That zip is damaged.');
        entries.push({ path, bytes: data });
    }
    return entries;
}
