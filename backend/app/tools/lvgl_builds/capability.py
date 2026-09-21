"""Canonical firmware capability contract shared by builds and IoT consumers."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


CAPABILITY_SCHEMA_VERSION = 1
UI_ABI_VERSION = "1.0.0"
_ABI_PATTERN = re.compile(r"^[1-9][0-9]*\.[0-9]+\.[0-9]+$")


class FirmwareCapabilityError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _stable_strings(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise FirmwareCapabilityError(
            "firmware-capability-required",
            f"FirmwareProfile.{field} must be an array of non-empty stable identifiers",
        )
    return sorted(set(value))


def canonical_firmware_capability(profile: dict[str, Any], lvgl_version: str) -> dict[str, Any]:
    """Return the exact canonical document covered by firmwareCapabilitySha256."""

    abi = profile.get("uiAbiVersion")
    if not isinstance(abi, str) or _ABI_PATTERN.fullmatch(abi) is None:
        raise FirmwareCapabilityError(
            "firmware-capability-required",
            "FirmwareProfile.uiAbiVersion must be a semantic ABI version",
        )
    if abi != UI_ABI_VERSION:
        raise FirmwareCapabilityError(
            "ui-abi-incompatible",
            f"firmware UI ABI {abi} is incompatible with generator UI ABI {UI_ABI_VERSION}",
        )
    revision = profile.get("capabilityRevision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise FirmwareCapabilityError(
            "firmware-capability-required",
            "FirmwareProfile.capabilityRevision must be a positive integer",
        )
    return {
        "schemaVersion": CAPABILITY_SCHEMA_VERSION,
        "uiAbiVersion": abi,
        "capabilityRevision": revision,
        "target": profile.get("target"),
        "lvglVersion": lvgl_version,
        "supportedWidgets": _stable_strings(profile.get("supportedWidgets"), "supportedWidgets"),
        "supportedSubjects": _stable_strings(profile.get("supportedSubjects"), "supportedSubjects"),
        "supportedActions": _stable_strings(profile.get("supportedActions"), "supportedActions"),
    }


def capability_sha256(capability: dict[str, Any]) -> str:
    encoded = json.dumps(capability, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
