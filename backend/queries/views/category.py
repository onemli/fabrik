# queries/views/category.py
#
# CRUD for query categories. Read access is open to any authenticated user
# (IsAuthenticatedOrReadOnly); mutations require authentication.

from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from django.db.models import Count
from audit.services import AuditService
from ..models import Category
from ..serializers import CategorySerializer


class CategoryViewSet(viewsets.ModelViewSet):
    # query_count is annotated here so the serializer can include it without
    # triggering an extra DB hit per category row.
    queryset = Category.objects.annotate(query_count=Count('queries'))
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at', 'query_count']
    ordering = ['name']
    # Categories are a short list — no point paginating them in the sidebar
    pagination_class = None

    def perform_create(self, serializer):
        instance = serializer.save()

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='category_created',
            category='category_management',
            resource_type='Category',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Category '{instance.name}' created",
            metadata={
                'description': instance.description,
                'color': instance.color,
            },
            request=self.request,
        )

    def perform_update(self, serializer):
        instance = serializer.instance

        # Track changes
        old_data = {
            'name': instance.name,
            'description': instance.description,
            'color': instance.color,
        }

        updated_instance = serializer.save()

        # Detect changes
        changes = {}
        new_data = {
            'name': updated_instance.name,
            'description': updated_instance.description,
            'color': updated_instance.color,
        }
        for key, old_val in old_data.items():
            new_val = new_data[key]
            if old_val != new_val:
                changes[key] = {'old': old_val, 'new': new_val}

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='category_updated',
            category='category_management',
            resource_type='Category',
            resource_id=updated_instance.id,
            resource_name=updated_instance.name,
            description=f"Category '{updated_instance.name}' updated",
            metadata={'changes': changes} if changes else {},
            request=self.request,
        )

    def perform_destroy(self, instance):
        # Audit log (before deletion)
        AuditService.log(
            user=self.request.user,
            action='category_deleted',
            category='category_management',
            resource_type='Category',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Category '{instance.name}' deleted",
            metadata={
                'query_count': instance.queries.count(),
            },
            request=self.request,
        )

        instance.delete()
