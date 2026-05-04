# MIM Registry Bundled Data — License Note

This directory contains **only** the minimum data required to bootstrap the
runtime fetch of Cisco ACI Managed Information Model (MIM) metadata from the
public Cisco DevNet:

* `devnet_versions.json` — URL templates for documented public devnet paths.
* `classes/<version>.json.gz` — flat lists of MIM **class identifiers**
  (package + class name pairs). No descriptive content (property lists,
  comments, relationships, validators) is bundled.
* `core_classes.json` — a curated short-list of identifiers used to prioritise
  which classes are fetched first (so the UI becomes usable mid-import).

## Why this is bundled

Bundling **descriptive MIM content** (property metadata, class comments,
relationships) in a third-party open-source repository would risk a license
conflict with Cisco's documentation copyright. We do **not** do that.

What is bundled here is restricted to identifiers (package and class names)
which are factual, non-creative API symbols, used only as targets for the
runtime fetch performed by each Fabrik installation against
`pubhub.devnetcloud.com` — the same endpoint Cisco serves to anyone who
opens the model documentation in their browser.

The actual MIM payload (the per-class JSON with properties, comments,
relations, validators, etc.) is downloaded by the **user's container at
install time**, written directly to that user's local Neo4j database, and
never persisted in this repository or any release artifact.

If a Cisco licensing review identifies further trimming as desirable, the
slim class lists can be regenerated at install time from the public docui
bundle without bundling them in the repo at all.

## Updating to a new APIC version

1. Produce a `classes/<version_key>.json.gz` seed file containing the flat
   list of class identifiers for the new version.
2. Add a new entry to `devnet_versions.json` with the matching `url_template`
   and `fallback_chain`.
3. Bump the data migration if the seed schema changes (otherwise
   `manage.py migrate` is a no-op).
