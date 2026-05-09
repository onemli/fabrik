# apic_connections/apic_client.py
#
# HTTP client for the Cisco APIC REST API. APIC uses cookie-based session auth:
# login returns an APIC-cookie that requests.Session holds automatically.
# Tokens expire after ~10 minutes, so ensure_logged_in() checks the expiry
# before every request and re-authenticates if needed.
#
# executeQuery() is the main entry point — it builds the APIC URL, fires the
# GET request, and returns the imdata array. The caller doesn't need to know
# about the APIC-specific response format.

import requests
from typing import Dict, Any, Optional, Tuple
from datetime import datetime, timedelta


class APICClient:
    """Session-based HTTP client for the Cisco APIC REST API."""

    def __init__(
        self, url: str, username: str, password: str, verify_ssl: bool = True, timeout: int = 30
    ):
        self.url = url.rstrip('/')
        self.username = username
        self.password = password
        self.verify_ssl = verify_ssl
        self.timeout = timeout
        self.token = None
        self.token_expiry = None
        self.session = requests.Session()

    def login(self) -> Tuple[bool, Optional[str]]:
        """POST credentials to APIC and set the session cookie.

        APIC stores the auth token in the APIC-cookie response cookie, which
        requests.Session picks up automatically. We also record the expiry time
        so ensure_logged_in() can pro-actively refresh before it expires.
        """
        login_url = f'{self.url}/api/aaaLogin.json'
        payload = {'aaaUser': {'attributes': {'name': self.username, 'pwd': self.password}}}

        try:
            response = self.session.post(
                login_url, json=payload, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code == 200:
                response.json()
                # Token is automatically stored in cookies by requests.Session
                self.token = response.cookies.get('APIC-cookie')
                # APIC tokens typically last 10 minutes
                self.token_expiry = datetime.now() + timedelta(minutes=10)
                return True, None
            else:
                error_msg = (
                    response.json()
                    .get('imdata', [{}])[0]
                    .get('error', {})
                    .get('attributes', {})
                    .get('text', 'Login failed')
                )
                return False, error_msg

        except requests.exceptions.SSLError:
            return False, 'SSL certificate verification failed. Try disabling SSL verification.'
        except requests.exceptions.ConnectionError:
            return False, 'Connection failed. Check APIC URL and network connectivity.'
        except requests.exceptions.Timeout:
            return False, f'Request timed out after {self.timeout} seconds.'
        except Exception as e:
            return False, f'APIC login failed ({type(e).__name__}).'

    def is_token_valid(self) -> bool:
        """Check if current token is still valid"""
        if not self.token or not self.token_expiry:
            return False
        return datetime.now() < self.token_expiry

    def ensure_authenticated(self) -> Tuple[bool, Optional[str]]:
        """Ensure we have a valid authentication token"""
        if self.is_token_valid():
            return True, None
        return self.login()

    def execute_query(
        self, path: str, method: str = 'GET', data: Optional[Dict] = None
    ) -> Tuple[bool, Any, Optional[str]]:
        """
        Execute a query on APIC
        Args:
            path: API path (e.g., '/api/class/fvTenant.json')
            method: HTTP method
            data: Request payload for POST/PUT
        Returns: (success: bool, response_data: Any, error_message: Optional[str])
        """
        # Ensure we're authenticated
        success, error = self.ensure_authenticated()
        if not success:
            return False, None, error

        # Construct full URL
        if not path.startswith('/'):
            path = '/' + path
        url = f'{self.url}{path}'

        try:
            if method == 'GET':
                response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)
            elif method == 'POST':
                response = self.session.post(
                    url, json=data, verify=self.verify_ssl, timeout=self.timeout
                )
            elif method == 'PUT':
                response = self.session.put(
                    url, json=data, verify=self.verify_ssl, timeout=self.timeout
                )
            elif method == 'DELETE':
                response = self.session.delete(url, verify=self.verify_ssl, timeout=self.timeout)
            else:
                return False, None, f'Unsupported HTTP method: {method}'

            if response.status_code in [200, 201]:
                return True, response.json(), None
            else:
                error_data = response.json() if response.content else {}
                error_msg = (
                    error_data.get('imdata', [{}])[0]
                    .get('error', {})
                    .get('attributes', {})
                    .get('text', 'Request failed')
                )
                return False, None, f'HTTP {response.status_code}: {error_msg}'

        except requests.exceptions.Timeout:
            return False, None, f'Request timed out after {self.timeout} seconds.'
        except requests.exceptions.RequestException as e:
            return False, None, f'APIC request failed ({type(e).__name__}).'
        except Exception as e:
            return False, None, f'APIC request failed ({type(e).__name__}).'

    def test_connection(self) -> Tuple[bool, Optional[str]]:
        """
        Test the connection by attempting to login
        Returns: (success: bool, error_message: Optional[str])
        """
        return self.login()

    def close(self):
        """Close the session"""
        self.session.close()
