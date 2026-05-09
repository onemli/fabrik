"""URL and fallback-chain helpers for the devnet streaming importer.

The devnet URL pattern is templated per APIC version, e.g.
``https://pubhub.devnetcloud.com/media/model-doc-611/docs/doc/jsonmeta/{pkg}/{class}.json``.

For a class like ``fvTenant`` (package ``fv``) the pattern resolves to
``.../jsonmeta/fv/Tenant.json`` — the URL uses the class name *without* the
package prefix that ACI wears in its codebase form. This module owns that
translation and the fallback ordering.
"""

from __future__ import annotations

from typing import Iterable, List, Sequence
from urllib.parse import quote


def split_normalized_class(class_pkg: str, class_name: str) -> tuple[str, str]:
    """Map (package, normalized_class) to (url_pkg, url_class).

    `class_name` is in codebase form like ``fvTenant`` — devnet URLs want the
    class name *without* its package prefix (``Tenant``). If the class_name
    happens to start with the package (case-sensitive), strip it; otherwise
    pass through unchanged.

    Examples:
        ('fv', 'fvTenant') -> ('fv', 'Tenant')
        ('vz', 'vzBrCP')   -> ('vz', 'BrCP')
        ('top', 'Root')    -> ('top', 'Root')   # already split
    """
    if not class_pkg or not class_name:
        return class_pkg or '', class_name or ''
    if class_name.startswith(class_pkg) and len(class_name) > len(class_pkg):
        return class_pkg, class_name[len(class_pkg) :]
    return class_pkg, class_name


def build_url(template: str, class_pkg: str, class_name: str) -> str:
    """Render a devnet URL by substituting {pkg} and {class}.

    Performs URL-segment escaping defensively even though ACI identifiers are
    ASCII-only in practice.
    """
    pkg, cls = split_normalized_class(class_pkg, class_name)
    return template.replace('{pkg}', quote(pkg, safe='')).replace('{class}', quote(cls, safe=''))


def fallback_versions_for(
    requested_version: str,
    chain: Sequence[str],
    available_keys: Iterable[str],
) -> List[str]:
    """Return the actual ordered list of version_keys to try.

    Ensures the requested version is the first entry, drops duplicates, and
    skips any key that isn't in ``available_keys`` (e.g. a chain entry that
    references a version no longer supported).
    """
    available = set(available_keys)
    seen: set[str] = set()
    out: List[str] = []
    if requested_version in available:
        out.append(requested_version)
        seen.add(requested_version)
    for key in chain:
        if key in available and key not in seen:
            out.append(key)
            seen.add(key)
    return out
