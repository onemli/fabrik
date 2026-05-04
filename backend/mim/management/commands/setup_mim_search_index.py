# mim/management/commands/setup_mim_search_index.py
#
# One-time setup command that creates a Neo4j full-text index over the four
# most-searched Class properties: className, label, classPkg, description.
# Without the index, search falls back to slow CONTAINS / regex scans.
#
# Safe to run multiple times — the Cypher uses IF NOT EXISTS.
# Use --drop-existing to force a full rebuild after a major MIM sync.
#
# Usage:
#   python manage.py setup_mim_search_index
#   python manage.py setup_mim_search_index --drop-existing
#   python manage.py setup_mim_search_index --test-only
from django.core.management.base import BaseCommand, CommandError
from mim.neo4j_connection import neo4j_connection


class Command(BaseCommand):
    help = 'Setup Neo4j full-text search indexes for MIM class searching'

    def add_arguments(self, parser):
        parser.add_argument(
            '--drop-existing',
            action='store_true',
            help='Drop existing index before creating new one',
        )
        parser.add_argument(
            '--test-only',
            action='store_true',
            help='Only test if index exists, do not create',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING('=== MIM Search Index Setup ===\n'))

        if not self._test_connection():
            raise CommandError('Failed to connect to Neo4j. Check your settings.')

        if options['test_only']:
            self._test_index()
            self._test_property_index()
            return

        drop = options['drop_existing']

        self._ensure_index('classSearchIndex', self._create_index, self._drop_index, drop)
        self._ensure_index('propertySearchIndex', self._create_property_index, self._drop_property_index, drop)

        self._await_indexes()

        self._test_index()
        self._test_property_index()

        self.stdout.write(self.style.SUCCESS('\n✓ Search index setup completed successfully!'))

    def _ensure_index(self, name, create_fn, drop_fn, drop_existing):
        if self._index_exists(name):
            if drop_existing:
                self.stdout.write(self.style.WARNING(f'Dropping {name}...'))
                drop_fn()
            else:
                self.stdout.write(self.style.SUCCESS(f'✓ {name} already exists'))
                return
        create_fn()

    def _test_connection(self):
        """Quick RETURN 1 ping — fails fast before any index work."""
        try:
            query = "RETURN 1 as test"
            neo4j_connection.execute_query(query)
            self.stdout.write(self.style.SUCCESS('✓ Neo4j connection: OK'))
            return True
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'✗ Neo4j connection failed: {str(e)}'))
            return False

    def _index_exists(self, name):
        try:
            indexes = neo4j_connection.execute_query("SHOW INDEXES")
            return any(idx.get('name') == name for idx in indexes)
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'Could not check indexes: {e}'))
            return False

    def _drop_index(self):
        try:
            neo4j_connection.execute_query("DROP INDEX classSearchIndex IF EXISTS")
            self.stdout.write(self.style.SUCCESS('✓ classSearchIndex dropped'))
        except Exception as e:
            raise CommandError(f'Failed to drop index: {e}')

    def _drop_property_index(self):
        try:
            neo4j_connection.execute_query("DROP INDEX propertySearchIndex IF EXISTS")
            self.stdout.write(self.style.SUCCESS('✓ propertySearchIndex dropped'))
        except Exception as e:
            raise CommandError(f'Failed to drop index: {e}')

    def _create_index(self):
        """Create the full-text index with the standard-no-stop-words analyzer.
        That analyzer skips common English stop words so searches for "tenant"
        or "bridge" aren't polluted by results matching "the" / "a" / "of"."""
        try:
            self.stdout.write('Creating full-text search index...')

            # Create full-text index on className, label, classPkg, and description
            query = """
            CREATE FULLTEXT INDEX classSearchIndex IF NOT EXISTS
            FOR (c:Class)
            ON EACH [c.className, c.label, c.classPkg, c.description]
            OPTIONS {
              indexConfig: {
                `fulltext.analyzer`: 'standard-no-stop-words',
                `fulltext.eventually_consistent`: false
              }
            }
            """
            neo4j_connection.execute_query(query)

            self.stdout.write(self.style.SUCCESS('✓ Index created successfully'))
            self.stdout.write('  Indexed fields: className, label, classPkg, description')
            self.stdout.write('  Analyzer: standard-no-stop-words')

        except Exception as e:
            raise CommandError(f'Failed to create index: {str(e)}')

    def _create_property_index(self):
        try:
            self.stdout.write('Creating propertySearchIndex...')
            neo4j_connection.execute_query("""
            CREATE FULLTEXT INDEX propertySearchIndex IF NOT EXISTS
            FOR (p:Property)
            ON EACH [p.name, p.className]
            OPTIONS {
              indexConfig: {
                `fulltext.analyzer`: 'standard-no-stop-words',
                `fulltext.eventually_consistent`: false
              }
            }
            """)
            self.stdout.write(self.style.SUCCESS('✓ propertySearchIndex created'))
        except Exception as e:
            raise CommandError(f'Failed to create property index: {e}')

    def _test_property_index(self):
        try:
            self.stdout.write('\nTesting propertySearchIndex...')
            for term, desc in [('operSt', 'Exact'), ('admin*', 'Prefix')]:
                results = neo4j_connection.execute_query(
                    "CALL db.index.fulltext.queryNodes('propertySearchIndex', $t) "
                    "YIELD node, score RETURN node.name as name, node.className as cls, score LIMIT 3",
                    {'t': term},
                )
                if results:
                    self.stdout.write(self.style.SUCCESS(f'  ✓ {desc}: {len(results)} results'))
                    for r in results[:2]:
                        self.stdout.write(f'    - {r["cls"]}.{r["name"]} (score: {r["score"]:.2f})')
                else:
                    self.stdout.write(self.style.WARNING(f'  ! {desc}: No results'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ Property index test failed: {e}'))

    def _await_indexes(self):
        try:
            self.stdout.write('\nWaiting for indexes to come online...')
            neo4j_connection.execute_query("CALL db.awaitIndexes(300)")
            self.stdout.write(self.style.SUCCESS('✓ Indexes online'))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'  ! Await failed: {e}'))

    def _test_index(self):
        try:
            self.stdout.write('\nTesting index with sample queries...')

            # Test 1: Exact match
            test_queries = [
                ('fvTenant', 'Exact match'),
                ('tenant~', 'Fuzzy match (typo tolerance)'),
                ('fv*', 'Prefix search'),
            ]

            for search_term, description in test_queries:
                query = """
                CALL db.index.fulltext.queryNodes('classSearchIndex', $searchTerm)
                YIELD node, score
                RETURN node.className as className, score
                LIMIT 3
                """
                results = neo4j_connection.execute_query(
                    query,
                    {'searchTerm': search_term}
                )

                if results:
                    self.stdout.write(self.style.SUCCESS(f'  ✓ {description}: {len(results)} results'))
                    for r in results[:2]:
                        self.stdout.write(f'    - {r["className"]} (score: {r["score"]:.2f})')
                else:
                    self.stdout.write(self.style.WARNING(f'  ! {description}: No results'))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ Index test failed: {str(e)}'))
            self.stdout.write(self.style.WARNING('  Note: Full-text search requires Neo4j 4.1+'))
