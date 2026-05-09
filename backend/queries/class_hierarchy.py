# Backward-compat shim: this module has moved to queries/services/class_hierarchy.py
from queries.services.class_hierarchy import *  # noqa: F401,F403
from queries.services.class_hierarchy import (
    build_rn,  # noqa: F401
    get_key_attribute,  # noqa: F401
    can_build_dn_from_filter,  # noqa: F401
    get_rn_format,  # noqa: F401
)
