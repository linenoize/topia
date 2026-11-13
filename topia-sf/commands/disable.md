---
name: disable
description: "Turn the Salesforce sub-plugin off for this project path only, after a person confirms. Other projects stay as they are."
disable-model-invocation: true
---

# /topia-sf:disable

Turn Salesforce off for the workspace root this command was run in. The project's committed files stay: `orgs.json`, `plans/`, and `docs/salesforce/`.

1. Only a person turns this off. Do not change any file, store, or lock, and do not run the service's scripts yourself.
2. On Claude Code, the person presses **Okay to continue** in the band. The VS Code extension and the phone apps draw no band, so a dialog asks there instead. Only the person answers it, never a chat reply. It applies only to the path it shows. `/topia-sf:disable cancel` keeps it on.
3. Where there is no band and no dialog, tell the person to run this themselves, in their own terminal:

   `node "${CLAUDE_PLUGIN_ROOT}/salesforce/service/bin/cli.js" disable`

   It refuses a piped stdin, and the person types the project path. If that variable is not expanded, use the plugin's install folder.
4. `/topia-sf:enable` turns it back on later.
