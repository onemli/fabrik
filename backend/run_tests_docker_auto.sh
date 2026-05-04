#!/bin/bash
# Automatic backend container finder and test runner

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🐳 FABRIK Backend Tests (Docker Auto)${NC}"
echo "=============================="
echo ""

# Find backend container automatically
echo -e "${YELLOW}🔍 Searching for backend container...${NC}"

# Try multiple methods to find the container
CONTAINER=$(docker ps --format "{{.Names}}" | grep -i backend | head -1)

if [ -z "$CONTAINER" ]; then
    # Try by image name
    CONTAINER=$(docker ps --filter "ancestor=fabrik-backend" --format "{{.Names}}" | head -1)
fi

if [ -z "$CONTAINER" ]; then
    # Last resort: any container with 'backend' in name
    CONTAINER=$(docker ps | grep -i backend | awk '{print $NF}' | head -1)
fi

if [ -z "$CONTAINER" ]; then
    echo -e "${RED}❌ No backend container found!${NC}"
    echo ""
    echo "Running containers:"
    docker ps
    echo ""
    echo "Start the backend container first:"
    echo "  docker compose up -d backend"
    exit 1
fi

echo -e "${GREEN}✓ Found container: ${CONTAINER}${NC}"
echo ""

# Run tests
echo -e "${YELLOW}🧪 Running tests...${NC}"
echo ""

docker exec -w /app "$CONTAINER" pytest -v --tb=short "$@"

EXIT_CODE=$?

echo ""
echo "=============================="

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed${NC}"
fi

exit $EXIT_CODE
