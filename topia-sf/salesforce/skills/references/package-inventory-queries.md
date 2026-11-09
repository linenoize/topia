<!-- Adapted from forcedotcom/sf-skills skills/dx-org-analyze/references/collection-details.md @219a84a, Apache-2.0; modified -->
<!-- Adapted from forcedotcom/sf-skills skills/dx-org-analyze/scripts/collect_org_data.py @219a84a, Apache-2.0; modified -->

# Package inventory queries

What `packages_inventory` runs, and what it leaves out. Use the tool. Don't send these through `records_query` as a workaround.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.

The queries are upstream's. The Python that ran them wasn't ported. Each one is fixed text with no model input.

## Installed packages (Tooling API)

```sql
SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix,
       SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion,
       SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber
FROM InstalledSubscriberPackage
```

Upstream reads major and minor only. Patch and build are added because a finding pins an exact version. The Tooling API guide's sample query selects all four.

## Components by namespace

One fixed query per type, with `NamespacePrefix != null` and a limit of 2,000. `ApexTrigger`, `ApexClass`, `FlowDefinition`, and `EntityDefinition` go through the Tooling API. `PermissionSet` is a standard object, filtered to leave out profiles' own.

## Components installed by a package with no namespace (not run yet)

Namespace grouping can't see packages with no namespace, so the tool reports those components as not checked. `ManageableState` can see them. These are the queries for when that gets built:

```sql
SELECT DeveloperName, ManageableState FROM CustomObject WHERE ManageableState IN ('installed', 'installedEditable') AND NamespacePrefix = null
SELECT DeveloperName, EntityDefinition.DeveloperName, ManageableState FROM CustomField WHERE ManageableState IN ('installed', 'installedEditable') AND NamespacePrefix = null
SELECT Name, ManageableState FROM ApexClass WHERE ManageableState IN ('installed', 'installedEditable') AND NamespacePrefix = null
SELECT Name, ManageableState FROM ApexTrigger WHERE ManageableState IN ('installed', 'installedEditable') AND NamespacePrefix = null
SELECT MasterLabel, ManageableState FROM Flow WHERE ManageableState IN ('installed', 'installedEditable') AND NamespacePrefix = null
SELECT ValidationName, ManageableState FROM ValidationRule WHERE ManageableState IN ('installed', 'installedEditable') AND NamespacePrefix = null
```

## Licenses (standard objects)

Counts only.

```sql
SELECT Name, TotalLicenses, UsedLicenses, Status FROM UserLicense
SELECT DeveloperName, TotalLicenses, UsedLicenses FROM PermissionSetLicense
SELECT NamespacePrefix, AllowedLicenses, UsedLicenses, Status FROM PackageLicense
```

## Reading the result

- A package with no namespace is still a package. An empty namespace isn't "no package".
- A query that fails isn't an empty result. Report it as not checked.
- Namespaced components are references. They can't be edited as if they were the org's own.
- Package names and namespaces belong in the person's project docs, never in this repo.

## Not yet checked

These queries come from upstream's source and the Salesforce guides. None has been run against an org by this project. Row limits and field access on `InstalledSubscriberPackage` and the other objects need the live checklist, item 10.
