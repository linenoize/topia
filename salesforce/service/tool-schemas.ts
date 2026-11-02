import type { ToolName } from './contract.js'

/**
 * What tools/list publishes, and what every call is checked against. No imports
 * beyond a type, so a server in a project that never uses Salesforce loads this
 * and nothing else.
 */

type Schema = Record<string, unknown>

const ORG_ID: Schema = { type: 'string', pattern: '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$', description: 'The 15 or 18 character id of a registered org.' }
const CORRELATION: Schema = { type: 'string', pattern: '^[A-Za-z0-9._-]{1,128}$', description: 'Groups this call in the journal.' }

function object(properties: Record<string, Schema>, required: string[]): Schema {
  return { type: 'object', properties: { ...properties, correlationId: CORRELATION, briefId: BRIEF_ID }, required, additionalProperties: false }
}

const MEMBERS: Schema = {
  type: 'array',
  items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9_][A-Za-z0-9_.\\-/ ]*$' },
  minItems: 1,
  maxItems: 50,
  description: 'Metadata members as Type:Name, for example ApexClass:Widget. Wildcards are not allowed.',
}

const NOTE_NAME: Schema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' }
const NOTE_TEXT: Schema = { type: 'string', minLength: 1, maxLength: 2000 }

const PLAN_ID: Schema = { type: 'string', pattern: '^plan-[a-f0-9-]{36}$', description: 'From records_plan_update or deployment_plan.' }

const REPORT_ID: Schema = { type: 'string', pattern: '^00O[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$', description: 'The report id.' }

const BRIEF_ID: Schema = { type: 'string', pattern: '^brief-[a-f0-9]{16}$', description: 'From brief_propose. Investigation and plan tools need it, and a person confirms the brief with sf_brief_confirm where that tool exists.' }

const PRACTICE_REVIEW_ID: Schema = { type: 'string', pattern: '^practice-[a-f0-9-]{36}$', description: 'From practice_record. Each review serves one plan.' }
const MODEL_TEXT: Schema = { type: 'string', maxLength: 2000, description: 'Informational only. It is stored locally and never enters a safety decision.' }

const WHERE: Schema = {
  type: 'array',
  maxItems: 20,
  description: 'Combined with AND.',
  items: {
    type: 'object',
    properties: {
      field: { type: 'string', maxLength: 255 },
      op: { type: 'string', enum: ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'like', 'in', 'not_in'] },
      value: { type: ['string', 'number', 'boolean', 'array', 'null'] },
    },
    required: ['field', 'op', 'value'],
    additionalProperties: false,
  },
}

const ORDER_BY: Schema = { type: 'object', properties: { field: { type: 'string', maxLength: 255 }, direction: { type: 'string', enum: ['asc', 'desc'] } }, required: ['field'], additionalProperties: false }

export const TOOL_SCHEMAS: Record<ToolName, { description: string; inputSchema: Schema }> = {
  vendor_findings_list: {
    description: "List the vendors and findings recorded in this project's docs/salesforce/vendors/, with each finding's status, and any file that doesn't parse. With no orgId it reads no org, so the installed version shows as not checked. With an orgId it compares the live version and marks stale findings.",
    inputSchema: object({ orgId: ORG_ID, vendor: NOTE_NAME }, []),
  },
  vendor_fingerprint: {
    description: 'Run the inventory on an org and write docs/salesforce/vendors/<vendor>/package.md for one installed package, named by namespace, or by package name if it has none. Keeps what the file says about other orgs. The file holds no personal values and gets committed.',
    inputSchema: object({ orgId: ORG_ID, vendor: NOTE_NAME, namespace: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,14}$' }, packageName: { type: 'string', minLength: 1, maxLength: 200 }, product: NOTE_TEXT, dependencies: NOTE_TEXT }, ['orgId', 'vendor']),
  },
  vendor_finding_add: {
    description: "Record one way a vendor package makes Salesforce behave differently, as docs/salesforce/vendors/<vendor>/findings/<id>.md. A new finding always starts at suspected, and its version is read from the org, not given. An email or token in the text is refused, since the file gets committed.",
    inputSchema: object(
      {
        orgId: ORG_ID,
        vendor: NOTE_NAME,
        id: NOTE_NAME,
        scope: NOTE_TEXT,
        owner: { ...NOTE_TEXT, description: 'A role or team, not a person.' },
        evidence: NOTE_TEXT,
        rationale: NOTE_TEXT,
        dependencies: NOTE_TEXT,
        uncertainty: NOTE_TEXT,
        standardBehavior: NOTE_TEXT,
        observedBehavior: NOTE_TEXT,
        component: { ...NOTE_TEXT, description: "The responsible component as Type:Name, or 'opaque: managed code hidden'." },
        vendorTicket: NOTE_TEXT,
        adminImpact: NOTE_TEXT,
        workaround: NOTE_TEXT,
        subscriberEditable: { type: 'string', enum: ['yes', 'no', 'unknown'] },
        reverifyOn: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: ['package upgrade', 'sandbox refresh', 'Salesforce release'] } },
        body: { type: 'string', maxLength: 20000 },
      },
      ['orgId', 'vendor', 'id', 'scope', 'owner', 'evidence', 'rationale', 'dependencies', 'uncertainty', 'standardBehavior', 'observedBehavior', 'component', 'adminImpact', 'workaround', 'subscriberEditable', 'reverifyOn'],
    ),
  },
  vendor_finding_reverify: {
    description: 'Check a finding again in an org: pins it to the version installed now, dates it today, and sets its status. confirmed-in-org needs evidence naming this org by id. vendor-confirmed needs a vendor ticket. A finding that no longer reproduces can go back to suspected.',
    inputSchema: object(
      { orgId: ORG_ID, vendor: NOTE_NAME, id: NOTE_NAME, status: { type: 'string', enum: ['suspected', 'confirmed-in-org', 'vendor-confirmed'] }, evidence: NOTE_TEXT, vendorTicket: NOTE_TEXT, uncertainty: NOTE_TEXT },
      ['orgId', 'vendor', 'id', 'status', 'evidence'],
    ),
  },
  dependency_report: {
    description: 'What uses a metadata component, and what it uses, from MetadataComponentDependency. Advisory: every result states its coverage and its blind spots. Dynamic references are invisible, row limits apply, and it is never a full impact analysis, so never conclude from it that a change is safe. It reads, and changes nothing.',
    inputSchema: object(
      {
        orgId: ORG_ID,
        componentType: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,79}$', description: 'The metadata type, for example ApexClass, Flow, or CustomField.' },
        componentName: { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_.\\-]{0,254}$', description: "The component's name. A custom field may be listed without its object or suffix." },
        direction: { type: 'string', enum: ['used-by', 'uses', 'both'], description: 'Which way to look. both is the default.' },
      },
      ['orgId', 'componentType', 'componentName'],
    ),
  },
  packages_inventory: {
    description: 'List the managed and unlocked packages installed in an org: name, namespace, version, namespaced components, and license counts. Managed code stays hidden, so this gives names and counts, not source. A query that fails is listed as not checked, and the result says partial.',
    inputSchema: object({ orgId: ORG_ID }, ['orgId']),
  },
  org_inspect: {
    description: 'Check the live identity of a registered org with SOQL, targeted by username: name, id, sandbox flag, instance, and user. Writes the snapshot the band shows.',
    inputSchema: object({ orgId: ORG_ID }, []),
  },
  schema_describe: {
    description: "Describe an object's fields from the live org, and whether each field returns values. With purpose 'candidate' and text, lists objects whose label matches, to confirm with the person. It never picks one.",
    inputSchema: object({ orgId: ORG_ID, object: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' }, purpose: { type: 'string', enum: ['candidate', 'investigate'] }, text: { type: 'string', minLength: 2, maxLength: 80 } }, ['orgId']),
  },
  records_query: {
    description: 'A bounded count, plus values only for fields proven safe: ids, booleans, picklists, and date-only system fields. Everything else is counted and listed as withheld. Filter and sort by safe fields only. There is no free-text SOQL.',
    inputSchema: object(
      {
        orgId: ORG_ID,
        object: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
        fields: { type: 'array', items: { type: 'string', maxLength: 255 }, minItems: 1, maxItems: 50, description: 'Field API names. A parent is Owner.IsActive.' },
        where: WHERE,
        orderBy: ORDER_BY,
        limit: { type: 'integer', minimum: 1, maximum: 2000, description: 'The bound on the count and on the rows.' },
      },
      ['orgId', 'object', 'fields', 'limit'],
    ),
  },
  users_resolve: {
    description: 'List org users whose name or username matches, to confirm with the person. It returns candidates and never picks one, even for a single match.',
    inputSchema: object({ orgId: ORG_ID, text: { type: 'string', minLength: 3, maxLength: 80 } }, ['orgId', 'text']),
  },
  audit_query: {
    description: 'Read Setup Audit Trail for one user and a time window: action, section, time, and actor. Free text is withheld.',
    inputSchema: object(
      {
        orgId: ORG_ID,
        userId: { type: 'string', pattern: '^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$' },
        from: { type: 'string', description: 'A date, or a date and time with an offset.' },
        to: { type: 'string', description: 'A date, or a date and time with an offset.' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
      },
      ['orgId', 'userId', 'from', 'to'],
    ),
  },
  reports_describe: {
    description: 'Describe a report: name, format, columns, and which columns it filters on. Filter values are not returned.',
    inputSchema: object({ orgId: ORG_ID, reportId: REPORT_ID }, ['orgId', 'reportId']),
  },
  reports_run: {
    description: 'Run a report through the same value gate as records_query: the row count, plus cells proven safe. A result cut short or malformed is reported as partial.',
    inputSchema: object({ orgId: ORG_ID, reportId: REPORT_ID }, ['orgId', 'reportId']),
  },
  metadata_retrieve: {
    description: 'Retrieve named metadata into a private temp folder and return the files, with known secret elements redacted and flagged. Nothing lands in the project.',
    inputSchema: object({ orgId: ORG_ID, members: MEMBERS }, ['orgId', 'members']),
  },
  metadata_diff: {
    description: "Compare named metadata between an org and the project's source, or a second registered org. Reports which files match, by hash, and returns no file text.",
    inputSchema: object({ orgId: ORG_ID, members: MEMBERS, otherOrgId: ORG_ID }, ['orgId', 'members']),
  },
  practice_record: {
    description: "Store a practice review's four measurements in the local store and write the practice-review event. records_plan_update and deployment_plan need its practiceReviewId, and each review serves one plan. This is a quality check. It is not evidence of safety, and it approves nothing.",
    inputSchema: object(
      {
        practice: { type: 'string', minLength: 1, maxLength: 4000 },
        experience: { type: 'string', minLength: 1, maxLength: 4000 },
        security: { type: 'string', minLength: 1, maxLength: 4000 },
        pii: { type: 'string', minLength: 1, maxLength: 4000 },
        vendorImpact: { type: 'string', minLength: 1, maxLength: 4000 },
        stopRecommendation: { type: 'boolean', description: 'True stops the plan.' },
        confirmedChange: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 255 }, description: 'What the review looked at: field API names, or delete, or deploy. A plan cannot go beyond this list.' },
      },
      ['briefId', 'practice', 'experience', 'security', 'pii', 'vendorImpact', 'stopRecommendation', 'confirmedChange'],
    ),
  },
  records_plan_update: {
    description: 'Write a plan to update or delete frozen record ids, and stop. It changes nothing in the org. The code reads the ids and computes the count, the state hash, the expiry, and the reversibility class. Values and your text stay in the local store. Execution is a separate tool with its own dialog.',
    inputSchema: object(
      {
        orgId: ORG_ID,
        practiceReviewId: PRACTICE_REVIEW_ID,
        object: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
        operation: { type: 'string', enum: ['update', 'delete'], description: 'No upsert or insert in this version.' },
        changes: {
          type: 'array',
          maxItems: 100,
          description: 'Empty for a delete.',
          items: { type: 'object', properties: { field: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' }, value: { type: ['string', 'number', 'boolean', 'null'] } }, required: ['field', 'value'], additionalProperties: false },
        },
        frozenRecordIds: { type: 'array', minItems: 1, maxItems: 10000, items: { type: 'string', pattern: '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' } },
        businessObjective: MODEL_TEXT,
        notes: MODEL_TEXT,
      },
      ['orgId', 'briefId', 'practiceReviewId', 'object', 'operation', 'changes', 'frozenRecordIds'],
    ),
  },
  deployment_plan: {
    description: 'Write a plan to deploy an artifact in this project, and stop. It changes nothing in the org. The code hashes the artifact and computes the count, the expiry, and the reversibility class. The path and your text stay in the local store.',
    inputSchema: object(
      {
        orgId: ORG_ID,
        practiceReviewId: PRACTICE_REVIEW_ID,
        artifactPath: { type: 'string', minLength: 1, maxLength: 1000, description: 'A folder in metadata format with a package.xml at its root, or a zip of one, inside this project. Leave out when rollbackOf is given.' },
        rollbackOf: { ...PLAN_ID, description: 'Puts back the snapshot taken before this deploy plan, as a new change. Leave out when artifactPath is given.' },
        destructive: { type: 'boolean', description: 'True when it deletes metadata. The screen reads the zip either way.' },
        ignoreWarnings: { type: 'boolean', description: 'Only when the person has agreed to it. The approval screen names it.' },
        businessObjective: MODEL_TEXT,
        notes: MODEL_TEXT,
      },
      ['orgId', 'briefId', 'practiceReviewId', 'destructive'],
    ),
  },
  records_preview: {
    description: 'Look at a record change without saving anything. It returns what it checked, what it did not, and the active automation on the object. It checks the ids, the count, object and field permissions from describe, and record access. It does not run validation rules, triggers, flows, or duplicate rules, because only a save runs those. Records have no way to rehearse a save, so never present this as one.',
    inputSchema: object(
      {
        orgId: ORG_ID,
        object: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
        operation: { type: 'string', enum: ['update', 'delete'] },
        changes: {
          type: 'array',
          maxItems: 100,
          description: 'Empty for a delete.',
          items: { type: 'object', properties: { field: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' }, value: { type: ['string', 'number', 'boolean', 'null'] } }, required: ['field', 'value'], additionalProperties: false },
        },
        frozenRecordIds: { type: 'array', minItems: 1, maxItems: 10000, items: { type: 'string', pattern: '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' } },
      },
      ['orgId', 'briefId', 'object', 'operation', 'changes', 'frozenRecordIds'],
    ),
  },
  deployment_validate: {
    description: 'Run a check-only deployment of a plan, with tests, and return the job status. It changes nothing in the org. The service builds and hashes the zip itself and picks the path from the live sandbox flag. A job still running comes back as in progress: call this again with the same planId to pick it up. Pass revalidate after a refusal. Nothing falls back to a full deploy.',
    inputSchema: object({ orgId: ORG_ID, planId: PLAN_ID, revalidate: { type: 'boolean', description: 'Start a new check, voiding the one held for this plan.' } }, ['orgId', 'briefId', 'planId']),
  },
  deployment_verify: {
    description: 'Check a record plan or a deploy plan against the org, without writing to it. For records it re-reads the frozen ids and classifies each one: done, untouched, changed by someone else, or unknown. For a deploy it reads the job, the components, and the org again. It never re-sends anything, and a failed post-deploy check stays failed.',
    inputSchema: object({ orgId: ORG_ID, planId: PLAN_ID }, ['orgId', 'briefId', 'planId']),
  },
  brief_propose: {
    description: 'Store the clarified request as a brief, off the repo, and get its briefId and briefHash. The code computes the hash. You cannot set a hash, a status, or an approver. A person confirms it with sf_brief_confirm where that tool exists.',
    inputSchema: object(
      {
        objective: { type: 'string', minLength: 1, maxLength: 2000 },
        environment: { type: 'string', maxLength: 300, description: 'Classification, org name, and org id. Empty if the person has not named one.' },
        subjects: {
          type: 'array',
          maxItems: 50,
          items: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, status: { type: 'string', enum: ['known', 'assumed'] } }, required: ['name', 'status'], additionalProperties: false },
        },
        change: { type: 'string', maxLength: 2000, description: 'What would change. A question leaves this empty.' },
        blockingQuestions: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      ['objective', 'environment', 'subjects', 'change', 'blockingQuestions'],
    ),
  },
}

/** The dialog tools the mod serves. Not on the stdio list: a person answers these. */
export const SHOW_VALUES_SCHEMA: Schema = {
  type: 'object',
  properties: {
    orgId: ORG_ID,
    briefId: BRIEF_ID,
    object: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$', description: 'Records: the object API name. Leave out for a report.' },
    fields: { type: 'array', items: { type: 'string', maxLength: 255 }, minItems: 1, maxItems: 50, description: 'Records: the exact fields to show.' },
    where: WHERE,
    orderBy: ORDER_BY,
    reportId: { ...REPORT_ID, description: 'A report whose rows to show. Leave out for records.' },
    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'The most rows to show.' },
  },
  required: ['orgId', 'briefId', 'limit'],
  additionalProperties: false,
}

export const BRIEF_CONFIRM_SCHEMA: Schema = { type: 'object', properties: { briefId: BRIEF_ID }, required: ['briefId'], additionalProperties: false }

export const RECORDS_EXECUTE_SCHEMA: Schema = { type: 'object', properties: { planId: PLAN_ID }, required: ['planId'], additionalProperties: false }

export const DEPLOYMENT_EXECUTE_SCHEMA: Schema = { type: 'object', properties: { planId: PLAN_ID, cancel: { type: 'boolean', description: 'Ask to cancel the deploy running under this plan. A person approves that too.' } }, required: ['planId'], additionalProperties: false }

export const RESTORE_EXECUTE_SCHEMA: Schema = { type: 'object', properties: { planId: { ...PLAN_ID, description: 'The plan to restore from: the one that made the change.' }, briefId: BRIEF_ID }, required: ['planId', 'briefId'], additionalProperties: false }

export const VALIDATE_RUN_SCHEMA: Schema = { type: 'object', properties: { planId: PLAN_ID, revalidate: { type: 'boolean', description: 'Start a new check, voiding the one held for this plan. A person approves that.' } }, required: ['planId'], additionalProperties: false }

export const TESTS_RUN_SCHEMA: Schema = {
  type: 'object',
  properties: {
    orgId: ORG_ID,
    briefId: BRIEF_ID,
    level: { type: 'string', enum: ['RunLocalTests', 'RunAllTestsInOrg', 'RunSpecifiedTests'], description: 'Start with the narrowest that answers the question.' },
    classNames: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)?$' }, description: 'For RunSpecifiedTests only.' },
    runId: { type: 'string', pattern: '^707[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$', description: 'Pick up a run started earlier. It reads, so no dialog opens.' },
  },
  required: ['orgId', 'briefId'],
  additionalProperties: false,
}

export const ACK_ISSUE_SCHEMA: Schema = { type: 'object', properties: { issueId: { type: 'string', minLength: 1, maxLength: 128, description: 'The id of the live notice, from the tool result that raised it.' } }, required: ['issueId'], additionalProperties: false }

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function matchesType(value: unknown, wanted: string): boolean {
  if (wanted === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeOf(value) === wanted
}

/** Checks the subset of JSON Schema that TOOL_SCHEMAS uses. Returns what is wrong, or null. */
export function validateArgs(schema: Schema, value: unknown, path = 'arguments'): string | null {
  const type = schema.type
  if (Array.isArray(type) ? !type.some(item => matchesType(value, String(item))) : typeof type === 'string' && !matchesType(value, type)) {
    return `${path} must be ${Array.isArray(type) ? type.join(' or ') : type}.`
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}.`
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return `${path} is not in the allowed form.`
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${path} is too short.`
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${path} is too long.`
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path} is too small.`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path} is too large.`
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path} needs at least ${schema.minItems}.`
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path} takes at most ${schema.maxItems}.`
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        const problem = validateArgs(schema.items as Schema, item, `${path}[${index}]`)
        if (problem !== null) return problem
      }
    }
  }
  if (typeOf(value) === 'object') {
    const record = value as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, Schema>
    for (const name of (schema.required ?? []) as string[]) if (record[name] === undefined) return `${path}.${name} is required.`
    for (const [name, inner] of Object.entries(record)) {
      const spec = properties[name]
      if (spec === undefined) {
        if (schema.additionalProperties === false) return `${path}.${name} is not accepted.`
        continue
      }
      const problem = validateArgs(spec, inner, `${path}.${name}`)
      if (problem !== null) return problem
    }
  }
  return null
}
