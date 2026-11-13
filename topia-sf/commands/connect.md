---
name: connect
description: "Register a Salesforce org for this project, from a live check, after a person approves it in a dialog. On production, guides the person to a read-only user and a separate writer."
disable-model-invocation: true
---

# /topia-sf:connect

Refuse until this project has an activation lock.

Register one org for this project, so its tools can target it by username.

1. Ask which CLI alias or username to register, unless the person named one. Never assume one, and never pass the default org. Do not log in for them, and never ask for or pass a token.
2. Call the `sf_org_register` tool with that `target`. It runs only under this command, in this turn, so if you stop to ask for the alias, the person runs this command again with it. It checks the org live and opens a dialog with the class, org name, org id, instance, username, and what this user can write. You cannot answer that dialog. Do not summarize it first, and do not tell the person what to choose.
3. Report what the tool returned. A refusal stays a refusal. Do not retry it with another target unless the person asks.
4. If the org id or class changed, the dialog shows old and new side by side, and the person types the org name. Do not type it for them.
5. If the dialog says this user can write directly, say the same thing plainly: Topia's approval doesn't stop a shell command. A read-only Salesforce user is the only hard limit.

## Logging in

The person does this, in their own terminal. Do not run any of these, through any tool. The login takes a browser and MFA, and that's the point. If the person has not logged in, show them the step they need, and stop.

A sandbox needs one user:

```text
sf org login web --alias <alias> --instance-url <sandbox login URL>
```

## Production

Guide the person to two users. The hard limit is a Salesforce user that can't write, so this is what makes it hold.

1. **A read-only user, for everyday use.** It holds no create, edit, or delete. Topia needs it to hold View Setup and Configuration, to read Setup Audit Trail. The person logs it in, then registers it with this command:

   ```text
   sf org login web --alias <alias> --instance-url <My Domain URL>
   ```

2. **A write-capable user, logged in only for the change.** When the person intends a change, they log it in through the browser, with MFA:

   ```text
   sf org login web --instance-url <My Domain URL>
   ```

   The first time, they run this command again, and you call `sf_org_register` with that `target` and `role: 'writer'`. The read-only user has to be registered first. The writer stays in the service store on this machine, and never reaches `orgs.json`.

3. **Writes target the writer, and reads target the reader.** If the writer isn't logged in, `sf_records_execute` and `sf_deployment_execute` refuse, and say what to run.
4. **When the change is done, the person logs the writer out,** in their own terminal. The band says "Writer still logged in" until then. Do not run this for them:

   ```text
   sf org logout --target-org <writer username>
   ```

If the org has only one user that can write, the dialog offers **Accept one user for writes**, and shows the promise. That is the person's call, once, at registration. The band keeps saying so. Do not recommend it, and do not choose it.

A sandbox needs none of this.

## Where this runs

`sf_org_register` exists only in Claude Code, in a terminal with a person present. On Cursor, on a remote connector, and in `claude -p` it isn't available, so an org can't be registered from there. Say so and stop.

Nothing here changes the org. The registry is `.topia/salesforce/orgs.json`, which holds no username. The usernames stay in the service store on this machine.
