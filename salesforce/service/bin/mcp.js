import { createInterface } from 'node:readline';
import { LOCAL_WRITE_TOOLS, TOOL_NAMES } from './contract.js';
import { HOOK_HOST_ENV } from './stamp.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';
/**
 * The stdio MCP server: newline-delimited JSON-RPC, no runtime dependencies. It
 * starts in every project with the plugin on, so startup loads only the tool
 * list. The CLI is resolved and the service loaded at the first tool call, and a
 * project with no lock refuses that call before anything runs.
 */
const PROTOCOL_VERSION = '2025-11-25';
const SERVER_VERSION = '1.0.0';
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function reply(id, result) {
    send({ jsonrpc: '2.0', id, result });
}
function fail(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
}
function listTools() {
    return {
        tools: TOOL_NAMES.map(name => ({
            name,
            description: TOOL_SCHEMAS[name].description,
            inputSchema: TOOL_SCHEMAS[name].inputSchema,
            annotations: { readOnlyHint: !LOCAL_WRITE_TOOLS.includes(name), destructiveHint: false, openWorldHint: true },
        })),
    };
}
const SESSION_CORRELATION = `mcp-${Date.now()}-${process.pid}`;
async function callTool(id, params) {
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        fail(id, INVALID_PARAMS, 'tools/call needs params.');
        return;
    }
    const { name, arguments: args } = params;
    if (typeof name !== 'string' || !TOOL_NAMES.includes(name)) {
        fail(id, INVALID_PARAMS, `Unknown tool: ${typeof name === 'string' ? name.slice(0, 100) : 'none named'}.`);
        return;
    }
    try {
        const { callTool: run, formatToolText } = await import('./tools.js');
        const { SfCliAdapter } = await import('./sf-adapter.js');
        const { defaultStoreRoot } = await import('./paths.js');
        const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
        adapter ??= new SfCliAdapter({ env: process.env, projectRoot });
        const given = args !== null && typeof args === 'object' ? args : {};
        const result = await run(adapter, name, args ?? {}, {
            projectRoot,
            storeRoot: defaultStoreRoot(),
            correlationId: typeof given.correlationId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(given.correlationId) ? given.correlationId : SESSION_CORRELATION,
            hookHost: process.env[HOOK_HOST_ENV] === '1',
            now: Date.now(),
        });
        reply(id, { content: [{ type: 'text', text: formatToolText(result) }], isError: !result.ok });
    }
    catch {
        // Nothing from the error goes back: it could hold anything. The call just failed.
        reply(id, { content: [{ type: 'text', text: 'The Salesforce tool call failed inside the server, so nothing ran to a result.' }], isError: true });
    }
}
let adapter;
function handleLine(line) {
    if (line.trim().length === 0)
        return;
    let message;
    try {
        message = JSON.parse(line);
    }
    catch {
        fail(null, PARSE_ERROR, 'That line is not JSON.');
        return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
        fail(null, INVALID_REQUEST, 'A message is one JSON object.');
        return;
    }
    const { jsonrpc, id, method, params } = message;
    const hasId = id !== undefined;
    const validId = typeof id === 'string' || typeof id === 'number';
    if (jsonrpc !== '2.0' || typeof method !== 'string' || (hasId && !validId)) {
        fail(validId ? id : null, INVALID_REQUEST, 'That is not a JSON-RPC 2.0 request.');
        return;
    }
    // A notification never gets a reply, whatever its method.
    if (!hasId)
        return;
    switch (method) {
        case 'initialize':
            reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'topia-salesforce', title: 'Topia Salesforce', version: SERVER_VERSION } });
            return;
        case 'ping':
            reply(id, {});
            return;
        case 'tools/list':
            reply(id, listTools());
            return;
        case 'tools/call':
            void callTool(id, params);
            return;
        default:
            fail(id, METHOD_NOT_FOUND, `Unknown method: ${method.slice(0, 100)}.`);
    }
}
process.stdout.on('error', () => process.exit(0));
process.on('uncaughtException', error => {
    process.stderr.write(`topia-salesforce: ${error.name}\n`);
});
process.on('unhandledRejection', () => {
    process.stderr.write('topia-salesforce: a call failed\n');
});
const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
lines.on('line', line => {
    try {
        handleLine(line);
    }
    catch {
        try {
            fail(null, INTERNAL_ERROR, 'That line could not be handled.');
        }
        catch {
            // Stdout is gone, and the error handler above ends the process.
        }
    }
});
lines.on('close', () => {
    process.exitCode = 0;
});
