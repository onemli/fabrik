#!/usr/bin/env python
# Initialize Neo4j schema for Fabrik
# Run with: python init_neo4j.py
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'fabrik.settings')
django.setup()

from mim.services import MIMService

if __name__ == '__main__':
    print('Initializing Neo4j schema...')
    try:
        mim_service = MIMService()
        mim_service.init_schema()
        print('Neo4j schema initialized successfully!')
    except Exception as e:
        print(f'Error: {e}')
