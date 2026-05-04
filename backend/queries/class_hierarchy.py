# Backward-compat shim: this module has moved to queries/services/class_hierarchy.py
from queries.services.class_hierarchy import *  # noqa: F401,F403
from queries.services.class_hierarchy import build_rn, get_key_attribute, can_build_dn_from_filter, get_rn_format  # noqa: F401
