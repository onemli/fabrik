# api_keys/management/commands/create_api_key.py
#
#   python manage.py create_api_key --user sync-bot --name "inventory sync" --ip 10.0.0.5 --days 365
#
# Prints the key once. It cannot be shown again; a lost key is revoked in the
# admin and a new one made.

import ipaddress
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from api_keys.models import ApiKey


class Command(BaseCommand):
    help = 'Make an API key for a user and print it once.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='The user the key acts as')
        parser.add_argument('--name', required=True, help='What the key is for')
        parser.add_argument(
            '--ip',
            action='append',
            default=[],
            help='An address or network it may be used from; repeat for more',
        )
        parser.add_argument('--days', type=int, help='Days until it expires; leave out for never')

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username=options['user']).first()
        if user is None:
            raise CommandError(f'No user named {options["user"]}.')
        for ip in options['ip']:
            if not _is_network(ip):
                raise CommandError(f'{ip} is not an address or a network.')
        expires_at = timezone.now() + timedelta(days=options['days']) if options['days'] else None
        record, key = ApiKey.create(user, options['name'], options['ip'], expires_at)
        self.stdout.write(f'API key "{record.name}" for {user.username}:\n\n    {key}\n')
        self.stdout.write(
            'Keep it now: it is not shown again. Send it as "Authorization: Api-Key <key>".'
        )


def _is_network(text: str) -> bool:
    try:
        ipaddress.ip_network(text, strict=False)
    except ValueError:
        return False
    return True
