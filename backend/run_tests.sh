#!/bin/bash
# Backend Test Runner Script

set -e

echo "🧪 FABRIK Backend Test Suite"
echo "=============================="
echo ""

# Colors
GREEN='\033[0.32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo -e "${RED}❌ pytest not found. Installing test dependencies...${NC}"
    pip install -r requirements.txt -r requirements_test.txt
fi

echo -e "${YELLOW}Running tests...${NC}"
echo ""

# Run tests with coverage
pytest -v --cov --cov-report=term-missing --cov-report=html \
    --tb=short \
    -m "not slow" \
    "$@"

EXIT_CODE=$?

echo ""
echo "=============================="

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo -e "${GREEN}📊 Coverage report: htmlcov/index.html${NC}"
else
    echo -e "${RED}❌ Some tests failed${NC}"
fi

exit $EXIT_CODE
