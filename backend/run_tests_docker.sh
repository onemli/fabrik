#!/bin/bash
# Backend Test Runner for Docker
# Usage: ./run_tests_docker.sh [pytest args]

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 FABRIK Backend Tests (Docker)${NC}"
echo "=============================="
echo ""

# Check if backend container is running
if ! docker ps | grep -q fabrik-backend; then
    echo -e "${RED}❌ Backend container is not running!${NC}"
    echo ""
    echo "Start the containers first:"
    echo "  docker compose up -d"
    echo ""
    exit 1
fi

echo -e "${YELLOW}Running tests in Docker container...${NC}"
echo ""

# Run pytest in Docker container (from /app directory)
docker exec -w /app fabrik-backend pytest -v --tb=short "$@"

EXIT_CODE=$?

echo ""
echo "=============================="

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed${NC}"
fi

exit $EXIT_CODE
