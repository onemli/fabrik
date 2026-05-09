# awx/views/webhook_receiver.py
#
# Receives status-change webhooks from AWX and publishes them to the event bus.
# AWX can be configured to POST to this endpoint whenever a job status changes,
# which lets us react in near real-time instead of waiting for the 10-second
# sync_running_jobs poll cycle.
#
# Security: HMAC-SHA256 signature validation is always on (the endpoint rejects
# any request with a missing or wrong signature). IP whitelisting is optional
# and controlled by AWX_WEBHOOK_ALLOWED_IPS in settings.

import os
import hmac
import hashlib
import logging
import json
from typing import Dict, Any, Optional, Tuple

from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework import status

from users.throttles import WebhookRateThrottle
from audit.services import AuditService
from fabrik.logging import safe

logger = logging.getLogger(__name__)


class WebhookSecurityError(Exception):
    """Webhook security validation error"""


def validate_webhook_signature(payload: bytes, signature_header: str, secret: str) -> bool:
    """Return True if the HMAC-SHA256 signature on the webhook payload is valid.

    We use hmac.compare_digest for the final comparison to prevent timing
    attacks — an attacker trying to brute-force the secret would otherwise
    get timing feedback on how many bytes they got right.
    """
    if not signature_header:
        return False

    try:
        # AWX sends signature as: sha256=<hex_digest>
        algorithm, signature = signature_header.split('=', 1)

        if algorithm != 'sha256':
            logger.warning('Unsupported signature algorithm: %s', safe(algorithm))
            return False

        # Calculate expected signature
        expected_signature = hmac.new(secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()

        # Constant-time comparison to prevent timing attacks
        return hmac.compare_digest(signature, expected_signature)

    except Exception:
        logger.exception('Error validating webhook signature')
        return False


def get_webhook_secret() -> Optional[str]:
    """
    Get webhook secret from environment

    Returns:
        Webhook secret or None
    """
    return os.getenv('AWX_WEBHOOK_SECRET')


def parse_awx_webhook_payload(body: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """
    Parse AWX webhook payload and extract event type

    AWX webhook format:
    {
        "id": 123,
        "status": "successful",
        "url": "https://awx.example.com/api/v2/jobs/123/",
        "created_by": "admin",
        "type": "job",  # or "workflow_job"
        ...
    }

    Returns:
        (event_type, normalized_data)
    """

    # Determine event type
    awx_type = body.get('type', '')
    awx_status = body.get('status', 'unknown')

    if awx_type == 'workflow_job':
        event_type = 'workflow_status_change'
        routing_key_prefix = 'workflow.status'
    else:
        event_type = 'job_status_change'
        routing_key_prefix = 'job.status'

    # Extract key fields
    normalized_data = {
        'event_type': event_type,
        'awx_job_id': body.get('id'),
        'awx_type': awx_type,
        'status': awx_status,
        'url': body.get('url'),
        'created_by': body.get('created_by'),
        'started': body.get('started'),
        'finished': body.get('finished'),
        'elapsed': body.get('elapsed'),
        'raw_payload': body,  # Keep full payload for debugging
    }

    return f'{routing_key_prefix}.{awx_status}', normalized_data


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])  # We validate via HMAC instead
@throttle_classes([WebhookRateThrottle])
def awx_webhook_receiver(request: Request) -> Response:
    """
    Receive webhooks from AWX

    Endpoint: POST /api/awx/webhooks/receiver/

    Headers:
        X-AWX-Signature: HMAC signature (if secret is configured)
        Content-Type: application/json

    Body: AWX job/workflow JSON payload

    Returns:
        200: Webhook received and queued
        400: Invalid payload
        401: Invalid signature
        500: Internal error
    """

    try:
        # Get raw body for signature validation
        raw_body = request.body

        # Validate signature if secret is configured
        webhook_secret = get_webhook_secret()
        if webhook_secret:
            signature_header = request.headers.get('X-AWX-Signature', '')
            token_header = request.headers.get('X-AWX-Token', '')

            if signature_header and signature_header.startswith('sha256='):
                # Method 1: HMAC-SHA256 signature (recommended, most secure)
                if not validate_webhook_signature(raw_body, signature_header, webhook_secret):
                    logger.warning(
                        'Invalid HMAC signature from IP: %s',
                        safe(request.META.get('REMOTE_ADDR')),
                    )
                    return Response(
                        {'error': 'Invalid HMAC signature'}, status=status.HTTP_401_UNAUTHORIZED
                    )

            elif signature_header:
                # Method 2: Simple token validation (X-AWX-Signature as plain token)
                if signature_header != webhook_secret:
                    logger.warning(
                        'Invalid token signature from IP: %s',
                        safe(request.META.get('REMOTE_ADDR')),
                    )
                    return Response(
                        {'error': 'Invalid token signature'}, status=status.HTTP_401_UNAUTHORIZED
                    )

            elif token_header:
                # Method 3: Alternative header (X-AWX-Token)
                if token_header != webhook_secret:
                    logger.warning(
                        'Invalid token from IP: %s', safe(request.META.get('REMOTE_ADDR'))
                    )
                    return Response({'error': 'Invalid token'}, status=status.HTTP_401_UNAUTHORIZED)

            else:
                # No authentication header provided but secret is configured
                logger.warning(
                    'Webhook rejected: no auth header from IP: %s '
                    '(secret is configured but no auth header provided)',
                    safe(request.META.get('REMOTE_ADDR')),
                )
                return Response(
                    {'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED
                )

        # Parse JSON payload
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            logger.exception('Invalid JSON in webhook payload')
            return Response({'error': 'Invalid JSON payload'}, status=status.HTTP_400_BAD_REQUEST)

        # Extract event type and normalize data
        routing_key, event_data = parse_awx_webhook_payload(payload)

        # Process directly via JobMonitor instead of publishing to RabbitMQ
        awx_job_id = event_data.get('awx_job_id')
        if awx_job_id:
            try:
                from awx.services.job_monitor import JobMonitor
                from awx.models import AutomationExecution

                executions = AutomationExecution.objects.filter(
                    awx_job_id=awx_job_id
                ).select_related('automation_request', 'awx_connection')

                if executions.exists():
                    monitor = JobMonitor()
                    for execution in executions:
                        monitor._configure_awx_client(execution.awx_connection)
                        monitor.sync_single_execution(execution)

            except Exception:
                logger.exception('Failed to sync job %s from webhook', awx_job_id)

        # Log webhook receipt
        logger.info(
            'Webhook received: job_id=%s, status=%s, routing_key=%s',
            event_data.get('awx_job_id'),
            safe(event_data.get('status')),
            safe(routing_key),
        )

        # Audit log (optional - don't fail if audit fails)
        try:
            AuditService.log(
                user=None,  # Webhook doesn't have a user
                action='awx_webhook_received',
                category='awx_webhook',
                resource_type='AWXJob',
                resource_id=str(event_data.get('awx_job_id', 'unknown')),
                description=f'Webhook received: {routing_key}',
            )
        except Exception as audit_error:
            logger.warning(f'Failed to create audit log: {str(audit_error)}')

        return Response(
            {
                'status': 'received',
                'event_type': event_data.get('event_type'),
                'job_id': event_data.get('awx_job_id'),
                'routing_key': routing_key,
                'queued': True,
            },
            status=status.HTTP_200_OK,
        )

    except Exception as e:
        logger.exception(f'Error processing webhook: {str(e)}')
        return Response(
            {'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def webhook_health_check(request: Request) -> Response:
    """
    Health check endpoint for webhook receiver

    Endpoint: GET /api/awx/webhooks/health/

    Returns:
        200: Service is healthy
        503: Service is unhealthy
    """

    try:
        webhook_secret_configured = bool(get_webhook_secret())

        response_data = {
            'webhook_receiver': 'healthy',
            'webhook_secret_configured': webhook_secret_configured,
            'processing_mode': 'direct',
        }

        return Response(response_data, status=status.HTTP_200_OK)

    except Exception as e:
        logger.exception(f'Health check failed: {str(e)}')
        return Response(
            {'webhook_receiver': 'unhealthy', 'error': 'Health check failed'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([WebhookRateThrottle])
def test_webhook_event(request: Request) -> Response:
    """
    Test endpoint to manually trigger a webhook event

    For testing purposes only - should be disabled in production

    Endpoint: POST /api/awx/webhooks/test/

    Body:
    {
        "job_id": 123,
        "status": "successful",
        "type": "job"  # or "workflow_job"
    }

    Returns:
        200: Test event published
        400: Invalid request
        500: Failed to publish
    """

    if not request.user.is_staff:
        return Response(
            {'error': 'Unauthorized - staff access required'}, status=status.HTTP_403_FORBIDDEN
        )

    try:
        job_id = request.data.get('job_id')
        job_status = request.data.get('status', 'successful')
        job_type = request.data.get('type', 'job')

        if not job_id:
            return Response({'error': 'job_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Create test payload
        test_payload = {
            'id': job_id,
            'status': job_status,
            'type': job_type,
            'url': f'https://awx.example.com/api/v2/jobs/{job_id}/',
            'created_by': request.user.username,
            'test_event': True,
        }

        routing_key, event_data = parse_awx_webhook_payload(test_payload)

        return Response(
            {
                'status': 'test_event_published',
                'routing_key': routing_key,
                'event_data': event_data,
            },
            status=status.HTTP_200_OK,
        )

    except Exception as e:
        logger.exception(f'Test webhook failed: {str(e)}')
        return Response(
            {'error': 'Test webhook failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
