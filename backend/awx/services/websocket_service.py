# awx/services/websocket_service.py
#
# Thin wrapper around Django Channels that pushes AWX execution events to the
# frontend over WebSocket. The poller and job monitor call this after every
# status change or output chunk — it serializes the data and sends it to the
# appropriate channel group.
#
# _to_json_safe is needed because DRF serializers can produce UUID, Decimal,
# and datetime objects that the Redis channel layer can't serialize. Round-
# tripping through DjangoJSONEncoder converts them all to native Python types.

import json
import logging
from typing import Dict, Any, Optional
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.serializers.json import DjangoJSONEncoder

logger = logging.getLogger(__name__)


def _to_json_safe(data: Any) -> Any:
    # Round-trip through DjangoJSONEncoder to convert UUID/Decimal/datetime to native types.
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


class WebSocketService:
    # Broadcasts execution events to channel groups keyed by request/execution UUID.

    def __init__(self):
        self.channel_layer = get_channel_layer()

        if not self.channel_layer:
            logger.warning("Channel layer not configured - WebSocket updates will not work")

    def emit_execution_update(
        self,
        request_id: str,
        execution_data: Dict[str, Any]
    ) -> bool:
        if not self.channel_layer:
            return False

        try:
            room_group_name = f'request-{request_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'execution_update',
                    'data': _to_json_safe(execution_data)
                }
            )

            logger.debug(f"Sent execution update to {room_group_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to send execution update: {str(e)}")
            return False

    def emit_progress_update(
        self,
        execution_id: str,
        progress: int,
        message: str,
        current_task: Optional[str] = None
    ) -> bool:
        if not self.channel_layer:
            return False

        try:
            room_group_name = f'execution-{execution_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'execution_progress',
                    'data': {
                        'execution_id': str(execution_id),
                        'progress': progress,
                        'message': message,
                        'current_task': current_task
                    }
                }
            )

            logger.debug(f"Sent progress update ({progress}%) to {room_group_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to send progress update: {str(e)}")
            return False

    def emit_status_change(
        self,
        request_id: str,
        execution_id: str,
        old_status: str,
        new_status: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        if not self.channel_layer:
            return False

        try:
            room_group_name = f'request-{request_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'status_change',
                    'data': {
                        'execution_id': str(execution_id),
                        'old_status': old_status,
                        'new_status': new_status,
                        'metadata': metadata or {}
                    }
                }
            )

            logger.info(f"Status changed: {old_status} -> {new_status} for execution {execution_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send status change: {str(e)}")
            return False

    def emit_execution_status(
        self,
        execution_id: str,
        status: str,
        awx_job_id: Optional[int] = None,
        error_message: Optional[str] = None,
        finished_at: Optional[str] = None
    ) -> bool:
        if not self.channel_layer:
            return False

        try:
            room_group_name = f'execution-{execution_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'execution_status',
                    'data': {
                        'execution_id': str(execution_id),
                        'status': status,
                        'awx_job_id': awx_job_id,
                        'error_message': error_message,
                        'finished_at': finished_at
                    }
                }
            )

            logger.debug(f"Sent status update ({status}) to {room_group_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to send execution status: {str(e)}")
            return False

    def emit_job_output(
        self,
        execution_id: str,
        output_chunk: str,
        line_number: Optional[int] = None
    ) -> bool:
        if not self.channel_layer:
            return False

        try:
            room_group_name = f'execution-{execution_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'execution_output',
                    'data': {
                        'execution_id': str(execution_id),
                        'output': output_chunk,
                        'line_number': line_number
                    }
                }
            )

            return True
        except Exception as e:
            logger.error(f"Failed to send job output: {str(e)}")
            return False

    def emit_execution_output(
        self,
        execution_id: str,
        output_data: Dict[str, Any]
    ) -> bool:
        # Full event metadata for live terminal streaming.
        if not self.channel_layer:
            logger.warning("Channel layer not available for output streaming")
            return False

        try:
            room_group_name = f'execution-{execution_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'execution_output',
                    'data': _to_json_safe(output_data)
                }
            )

            logger.debug(
                f"Output emitted for execution {execution_id}, "
                f"counter {output_data.get('counter')}"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to emit execution output: {str(e)}")
            return False

    def emit_to_user(
        self,
        user_id: int,
        notification_type: str,
        data: Dict[str, Any]
    ) -> bool:
        if not self.channel_layer:
            return False

        try:
            room_group_name = f'user-{user_id}'

            async_to_sync(self.channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'user_notification',
                    'notification_type': notification_type,
                    'data': _to_json_safe(data)
                }
            )

            logger.debug(f"Sent {notification_type} notification to user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send user notification: {str(e)}")
            return False


# Singleton instance
_websocket_service = None


def get_websocket_service() -> WebSocketService:
    global _websocket_service
    if _websocket_service is None:
        _websocket_service = WebSocketService()
    return _websocket_service
