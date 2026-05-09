"""WebSocket consumer for live MIM import progress.

URL: ``ws://<host>/ws/mim-import/<task_id>/``

Message types emitted by the Celery task (see ``tasks.py``):

* ``mim_progress`` — ``{stage, progress, message}`` (0-100 integer).
* ``mim_status``   — ``{status: success|failed, error?}`` terminal frame.
"""

import json

from asgiref.sync import sync_to_async
from celery.result import AsyncResult
from channels.generic.websocket import AsyncWebsocketConsumer


_TERMINAL_STATES = {'SUCCESS', 'FAILURE', 'REVOKED'}


class MIMImportConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.task_id = self.scope['url_route']['kwargs']['task_id']
        self.group_name = f'mim_import_{self.task_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        # If the task already finished before the client (re)connected — e.g.
        # the user refreshed right after success — replay the terminal frame
        # so the UI doesn't wait forever for a message that will never come.
        await self._replay_terminal_if_done()

    async def _replay_terminal_if_done(self):
        def _read():
            result = AsyncResult(self.task_id)
            state = result.state
            if state not in _TERMINAL_STATES:
                return None
            err = None
            if state in ('FAILURE', 'REVOKED'):
                try:
                    err = str(result.result) if result.result else 'Import failed'
                except Exception:
                    err = 'Import failed'
            return state, err

        snapshot = await sync_to_async(_read)()
        if not snapshot:
            return
        state, err = snapshot
        payload = {
            'type': 'mim_status',
            'status': 'success' if state == 'SUCCESS' else 'failed',
        }
        if err:
            payload['error'] = err
        await self.send(text_data=json.dumps(payload))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            msg = json.loads(text_data)
        except json.JSONDecodeError:
            return
        if msg.get('type') == 'ping':
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def mim_progress(self, event):
        # Forward all known fields verbatim. Older clients ignore unknown keys.
        payload = {'type': 'mim_progress'}
        for key in (
            'stage',
            'progress',
            'message',
            'phase',
            'done',
            'total',
            'fallback_count',
            'not_found_count',
            'failed_count',
        ):
            if key in event:
                payload[key] = event[key]
        await self.send(text_data=json.dumps(payload))

    async def mim_core_ready(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'mim_core_ready',
                    'core_class_count': event.get('core_class_count'),
                }
            )
        )

    async def mim_status(self, event):
        payload = {'type': 'mim_status', 'status': event.get('status')}
        if 'error' in event:
            payload['error'] = event['error']
        if 'summary' in event:
            payload['summary'] = event['summary']
        await self.send(text_data=json.dumps(payload))
