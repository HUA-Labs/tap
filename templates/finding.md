# Finding: {TITLE}

**Date**: {YYYYMMDD}
**Agent**: {AGENT_NAME}
**Type**: {bug | improve | vuln | idea}
**Severity**: {low | medium | high | critical}  (for bug/vuln)
**Mission**: {MISSION_ID} — {MISSION_TITLE}

---

## Summary

{One or two sentences describing the discovery.}

## Location

```
File: {path/to/file.ts}
Line: {N}
```

## Details

{Full description of the issue or opportunity. Include relevant code snippets if applicable.}

## Suggested Fix / Action

{What should be done about this. If a bug/vuln, describe the correct behavior.
If improve/idea, describe the benefit.}

## Why Not Fixed Directly

This finding is outside the scope of mission {MISSION_ID} (`{SCOPE}`).
Fixing it directly would violate scope isolation. Assigning to control tower for routing.

---

*Filed by tap agent {AGENT_NAME} via `{COMMS_DIR}/findings/`*
