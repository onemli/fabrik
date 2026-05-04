# Integration tests for Dashboard API endpoints

import pytest
from rest_framework import status


@pytest.mark.integration
@pytest.mark.django_db
class TestDashboardStats:
    """Test /api/dashboard/stats/ endpoint"""

    def test_returns_stats_for_authenticated_user(self, authenticated_client):
        response = authenticated_client.get('/api/dashboard/stats/')

        assert response.status_code == status.HTTP_200_OK
        data = response.data
        assert 'generated_at' in data
        assert 'queries' in data
        assert 'scheduled_tasks' in data
        assert 'awx' in data
        assert 'time_machine' in data
        assert 'connections' in data
        assert 'activity' in data
        assert 'attention' in data

    def test_queries_section_structure(self, authenticated_client):
        response = authenticated_client.get('/api/dashboard/stats/')

        queries = response.data['queries']
        assert 'total_saved' in queries
        assert 'executions_24h' in queries
        assert 'success_rate_7d' in queries
        assert 'sparkline_7d' in queries
        assert isinstance(queries['sparkline_7d'], list)

    def test_scheduled_tasks_section_structure(self, authenticated_client):
        response = authenticated_client.get('/api/dashboard/stats/')

        tasks = response.data['scheduled_tasks']
        assert 'total' in tasks
        assert 'active' in tasks
        assert 'paused' in tasks
        assert 'overdue' in tasks

    def test_connections_section_structure(self, authenticated_client):
        response = authenticated_client.get('/api/dashboard/stats/')

        conns = response.data['connections']
        assert 'total' in conns
        assert 'active' in conns
        assert 'inactive' in conns

    def test_unauthenticated_access_denied(self, api_client):
        response = api_client.get('/api/dashboard/stats/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.django_db
class TestPlatformInfo:
    """Test /api/dashboard/platform-info/ endpoint"""

    def test_returns_platform_info(self, api_client):
        """Platform info is a public endpoint (AllowAny)"""
        response = api_client.get('/api/dashboard/platform-info/')

        assert response.status_code == status.HTTP_200_OK
        assert 'demo_mode' in response.data
        assert 'version' in response.data
        assert 'ldap_enabled' in response.data
        assert isinstance(response.data['demo_mode'], bool)

    def test_accessible_without_authentication(self, api_client):
        """Ensure unauthenticated access works for platform info"""
        response = api_client.get('/api/dashboard/platform-info/')
        assert response.status_code == status.HTTP_200_OK
