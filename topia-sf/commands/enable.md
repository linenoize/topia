---
name: sf:enable
description: "Turn the Salesforce sub-plugin on for this project path only. No other project, no user-wide switch. /topia:sf:disable turns it off."
disable-model-invocation: true
---

# /topia:sf:enable

Enable Salesforce for the workspace root this command was run in, and no other. There is no user-wide switch and no `userConfig` toggle.

Say this first, in these words:

> Topia's Salesforce tools can change your org only after you approve the exact change in a dialog. That applies to Topia's tools, not to everything the assistant can do. The assistant can also run shell commands as you, and if your Salesforce CLI login can write, a shell command can write too. This approval slows that down, but it can't prevent it. To make it a hard limit, connect production with a read-only Salesforce user, and log in as a write-capable user only when you intend to make a change.

1. Only a person turns this on. Do not write any file, store, or lock, and do not run the service's scripts yourself.
2. On Claude Code, the person presses **Okay to continue** in the band. It applies only to the path it shows.
3. Where there is no band, tell the person to run this themselves, in their own terminal:

   `node "${CLAUDE_PLUGIN_ROOT}/salesforce/service/bin/cli.js" enable`

   It refuses a piped stdin, and the person types the project path. If that variable is not expanded, use the plugin's install folder. This is a speed bump, not a boundary.
4. No file in a project turns Salesforce on. The lock lives in the service's store on this machine, keyed by project root, and is never committed. A teammate enables the project on their own machine. Their other projects stay off.
