# queries/consumers.py
#
# WebSocket consumer for real-time query execution progress. The Celery task
# writes to a channel group (execution_<id>) and these messages flow to whatever
# browser tab has the connection open. If no browser is connected (e.g. a
# programmatic trigger), the channel send is a no-op.
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class ChainExecutionConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for background query execution monitoring.

    URL: ws://localhost:8000/ws/chain-execution/<execution_id>/

    Message types:
      execution_progress  — {"progress": 50, "message": "Executing query..."}
      execution_status    — {"status": "success" | "failed" | "running"}
      execution_error     — {"error": "<message>"}
    """

    async def connect(self):
        """Handle WebSocket connection"""
        self.execution_id = self.scope['url_route']['kwargs']['job_id']
        self.group_name = f'execution_{self.execution_id}'

        # Accept the connection first (we'll verify access via execution ownership)
        await self.accept()

        # Join execution group
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        # Send initial status
        execution_data = await self.get_execution_status()
        if execution_data:
            await self.send(
                text_data=json.dumps(
                    {
                        'type': 'execution_status',
                        'status': execution_data['status'],
                        'progress': execution_data['progress'],
                        'message': execution_data['progress_message'],
                    }
                )
            )
        else:
            # Execution not found, close connection
            await self.close()

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection"""
        # Leave execution group
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            # Handle different message types if needed
            if message_type == 'ping':
                await self.send(text_data=json.dumps({'type': 'pong'}))
        except json.JSONDecodeError:
            pass

    async def execution_progress(self, event):
        """Handle progress update from Celery task"""
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'execution_progress',
                    'progress': event['progress'],
                    'message': event['message'],
                }
            )
        )

    async def execution_status(self, event):
        """Handle status update from Celery task"""
        await self.send(
            text_data=json.dumps({'type': 'execution_status', 'status': event['status']})
        )

    async def execution_error(self, event):
        """Handle error from Celery task"""
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'execution_error',
                    'error': event.get('error', 'Unknown error'),
                    'error_type': event.get('error_type', 'Error'),
                }
            )
        )

    @database_sync_to_async
    def get_execution_status(self):
        """Get current execution status from database (pipeline jobs)."""
        from .models import ChainExecutionJob

        try:
            job = ChainExecutionJob.objects.get(id=self.execution_id)
            return {
                'status': job.status,
                'progress': job.progress_percentage,
                'progress_message': f'{job.completed_iterations}/{job.total_iterations} stages',
            }
        except ChainExecutionJob.DoesNotExist:
            return None


# NotificationConsumer has been moved to the notifications app.
# See notifications/consumers.py.
