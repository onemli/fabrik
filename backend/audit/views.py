# audit/views.py
#
# Read-only ViewSets for audit data. AuditLog cannot be created or deleted via
# the API — only browsed and exported to CSV. AuditLogSettings allows admins
# to configure retention and export options. All views require staff permission.

from __future__ import annotations
from rest_framework.pagination import PageNumberPagination
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
import csv
from datetime import datetime
from users.views import IsAdminOrSuperuser
from .models import AuditLog, AuditLogSettings, LoginAttempt
from .serializers import AuditLogSerializer, AuditLogDetailSerializer, AuditLogSettingsSerializer, LoginAttemptSerializer


class AuditLogPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all().select_related("user")
    permission_classes = [IsAdminOrSuperuser]
    pagination_class = AuditLogPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["username", "description", "resource_name"]
    ordering_fields = ["timestamp", "category", "action"]
    ordering = ["-timestamp"]

    def get_serializer_class(self) -> type:
        if self.action == "retrieve":
            return AuditLogDetailSerializer
        return AuditLogSerializer

    def get_queryset(self) -> 'QuerySet[AuditLog]':
        queryset = super().get_queryset()

        # Manual filtering
        category = self.request.query_params.get("category")
        action = self.request.query_params.get("action")
        resource_type = self.request.query_params.get("resource_type")
        user_id = self.request.query_params.get("user")
        success = self.request.query_params.get("success")
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")

        if category:
            queryset = queryset.filter(category=category)
        if action:
            queryset = queryset.filter(action=action)
        if resource_type:
            queryset = queryset.filter(resource_type=resource_type)
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        if success is not None:
            queryset = queryset.filter(success=success.lower() == "true")
        if start_date:
            queryset = queryset.filter(timestamp__gte=start_date)
        if end_date:
            queryset = queryset.filter(timestamp__lte=end_date)

        return queryset

    @action(detail=False, methods=["get"])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset())[:10000]
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f"attachment; filename=\"audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv\""
        writer = csv.writer(response)
        writer.writerow(["Timestamp", "Username", "Category", "Action", "Resource Type", "Resource Name", "Description", "IP Address", "Success"])
        for row in queryset.values_list("timestamp", "username", "category", "action", "resource_type", "resource_name", "description", "ip_address", "success"):
            writer.writerow([row[0].isoformat(), row[1], row[2], row[3], row[4], row[5], row[6], row[7], "Yes" if row[8] else "No"])
        return response

    @action(detail=False, methods=["get"])
    def stats(self, request):
        from django.db.models import Count
        from django.utils import timezone as tz
        from datetime import timedelta

        try:
            days = int(request.query_params.get("days", 30))
        except (ValueError, TypeError):
            days = 30
        cutoff = tz.now() - timedelta(days=days)
        base_qs = AuditLog.objects.filter(timestamp__gte=cutoff)

        category_stats = base_qs.values("category").annotate(count=Count("id"))
        action_stats = base_qs.values("action").annotate(count=Count("id"))
        return Response({"total_logs": base_qs.count(), "days": days, "by_category": list(category_stats), "by_action": list(action_stats)})


class AuditLogSettingsViewSet(viewsets.ModelViewSet):
    queryset = AuditLogSettings.objects.all()
    serializer_class = AuditLogSettingsSerializer
    permission_classes = [IsAdminOrSuperuser]
    pagination_class = AuditLogPagination
    http_method_names = ["get", "put", "patch"]

    def get_object(self):
        return AuditLogSettings.get_settings()

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
        from .services import AuditService
        AuditService.log(user=self.request.user, action="audit_settings_updated", category="settings_change", resource_type="AuditLogSettings", resource_id=1, resource_name="Audit Log Settings", description="Audit log settings updated", metadata=serializer.validated_data, request=self.request)


class LoginAttemptViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LoginAttempt.objects.all()
    serializer_class = LoginAttemptSerializer
    permission_classes = [IsAdminOrSuperuser]
    pagination_class = AuditLogPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["username", "ip_address", "failure_reason"]
    ordering_fields = ["timestamp"]
    ordering = ["-timestamp"]

    def get_queryset(self) -> 'QuerySet[LoginAttempt]':
        queryset = super().get_queryset()

        # Manual filtering
        username = self.request.query_params.get("username")
        success = self.request.query_params.get("success")
        ip_address = self.request.query_params.get("ip_address")
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")

        if username:
            queryset = queryset.filter(username__icontains=username)
        if success is not None:
            queryset = queryset.filter(success=success.lower() == "true")
        if ip_address:
            queryset = queryset.filter(ip_address=ip_address)
        if start_date:
            queryset = queryset.filter(timestamp__gte=start_date)
        if end_date:
            queryset = queryset.filter(timestamp__lte=end_date)

        return queryset
