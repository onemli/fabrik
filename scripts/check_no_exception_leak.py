#!/usr/bin/env python3
"""Fail if a DRF view formats an exception object into the response body.

Pattern this catches:

    return Response({'error': str(e)}, ...)
    return Response({'error': f'Failed: {str(e)}'}, ...)
    return Response({'error': f'... {e}'}, ...)
    return Response({'error': f'... {exc}'}, ...)

The right thing to do is one of:

  - Let the exception propagate so fabrik.exception_handler shapes the
    response and logs the trace.
  - Read a specific attribute (e.args[0], e.msg, e.user_message, ...)
    when the exception's message is intentionally curated for the
    client.

Run on a list of files; intended for use as a pre-commit local hook.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PATTERN = re.compile(
    r"Response\([^)]*['\"]error['\"]:\s*"
    r"(?:f?['\"][^'\"]*\{(?:str\()?(?:e|exc)\)?\}|str\((?:e|exc)\))"
)


def main(paths: list[str]) -> int:
    findings: list[str] = []
    for path in paths:
        try:
            source = Path(path).read_text(encoding='utf-8')
        except OSError:
            continue
        for match in PATTERN.finditer(source):
            line_no = source[: match.start()].count('\n') + 1
            findings.append(f'{path}:{line_no}: {match.group(0)}')

    if not findings:
        return 0

    print('Anti-pattern detected — Response body would expose an exception string:')
    print()
    for line in findings:
        print(f'  {line}')
    print()
    print('Let fabrik.exception_handler shape the response, or read a specific')
    print('attribute (e.args[0], e.msg, ...) instead of formatting str(e) yourself.')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
