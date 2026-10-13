# api_keys/authentication.py
#
# Reads "Authorization: Api-Key fbk_..." and signs the request in as the key's
# user. Only the views that list ApiKeyAuthentication accept a key (today the
# query runs, queries/views/runs.py); everything else still needs a person's
# sign-in, so a leaked key cannot change users, connections or queries.

from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions

from .models import ApiKey, hash_key

KEYWORD = 'Api-Key'

# last_used_at is written at most this often, not on every request.
USE_RECORDED_EVERY = timedelta(minutes=1)


def client_ip(request) -> str:
    """The caller's address. Fabrik's nginx sets X-Real-IP to the address it saw,
    replacing whatever the caller sent, so it can be trusted; X-Forwarded-For
    cannot, since its first entry is written by the caller."""
    return request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR', '')


class ApiKeyAuthentication(authentication.BaseAuthentication):
    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode(errors='replace')
        keyword, _, key = header.partition(' ')
        if keyword != KEYWORD:
            return None  # Not an API key: the other authentication classes may read it.
        key = key.strip()
        if not key:
            raise exceptions.AuthenticationFailed('The API key is missing after "Api-Key".')

        record = ApiKey.objects.select_related('user').filter(key_hash=hash_key(key)).first()
        # The same answer for an unknown, revoked or expired key: a caller learns nothing by trying.
        if (
            record is None
            or not record.is_active
            or record.is_expired()
            or not record.user.is_active
        ):
            raise exceptions.AuthenticationFailed('The API key is not valid.')
        if not record.allows_ip(client_ip(request)):
            raise exceptions.AuthenticationFailed('The API key may not be used from this address.')

        now = timezone.now()
        if record.last_used_at is None or now - record.last_used_at > USE_RECORDED_EVERY:
            ApiKey.objects.filter(pk=record.pk).update(last_used_at=now)
        return record.user, record

    def authenticate_header(self, request):
        return KEYWORD
