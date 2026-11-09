import { userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { runCli } from './cli-core.js';
import { defaultStoreRoot } from './paths.js';
function osUser() {
    try {
        return userInfo().username;
    }
    catch {
        return 'unknown';
    }
}
const code = await runCli(process.argv.slice(2), {
    stdinIsTty: process.stdin.isTTY === true,
    readLine: async (prompt) => {
        const lines = createInterface({ input: process.stdin, output: process.stdout });
        try {
            return await lines.question(prompt);
        }
        finally {
            lines.close();
        }
    },
    write: text => process.stdout.write(text),
    writeError: text => process.stderr.write(text),
    cwd: process.cwd(),
    storeRoot: defaultStoreRoot(),
    now: () => Date.now(),
    user: osUser(),
});
process.exitCode = code;
