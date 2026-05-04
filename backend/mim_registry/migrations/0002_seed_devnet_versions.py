# Seeds DevNetVersion rows from data/devnet_versions.json. Idempotent —
# uses update_or_create keyed on version_key so re-running is safe.

import json
from pathlib import Path

from django.db import migrations


SEED_PATH = Path(__file__).resolve().parent.parent / 'data' / 'devnet_versions.json'


def _load_seed() -> list[dict]:
    with SEED_PATH.open() as f:
        payload = json.load(f)
    versions = payload.get('versions') or []
    if not isinstance(versions, list):
        raise RuntimeError(
            f'devnet_versions.json: "versions" must be a list, got {type(versions).__name__}'
        )
    return versions


def forward(apps, schema_editor):
    DevNetVersion = apps.get_model('mim_registry', 'DevNetVersion')
    for entry in _load_seed():
        DevNetVersion.objects.update_or_create(
            version_key=entry['version_key'],
            defaults={
                'label': entry['label'],
                'url_template': entry['url_template'],
                'fallback_chain': entry.get('fallback_chain') or [entry['version_key']],
                'is_supported': entry.get('is_supported', True),
                'display_order': entry.get('display_order', 0),
                'class_count_seed': entry.get('class_count_seed', 0),
                'notes': entry.get('notes', ''),
            },
        )


def reverse(apps, schema_editor):
    DevNetVersion = apps.get_model('mim_registry', 'DevNetVersion')
    seed_keys = [e['version_key'] for e in _load_seed()]
    DevNetVersion.objects.filter(version_key__in=seed_keys).delete()


class Migration(migrations.Migration):
    atomic = True

    dependencies = [
        ('mim_registry', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(forward, reverse),
    ]
