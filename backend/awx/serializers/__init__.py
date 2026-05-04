# awx/serializers/__init__.py
#
# Re-exports every serializer so existing `from awx.serializers import X`
# statements keep working after the split into per-domain modules.

from .common import UserSerializer, _normalize_input_data  # noqa: F401

from .connection import (  # noqa: F401
    AWXConnectionListSerializer,
    AWXConnectionDetailSerializer,
    AWXConnectionCreateSerializer,
)

from .template import (  # noqa: F401
    TemplateCategorySerializer,
    AutomationTemplateListSerializer,
    AutomationTemplateDetailSerializer,
    AutomationTemplateCreateSerializer,
)

from .request import (  # noqa: F401
    AutomationRequestListSerializer,
    AutomationRequestDetailSerializer,
    AutomationRequestCreateSerializer,
)

from .execution import (  # noqa: F401
    AutomationExecutionListSerializer,
    AutomationExecutionDetailSerializer,
    AutomationExecutionSerializer,
)

from .column_template import ColumnTemplateSerializer  # noqa: F401

from .validation import (  # noqa: F401
    ValidationListSerializer,
    ValidationListCreateSerializer,
    ValidationUsageSerializer,
    RegexPatternSerializer,
    RegexPatternCreateSerializer,
)
