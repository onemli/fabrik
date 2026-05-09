# awx/models/request.py
#
# AutomationRequest — user request to execute an automation template
import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class AutomationRequest(models.Model):
    """One user's request to execute an AutomationTemplate with specific data.

    Lifecycle: pending → running → successful / failed / cancelled

    input_data holds the raw table data from the wizard UI. ansible_extra_vars
    holds the transformed version that was actually sent to AWX — kept separately
    so we can audit what AWX received versus what the user entered.

    metadata captures HTTP request context (IP, user agent, session) for compliance.
    This is populated by capture_request_metadata() right when the request is created.
    """

    STATUS_AWAITING_APPROVAL = 'awaiting_approval'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_PENDING = 'pending'
    STATUS_RUNNING = 'running'
    STATUS_SUCCESSFUL = 'successful'
    STATUS_FAILED = 'failed'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_AWAITING_APPROVAL, 'Awaiting Approval'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_PENDING, 'Pending'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_SUCCESSFUL, 'Successful'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)

    # Template & Connections
    template = models.ForeignKey(
        'AutomationTemplate', on_delete=models.CASCADE, related_name='requests'
    )
    awx_connection = models.ForeignKey(
        'AWXConnection', on_delete=models.CASCADE, related_name='requests'
    )
    target_apic = models.ForeignKey(
        'apic_connections.APICConnection',
        on_delete=models.CASCADE,
        related_name='automation_requests',
        null=True,
        blank=True,
        help_text='Target APIC (if required)',
    )

    # AWX Credential — selected at execution time (per-site).
    # References a credential stored in AWX's own vault (never in Fabrik's DB).
    # AWX injects the secret values into the playbook environment at launch time.
    awx_credential_id = models.IntegerField(
        null=True, blank=True, help_text='AWX Credential ID for target device authentication'
    )
    awx_credential_name = models.CharField(
        max_length=200,
        blank=True,
        default='',
        help_text='Cached credential name from AWX (display only)',
    )

    # Input Data (from wizard tables)
    input_data = models.JSONField(
        help_text='User-provided data from tables (structured by sheet name)'
    )

    # Transformed Data
    ansible_extra_vars = models.JSONField(
        null=True, blank=True, help_text='Transformed extra_vars for AWX'
    )

    # Workflow State
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    check_mode = models.BooleanField(
        default=False, help_text='Run in Ansible check mode (dry-run, no changes applied)'
    )

    # Audit Trail - Creation
    requested_by = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='requests_created'
    )
    requested_at = models.DateTimeField(auto_now_add=True)

    # Execution
    awx_job_id = models.IntegerField(
        null=True, blank=True, help_text='AWX job ID or workflow job ID'
    )

    # Request Metadata (for audit trail and compliance)
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="""
        Request metadata for audit trail:
        - client_ip: Client IP address
        - user_agent: Browser user agent
        - session_id: Django session ID
        - ldap_attributes: LDAP user attributes (if LDAP enabled)
        - geo_location: IP geolocation (optional)
        """,
    )

    # Prevent duplicate submissions from double-clicks or network retries.
    # The frontend generates a UUID before each request and sends it here.
    idempotency_key = models.CharField(max_length=64, null=True, blank=True, db_index=True)

    # Frozen copy of the template config at the time this request was created.
    # Protects against schema changes between creation and execution.
    template_snapshot = models.JSONField(null=True, blank=True)

    # Optional future execution — null means "run immediately"
    scheduled_for = models.DateTimeField(null=True, blank=True)

    # Approval workflow fields
    approved_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='approved_awx_requests',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default='')

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'awx_automation_request'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['requested_by', '-created_at']),
            models.Index(fields=['template', '-created_at']),
        ]

    def __str__(self):
        return f'{self.title} ({self.status})'

    @staticmethod
    def get_client_ip(request):
        """
        Get client IP address from Django request.
        Handles X-Forwarded-For header for proxy/load balancer setups.
        Validates the result is a plausible IP address.
        """
        import ipaddress

        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            # Get first IP in chain (client IP)
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR', '')

        # Validate IP format to prevent header injection
        try:
            ipaddress.ip_address(ip)
        except (ValueError, TypeError):
            ip = ''

        return ip

    def capture_request_metadata(self, request):
        """
        Capture HTTP request metadata for audit trail
        Call this method when creating/updating request
        """
        self.metadata.update(
            {
                'client_ip': self.get_client_ip(request),
                'user_agent': request.META.get('HTTP_USER_AGENT', ''),
                'session_id': request.session.session_key if hasattr(request, 'session') else None,
                'timestamp_captured': timezone.now().isoformat(),
            }
        )
