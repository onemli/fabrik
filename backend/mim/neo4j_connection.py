# mim/neo4j_connection.py
#
# Singleton wrapper around the Neo4j Python driver. One driver per process
# is the pattern recommended by the Neo4j docs — the driver manages its own
# connection pool internally. Credentials come from settings.NEO4J_*.

from neo4j import GraphDatabase
from django.conf import settings


class Neo4jConnection:
    """Singleton Neo4j driver wrapper — one instance shared across the process."""

    _instance = None
    _driver = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._driver is None:
            self._driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
            )

    @property
    def driver(self):
        return self._driver

    def close(self):
        if self._driver:
            self._driver.close()
            self._driver = None

    def execute_query(self, query, parameters=None):
        """Run a Cypher query and return all records as plain dicts."""
        with self._driver.session() as session:
            result = session.run(query, parameters or {})
            return [record.data() for record in result]

    def execute_write(self, query, parameters=None):
        """Write transaction"""
        with self._driver.session() as session:
            return session.write_transaction(
                lambda tx: tx.run(query, parameters or {}).consume()
            )


# Global instance
neo4j_connection = Neo4jConnection()
