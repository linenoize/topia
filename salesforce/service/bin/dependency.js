import { isFailure } from './adapter.js';
import { plainText } from './contract.js';
import { appendJournal } from './journal.js';
import { escapeSoqlString } from './soql.js';
import { dataFailure, isReady, okResult, partialCoverage, ready } from './tools.js';
/**
 * Contract section 2: what uses what, from MetadataComponentDependency. It's advisory,
 * and every result says so: it holds only what Salesforce indexed. The query is
 * closed. A type and a name, each through a pattern and then an escape, and nothing
 * else reaches the SOQL. A partial result stays partial, and it never reads as safe.
 */
const TOOL = 'dependency_report';
const ROW_LIMIT = 2000;
/** What fits in one result. Every row is read and counted, and only this list is shorter. */
const LISTED = 200;
const FIELDS = 'MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType';
const BLIND_SPOTS = [
    'Dynamic references are invisible: dynamic Apex, SOQL built at run time, and names held in strings or custom metadata.',
    'One query reads at most 2,000 rows here. A list that reached that is marked, and it can hold more than it shows.',
    "Salesforce doesn't index every metadata type, so some reports, dashboards, and other components may not appear.",
    'Managed package code is hidden, so what a package uses inside itself is not listed.',
    "A custom field can come back without its object, so two fields with one name on different objects can't be told apart here.",
    'This is one org, as it is now. It says nothing about another org, or about data.',
];
const NOTES = ["Advisory. This is not a full impact analysis, so it can't show that a change or a delete is safe.", "An empty list isn't proof that nothing uses this. It means this index holds no row for it."];
const WHAT_IS_MISSING = { 'used-by': 'what uses this', uses: 'what it uses' };
function queryFor(direction, type, name) {
    const prefix = direction === 'used-by' ? 'RefMetadataComponent' : 'MetadataComponent';
    const where = (left, right) => `FROM MetadataComponentDependency WHERE ${prefix}Type = ${left} AND ${prefix}Name = ${right} LIMIT ${ROW_LIMIT}`;
    return { soql: `SELECT ${FIELDS} ${where(`'${escapeSoqlString(type)}'`, `'${escapeSoqlString(name)}'`)}`, bound: `SELECT ${FIELDS} ${where(':type', ':name')}` };
}
function componentOf(row, prefix) {
    const type = row[`${prefix}Type`];
    const name = row[`${prefix}Name`];
    const namespace = row[`${prefix}Namespace`];
    if (typeof type !== 'string' || typeof name !== 'string')
        return null;
    return { type: plainText(type, 80), name: plainText(name, 255), namespace: typeof namespace === 'string' ? plainText(namespace, 80) : null };
}
async function readDirection(adapter, ctx, username, orgId, direction, type, name) {
    const query = queryFor(direction, type, name);
    const rows = await adapter.query(username, query.soql, { tooling: true });
    if (isFailure(rows))
        return { coverage: { direction, state: 'failed', rows: 0, detail: plainText(rows.message, 200) }, found: [], failure: rows };
    appendJournal(ctx.projectRoot, { event: 'query.executed', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), soql: query.bound, counts: { rows: rows.records.length } });
    const found = rows.records.map(row => componentOf(row, direction === 'used-by' ? 'MetadataComponent' : 'RefMetadataComponent'));
    const readable = found.filter((item) => item !== null);
    if (readable.length !== found.length)
        return { coverage: { direction, state: 'unreadable-rows', rows: rows.records.length, detail: `${found.length - readable.length} rows came back in a shape this version doesn't read.` }, found: readable };
    const cut = rows.truncated || !rows.done || rows.records.length >= ROW_LIMIT;
    return { coverage: { direction, state: cut ? 'cut-at-limit' : 'read', rows: rows.records.length }, found: readable };
}
export async function dependencyReport(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, TOOL, args.orgId);
    if (!isReady(checked))
        return checked;
    const { username, orgId } = checked.record;
    const type = args.componentType;
    const name = args.componentName;
    const wanted = args.direction === 'used-by' ? ['used-by'] : args.direction === 'uses' ? ['uses'] : ['used-by', 'uses'];
    const read = new Map();
    for (const direction of wanted)
        read.set(direction, await readDirection(adapter, ctx, username, orgId, direction, type, name));
    const results = [...read.values()];
    // A login or a limit is about the whole org, and nothing at all coming back is an answer. Neither is a partial list.
    const failures = results.flatMap(item => (item.failure === undefined ? [] : [item.failure]));
    const decisive = failures.find(item => item.failure === 'expired-auth' || item.failure === 'rate-limit' || item.failure === 'unknown');
    if (decisive !== undefined)
        return dataFailure(ctx, TOOL, checked, decisive);
    if (failures.length === results.length && failures[0] !== undefined)
        return dataFailure(ctx, TOOL, checked, failures[0]);
    const coverage = results.map(item => item.coverage);
    const partial = coverage.some(item => item.state !== 'read');
    const usedBy = read.get('used-by')?.found ?? [];
    const uses = read.get('uses')?.found ?? [];
    const missing = coverage.filter(item => item.state === 'failed' || item.state === 'unreadable-rows').map(item => `This result doesn't hold all of ${WHAT_IS_MISSING[item.direction]}: ${item.detail ?? 'it could not be read'}`);
    return okResult(ctx, TOOL, checked, {
        advisory: true,
        component: { type, name },
        usedBy: usedBy.slice(0, LISTED),
        uses: uses.slice(0, LISTED),
        listedAtMost: LISTED,
        usedByTotal: usedBy.length,
        usesTotal: uses.length,
        coverage,
        partial,
        blindSpots: [...missing, ...BLIND_SPOTS],
        notes: NOTES,
    }, partial ? { item: partialCoverage(checked.record) } : {});
}
