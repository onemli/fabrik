# Backward-compat shim: this module has moved to queries/services/optimizer.py
# This file is kept for backward compatibility and will be removed in a future cleanup.
from queries.services.optimizer import *  # noqa: F401,F403
from queries.services.optimizer import QueryIntent, QueryExecutor  # noqa: F401
