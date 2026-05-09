# awx/consumers.py
#
# Django Channels WebSocket consumer for real-time execution updates.
# Clients (the RequestDetail page) connect to request-{request_id} and receive
# status/progress events as they arrive from the Celery job monitor.
#
# Authentication is enforced at connect time (close 4401 for anonymous, 4403
# for unauthorized). The ownership check uses @database_sync_to_async because
# Channels consumers run in async context but Django ORM is synchronous.

import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.serializers.json import DjangoJSONEncoder

logger = logging.getLogger(__name__)


class AWXExecutionConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer subscribed to a single automation request's channel group.

    On connect, it sends the current request status immediately so the frontend
    doesn't have to wait for the next polling event. After that, events come in
    from WebSocketService.broadcast_execution_update() via the channel layer.
    """

    async def connect(self):
        """Accept WebSocket connection with authentication and ownership check."""
        # Authenticate user
        user = self.scope.get('user')
        if not user or user.is_anonymous:
            await self.close(code=4401)
            return

        self.request_id = self.scope['url_route']['kwargs']['request_id']

        # Verify ownership — user must own this request or be staff
        has_access = await self._check_request_access(user)
        if not has_access:
            await self.close(code=4403)
            return

        self.room_group_name = f'request-{self.request_id}'

        # Join room group
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        await self.accept()

        # Send initial status on connection
        try:
            initial_status = await self.get_request_status()
            await self.send(
                text_data=json.dumps(
                    {'type': 'initial_status', 'data': initial_status}, cls=DjangoJSONEncoder
                )
            )

            logger.info(f'WebSocket connected to request {self.request_id} by user {user.id}')
        except Exception as e:
            logger.error(f'Failed to send initial status: {str(e)}')

    @database_sync_to_async
    def _check_request_access(self, user):
        """Check if user owns this request or is staff."""
        from .models import AutomationRequest

        if user.is_staff:
            return AutomationRequest.objects.filter(id=self.request_id).exists()
        return AutomationRequest.objects.filter(id=self.request_id, requested_by=user).exists()

    async def disconnect(self, close_code):
        """Leave request channel on disconnect."""
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        logger.info(
            f'WebSocket disconnected from request {getattr(self, "request_id", "?")} (code: {close_code})'
        )

    async def receive(self, text_data):
        """
        Handle incoming WebSocket messages from client.

        Currently supports:
        - refresh: Request status refresh
        """
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'ping':
                # Heartbeat ping - respond with pong
                await self.send(text_data=json.dumps({'type': 'pong'}))
            elif message_type == 'refresh':
                # Client requests status refresh
                status = await self.get_request_status()
                await self.send(
                    text_data=json.dumps(
                        {'type': 'status_update', 'data': status}, cls=DjangoJSONEncoder
                    )
                )
        except json.JSONDecodeError:
            logger.error(f'Invalid JSON received: {text_data}')
        except Exception as e:
            logger.error(f'Error handling message: {str(e)}')

    async def execution_update(self, event):
        """
        Handle execution update events from channel layer.

        Broadcasts execution status changes to connected clients.
        """
        await self.send(
            text_data=json.dumps(
                {'type': 'execution_update', 'data': event['data']}, cls=DjangoJSONEncoder
            )
        )

    async def progress_update(self, event):
        """
        Handle progress update events from channel layer.

        Broadcasts execution progress (percentage, current task, etc).
        """
        await self.send(
            text_data=json.dumps(
                {'type': 'progress_update', 'data': event['data']}, cls=DjangoJSONEncoder
            )
        )

    async def status_change(self, event):
        """
        Handle status change events from channel layer.

        Broadcasts when request or execution status changes.
        """
        await self.send(
            text_data=json.dumps(
                {'type': 'status_change', 'data': event['data']}, cls=DjangoJSONEncoder
            )
        )

    @database_sync_to_async
    def get_request_status(self):
        """
        Get current status of automation request and its executions.

        Returns:
            dict: Request status with execution details
        """
        from .models import AutomationRequest, AutomationExecution
        from .serializers import AutomationExecutionSerializer

        try:
            request = AutomationRequest.objects.get(id=self.request_id)
            executions = AutomationExecution.objects.filter(automation_request=request).order_by(
                '-created_at'
            )

            return {
                'request_id': str(request.id),
                'status': request.status,
                'created_at': request.created_at,
                'updated_at': request.updated_at,
                'executions': AutomationExecutionSerializer(executions, many=True).data,
            }
        except AutomationRequest.DoesNotExist:
            logger.error(f'Request {self.request_id} not found')
            return {'error': 'Request not found', 'request_id': str(self.request_id)}


class AWXExecutionDetailConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for individual AWX execution updates.

    Clients subscribe to an execution channel to receive real-time updates
    for a specific execution (job progress, output, status changes).

    Channel: execution-{execution_id}
    """

    async def connect(self):
        """Accept WebSocket connection with authentication and ownership check."""
        # Authenticate user
        user = self.scope.get('user')
        if not user or user.is_anonymous:
            await self.close(code=4401)
            return

        self.execution_id = self.scope['url_route']['kwargs']['execution_id']

        # Verify ownership — user must own the parent request or be staff
        has_access = await self._check_execution_access(user)
        if not has_access:
            await self.close(code=4403)
            return

        self.room_group_name = f'execution-{self.execution_id}'

        # Join room group
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        await self.accept()

        # Send initial execution details
        try:
            initial_data = await self.get_execution_details()
            await self.send(
                text_data=json.dumps(
                    {'type': 'initial_data', 'data': initial_data}, cls=DjangoJSONEncoder
                )
            )

            logger.info(f'WebSocket connected to execution {self.execution_id} by user {user.id}')
        except Exception as e:
            logger.error(f'Failed to send initial execution data: {str(e)}')

    @database_sync_to_async
    def _check_execution_access(self, user):
        """Check if user owns the parent request or is staff."""
        from .models import AutomationExecution

        if user.is_staff:
            return AutomationExecution.objects.filter(id=self.execution_id).exists()
        return AutomationExecution.objects.filter(
            id=self.execution_id, automation_request__requested_by=user
        ).exists()

    async def disconnect(self, close_code):
        """Leave execution channel on disconnect."""
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        logger.info(
            f'WebSocket disconnected from execution {getattr(self, "execution_id", "?")} (code: {close_code})'
        )

    async def receive(self, text_data):
        """
        Handle incoming WebSocket messages from client.

        Currently supports:
        - refresh: Request execution details refresh
        - fetch_output: Request job output/stdout
        """
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'ping':
                # Heartbeat ping - respond with pong
                await self.send(text_data=json.dumps({'type': 'pong'}))
            elif message_type == 'refresh':
                details = await self.get_execution_details()
                await self.send(
                    text_data=json.dumps(
                        {'type': 'execution_details', 'data': details}, cls=DjangoJSONEncoder
                    )
                )
            elif message_type == 'fetch_output':
                # Fetch job output from AWX
                output = await self.get_job_output()
                await self.send(
                    text_data=json.dumps(
                        {'type': 'job_output', 'data': output}, cls=DjangoJSONEncoder
                    )
                )
        except json.JSONDecodeError:
            logger.error(f'Invalid JSON received: {text_data}')
        except Exception as e:
            logger.error(f'Error handling message: {str(e)}')

    async def execution_progress(self, event):
        """
        Handle execution progress events from channel layer.

        Broadcasts progress percentage and current task.
        """
        await self.send(
            text_data=json.dumps(
                {'type': 'execution_progress', 'data': event['data']}, cls=DjangoJSONEncoder
            )
        )

    async def execution_status(self, event):
        """
        Handle execution status change events from channel layer.

        Broadcasts when execution status changes (running -> successful/failed).
        """
        await self.send(
            text_data=json.dumps(
                {'type': 'execution_status', 'data': event['data']}, cls=DjangoJSONEncoder
            )
        )

    async def execution_output(self, event):
        """
        Handle execution output events from channel layer.

        Broadcasts job stdout/output chunks in real-time.
        """
        await self.send(
            text_data=json.dumps(
                {'type': 'execution_output', 'data': event['data']}, cls=DjangoJSONEncoder
            )
        )

    @database_sync_to_async
    def get_execution_details(self):
        """
        Get current execution details.

        Returns:
            dict: Execution details including status, progress, metadata
        """
        from .models import AutomationExecution
        from .serializers import AutomationExecutionSerializer

        try:
            execution = AutomationExecution.objects.select_related(
                'automation_request', 'automation_request__template'
            ).get(id=self.execution_id)

            serializer = AutomationExecutionSerializer(execution)
            return serializer.data
        except AutomationExecution.DoesNotExist:
            logger.error(f'Execution {self.execution_id} not found')
            return {'error': 'Execution not found', 'execution_id': str(self.execution_id)}

    @database_sync_to_async
    def get_job_output(self):
        """
        Fetch job output from AWX.

        Returns:
            dict: Job output/stdout
        """
        from .models import AutomationExecution
        from .services.awx_client import AWXClient

        try:
            execution = AutomationExecution.objects.select_related(
                'automation_request__template__awx_connection'
            ).get(id=self.execution_id)

            if not execution.awx_job_id:
                return {'output': '', 'error': 'Job not yet started'}

            # Get AWX client
            connection = execution.automation_request.template.awx_connection
            client = AWXClient.for_connection(connection)

            # Fetch job output
            output_data = client.get_job_output(execution.awx_job_id)

            return {'output': output_data.get('content', ''), 'job_id': execution.awx_job_id}
        except AutomationExecution.DoesNotExist:
            return {'output': '', 'error': 'Execution not found'}
        except Exception as e:
            logger.error(f'Failed to fetch job output: {str(e)}')
            return {'output': '', 'error': 'Failed to fetch job output'}
