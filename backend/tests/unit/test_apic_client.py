"""
Unit tests for APIC Client
Tests authentication, query execution, and error handling
"""

import pytest
import responses
from datetime import datetime, timedelta
from apic_connections.apic_client import APICClient


@pytest.mark.unit
class TestAPICClientInit:
    """Test APICClient initialization"""

    def test_client_initialization(self):
        """Test basic client initialization"""
        client = APICClient(
            url='https://sandboxapicdc.cisco.com',
            username='admin',
            password='password123',
            verify_ssl=True,
            timeout=30,
        )

        assert client.url == 'https://sandboxapicdc.cisco.com'
        assert client.username == 'admin'
        assert client.password == 'password123'
        assert client.verify_ssl is True
        assert client.timeout == 30
        assert client.token is None
        assert client.token_expiry is None

    def test_url_trailing_slash_removed(self):
        """Test that trailing slash is removed from URL"""
        client = APICClient(
            url='https://sandboxapicdc.cisco.com/', username='admin', password='password123'
        )

        assert client.url == 'https://sandboxapicdc.cisco.com'


@pytest.mark.unit
class TestAPICClientLogin:
    """Test APIC authentication"""

    @responses.activate
    def test_successful_login(self):
        """Test successful APIC login"""
        # Mock successful login response
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={
                'imdata': [
                    {
                        'aaaLogin': {
                            'attributes': {
                                'token': 'test-token-123',
                                'siteFingerprint': 'test-fingerprint',
                            }
                        }
                    }
                ]
            },
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-123'},
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        success, error = client.login()

        assert success is True
        assert error is None
        assert client.token == 'test-token-123'
        assert client.token_expiry is not None
        assert client.token_expiry > datetime.now()

    @responses.activate
    def test_login_with_invalid_credentials(self):
        """Test login with invalid credentials"""
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={
                'imdata': [
                    {'error': {'attributes': {'code': '401', 'text': 'Authentication failed'}}}
                ]
            },
            status=401,
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='wrongpassword'
        )

        success, error = client.login()

        assert success is False
        assert 'Authentication failed' in error
        assert client.token is None

    @responses.activate
    def test_login_connection_error(self):
        """Test login with connection error"""
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            body=ConnectionError('Connection refused'),
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        success, error = client.login()

        assert success is False
        assert 'Connection failed' in error or 'Connection refused' in error

    @responses.activate
    def test_login_timeout(self):
        """Test login timeout"""
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            body=Exception('Timeout'),
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com',
            username='admin',
            password='password123',
            timeout=1,
        )

        success, error = client.login()

        assert success is False
        assert error is not None


@pytest.mark.unit
class TestAPICClientTokenValidation:
    """Test token validation"""

    def test_token_not_valid_when_none(self):
        """Test token validation when token is None"""
        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        assert client.is_token_valid() is False

    def test_token_valid_when_not_expired(self):
        """Test token validation when token is valid"""
        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        client.token = 'test-token'
        client.token_expiry = datetime.now() + timedelta(minutes=5)

        assert client.is_token_valid() is True

    def test_token_not_valid_when_expired(self):
        """Test token validation when token is expired"""
        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        client.token = 'test-token'
        client.token_expiry = datetime.now() - timedelta(minutes=1)

        assert client.is_token_valid() is False


@pytest.mark.unit
class TestAPICClientQueryExecution:
    """Test APIC query execution"""

    @responses.activate
    def test_execute_query_success(self):
        """Test successful query execution"""
        # Mock login
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-123'},
        )

        # Mock query response
        responses.add(
            responses.GET,
            'https://sandboxapicdc.cisco.com/api/class/fvTenant.json',
            json={
                'totalCount': '2',
                'imdata': [
                    {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                    {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}},
                ],
            },
            status=200,
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        success, data, error = client.execute_query('/api/class/fvTenant.json')

        assert success is True
        assert error is None
        assert data is not None
        assert data['totalCount'] == '2'
        assert len(data['imdata']) == 2

    @responses.activate
    def test_execute_query_with_filter(self):
        """Test query execution with filters"""
        # Mock login
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-123'},
        )

        # Mock query response
        responses.add(
            responses.GET,
            'https://sandboxapicdc.cisco.com/api/class/fvTenant.json?query-target-filter=eq(fvTenant.name,"tenant1")',
            json={
                'totalCount': '1',
                'imdata': [
                    {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
                ],
            },
            status=200,
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        success, data, error = client.execute_query(
            '/api/class/fvTenant.json?query-target-filter=eq(fvTenant.name,"tenant1")'
        )

        assert success is True
        assert data['totalCount'] == '1'
        assert data['imdata'][0]['fvTenant']['attributes']['name'] == 'tenant1'

    @responses.activate
    def test_execute_query_not_found(self):
        """Test query execution with 404 response"""
        # Mock login
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-123'},
        )

        # Mock 404 response
        responses.add(
            responses.GET,
            'https://sandboxapicdc.cisco.com/api/class/invalidClass.json',
            json={
                'imdata': [{'error': {'attributes': {'code': '400', 'text': 'Invalid class name'}}}]
            },
            status=400,
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        success, data, error = client.execute_query('/api/class/invalidClass.json')

        assert success is False
        assert data is None
        assert 'Invalid class name' in error

    @responses.activate
    def test_execute_query_auto_reauth(self):
        """Test automatic re-authentication when token expires"""
        # First login (token will expire)
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token-1'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-1'},
        )

        # Second login (re-auth)
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token-2'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-2'},
        )

        # Query response
        responses.add(
            responses.GET,
            'https://sandboxapicdc.cisco.com/api/class/fvTenant.json',
            json={'totalCount': '0', 'imdata': []},
            status=200,
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        # First login
        client.login()

        # Expire the token
        client.token_expiry = datetime.now() - timedelta(minutes=1)

        # Execute query (should auto re-authenticate)
        success, data, error = client.execute_query('/api/class/fvTenant.json')

        assert success is True
        # Two login calls should have been made
        assert len([r for r in responses.calls if 'aaaLogin' in r.request.url]) == 2


@pytest.mark.unit
class TestAPICClientTestConnection:
    """Test connection testing"""

    @responses.activate
    def test_connection_success(self):
        """Test successful connection test"""
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token-123'},
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='password123'
        )

        success, error = client.test_connection()

        assert success is True
        assert error is None

    @responses.activate
    def test_connection_failure(self):
        """Test failed connection test"""
        responses.add(
            responses.POST,
            'https://sandboxapicdc.cisco.com/api/aaaLogin.json',
            json={
                'imdata': [
                    {'error': {'attributes': {'code': '401', 'text': 'Authentication failed'}}}
                ]
            },
            status=401,
        )

        client = APICClient(
            url='https://sandboxapicdc.cisco.com', username='admin', password='wrongpassword'
        )

        success, error = client.test_connection()

        assert success is False
        assert error is not None


@pytest.mark.unit
class TestAPICClientSSL:
    """Test SSL verification settings"""

    def test_ssl_verification_enabled_by_default(self):
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        assert client.verify_ssl is True

    def test_ssl_verification_disabled(self):
        client = APICClient(
            url='https://apic.example.com', username='admin', password='pass', verify_ssl=False
        )
        assert client.verify_ssl is False

    @responses.activate
    def test_ssl_error_returns_helpful_message(self):
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            body=__import__('requests').exceptions.SSLError('certificate verify failed'),
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        success, error = client.login()
        assert success is False
        assert 'SSL' in error


@pytest.mark.unit
class TestAPICClientQueryMethods:
    """Test different HTTP methods and edge cases"""

    @responses.activate
    def test_execute_query_post(self):
        """Test POST method for configuration changes"""
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'tok'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=tok'},
        )
        responses.add(
            responses.POST,
            'https://apic.example.com/api/mo/uni/tn-test.json',
            json={'totalCount': '0', 'imdata': []},
            status=200,
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        success, data, error = client.execute_query(
            '/api/mo/uni/tn-test.json',
            method='POST',
            data={'fvTenant': {'attributes': {'name': 'test'}}},
        )
        assert success is True

    @responses.activate
    def test_unsupported_http_method(self):
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'tok'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=tok'},
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        success, data, error = client.execute_query('/api/test', method='PATCH')
        assert success is False
        assert 'Unsupported' in error

    @responses.activate
    def test_execute_query_timeout(self):
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'tok'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=tok'},
        )
        responses.add(
            responses.GET,
            'https://apic.example.com/api/class/fvTenant.json',
            body=__import__('requests').exceptions.Timeout('timeout'),
        )
        client = APICClient(
            url='https://apic.example.com', username='admin', password='pass', timeout=5
        )
        success, data, error = client.execute_query('/api/class/fvTenant.json')
        assert success is False
        assert 'timed out' in error

    @responses.activate
    def test_execute_query_connection_error(self):
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'tok'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=tok'},
        )
        responses.add(
            responses.GET,
            'https://apic.example.com/api/class/fvTenant.json',
            body=__import__('requests').exceptions.ConnectionError('refused'),
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        success, data, error = client.execute_query('/api/class/fvTenant.json')
        assert success is False
        assert 'Request error' in error

    @responses.activate
    def test_path_without_leading_slash(self):
        """Paths without leading slash should still work"""
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'tok'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=tok'},
        )
        responses.add(
            responses.GET,
            'https://apic.example.com/api/class/fvTenant.json',
            json={'totalCount': '0', 'imdata': []},
            status=200,
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        success, data, error = client.execute_query('api/class/fvTenant.json')
        assert success is True

    @responses.activate
    def test_execute_query_empty_result(self):
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'tok'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=tok'},
        )
        responses.add(
            responses.GET,
            'https://apic.example.com/api/class/fvTenant.json',
            json={'totalCount': '0', 'imdata': []},
            status=200,
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        success, data, error = client.execute_query('/api/class/fvTenant.json')
        assert success is True
        assert data['totalCount'] == '0'
        assert len(data['imdata']) == 0


@pytest.mark.unit
class TestAPICClientEnsureAuthenticated:
    """Test ensure_authenticated logic"""

    def test_valid_token_skips_login(self):
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        client.token = 'valid-token'
        client.token_expiry = datetime.now() + timedelta(minutes=5)
        success, error = client.ensure_authenticated()
        assert success is True
        assert error is None

    @responses.activate
    def test_expired_token_triggers_login(self):
        responses.add(
            responses.POST,
            'https://apic.example.com/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'new-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=new-token'},
        )
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        client.token = 'expired-token'
        client.token_expiry = datetime.now() - timedelta(minutes=1)
        success, error = client.ensure_authenticated()
        assert success is True
        assert client.token == 'new-token'


@pytest.mark.unit
class TestAPICClientSession:
    """Test session management"""

    def test_close_session(self):
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        client.close()
        # Should not raise

    def test_default_timeout(self):
        client = APICClient(url='https://apic.example.com', username='admin', password='pass')
        assert client.timeout == 30

    def test_custom_timeout(self):
        client = APICClient(
            url='https://apic.example.com', username='admin', password='pass', timeout=60
        )
        assert client.timeout == 60
