/**
 * What a metadata type in a deploy zip can do, from a table. The default is the point: a type that
 * isn't in the table is flagged, never passed. "No flags" is for a zip where every type is known and
 * benign. No imports, no Node: the mod reads this to build the screen.
 *
 * The names are the Metadata API type names. They were written from the Metadata API Developer Guide
 * as remembered, and not checked against the current PDF (it is too large to fetch here). A name that
 * is spelled differently in a real org reads as unknown, which is flagged. So a wrong entry here errs
 * toward a flag, except for a type wrongly listed as benign, which the live checklist asks a person to review.
 */

export type TypeClass = 'code' | 'access' | 'automation' | 'benign' | 'unknown'

const CODE = ['ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'AuraDefinitionBundle', 'LightningComponentBundle', 'Flow', 'FlowDefinition', 'StaticResource', 'WebLink', 'Scontrol', 'CustomSite', 'EmailServicesFunction', 'PlatformEventSubscriberConfig', 'OmniScript', 'OmniUiCard', 'OmniDataTransform', 'OmniIntegrationProcedure', 'CustomApplicationComponent', 'LightningExperienceTheme', 'Prompt', 'GenAiFunction', 'GenAiPlugin']

const ACCESS = [
  'ConnectedApp', 'ExternalClientApplication', 'ExtlClntAppOauthSettings', 'ExtlClntAppGlobalOauthSettings', 'OauthCustomScope', 'NamedCredential', 'ExternalCredential', 'ExternalDataSource', 'ExternalServiceRegistration', 'AuthProvider', 'RemoteSiteSetting', 'CspTrustedSite', 'CorsWhitelistOrigin', 'SamlSsoConfig', 'Settings', 'IframeWhiteListUrlSettings', 'LoginFlow', 'NetworkAccess', 'EventRelayConfig', 'PlatformEventChannel', 'PlatformEventChannelMember', 'OutboundNetworkConnection', 'CallCenter',
  'Profile', 'ProfilePasswordPolicy', 'ProfileSessionSetting', 'PermissionSet', 'PermissionSetGroup', 'MutingPermissionSet', 'CustomPermission', 'Role', 'RoleOrTerritory', 'Territory', 'Territory2', 'Territory2Model', 'Territory2Rule', 'Territory2Type', 'Group', 'Queue', 'DelegateGroup', 'UserCriteria', 'Network', 'NetworkBranding', 'Site', 'SiteDotCom', 'ExperienceBundle', 'CommunityTemplateDefinition', 'CommunityThemeDefinition', 'ManagedContentType',
  'SharingRules', 'SharingOwnerRule', 'SharingCriteriaRule', 'SharingGuestRule', 'SharingTerritoryRule', 'SharingSet', 'AccountRelationshipShareRule', 'DataCategoryGroup', 'RestrictionRule', 'ScopeRule', 'CustomObject', 'ReportFolder', 'DashboardFolder', 'DocumentFolder', 'EmailFolder', 'ApexEmailNotifications', 'DataPipeline',
]

const AUTOMATION = ['EmailTemplate', 'Workflow', 'WorkflowRule', 'WorkflowAlert', 'WorkflowFieldUpdate', 'WorkflowOutboundMessage', 'WorkflowTask', 'WorkflowKnowledgePublish', 'WorkflowSend', 'ApprovalProcess', 'AssignmentRules', 'AssignmentRule', 'AutoResponseRules', 'EscalationRules', 'EscalationRule', 'FlowCategory', 'ActionLinkGroupTemplate', 'AppointmentSchedulingPolicy']

const BENIGN = [
  'CustomField', 'CustomTab', 'CustomApplication', 'Layout', 'FlexiPage', 'ListView', 'QuickAction', 'CompactLayout', 'RecordType', 'ValidationRule', 'BusinessProcess', 'CustomLabels', 'CustomLabel', 'Translations', 'GlobalValueSet', 'StandardValueSet', 'CustomMetadata', 'ReportType', 'Report', 'Dashboard', 'Document', 'Letterhead', 'FieldSet', 'SearchLayouts', 'PathAssistant', 'AppMenu', 'CustomFeedFilter', 'TopicsForObjects', 'ContentAsset', 'MatchingRule', 'DuplicateRule', 'LightningMessageChannel', 'CustomIndex', 'Index', 'SummaryLayout', 'ListViewFilter', 'FlowTest', 'BrandingSet', 'Icon', 'MilestoneType', 'EntitlementProcess', 'ObjectTranslation', 'GlobalPicklist', 'CustomHelpMenuSection', 'ApexTestSuite',
]

const TABLE = new Map<string, TypeClass>()
for (const [list, kind] of [[BENIGN, 'benign'], [AUTOMATION, 'automation'], [ACCESS, 'access'], [CODE, 'code']] as const) for (const name of list) TABLE.set(name, kind)

/** Exact type name or nothing: a different case or a stray character is a type nobody has classified. */
export function classifyType(type: string): TypeClass {
  return TABLE.get(type) ?? 'unknown'
}

export const FLAG_CODE = 'Runs code.'
export const FLAG_ACCESS = 'Changes access or opens an outbound path.'
export const FLAG_AUTOMATION = 'Runs automation: it can update records, send email, or call out.'
export const FLAG_UNKNOWN = 'Includes a type Topia does not recognise. Treat it as able to run code, change access, or open an outbound path.'
export const FLAGS_NONE = 'none. Every type in this zip is on the known-benign list. That list says nothing about what a component does inside.'

/**
 * What metadata_retrieve may hand back over stdio. Everything here is configuration: code, schema,
 * layouts, automation, and access settings. A type that can hold what a person typed in, or what a
 * report or file holds, is not on it: Report, Dashboard, Document, ContentAsset, StaticResource,
 * EmailTemplate, CustomMetadata (its records), Group and Queue (their members), and the rest. An
 * unknown type is withheld, the same as a known one that isn't listed.
 */
const RETRIEVABLE = new Set([
  'ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'ApexTestSuite', 'AuraDefinitionBundle', 'LightningComponentBundle', 'Flow', 'FlowDefinition',
  'CustomObject', 'CustomField', 'CustomTab', 'CustomApplication', 'Layout', 'FlexiPage', 'ListView', 'QuickAction', 'CompactLayout', 'RecordType', 'ValidationRule', 'BusinessProcess', 'FieldSet', 'SearchLayouts', 'GlobalValueSet', 'StandardValueSet', 'ReportType',
  'ConnectedApp', 'NamedCredential', 'ExternalCredential', 'AuthProvider', 'RemoteSiteSetting', 'CspTrustedSite', 'CorsWhitelistOrigin', 'Settings', 'SamlSsoConfig', 'SharingRules', 'SharingOwnerRule', 'SharingCriteriaRule', 'Role', 'CustomLabels', 'CustomLabel',
  'Profile', 'PermissionSet', 'PermissionSetGroup', 'MutingPermissionSet', 'CustomPermission', 'Workflow', 'ApprovalProcess', 'AssignmentRules', 'AutoResponseRules', 'EscalationRules',
])

export function isRetrievable(type: string): boolean {
  return RETRIEVABLE.has(type)
}

export const WITHHELD_NOTE = 'Withheld over stdio: these types can hold what people typed in, or what a report, file or template holds. No Topia tool returns them. A person can retrieve them with the Salesforce CLI in their own terminal.'
