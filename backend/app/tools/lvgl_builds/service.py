"""Resolve and freeze trusted inputs before an LVGL build is queued."""

from __future__ import annotations

import copy
import hashlib
import json
import os
from typing import Any

from ..lvgl_assets import store as asset_store
from ..lvgl_catalog import db as catalog_db
from ..lvgl_projects import db as project_db
from ..lvgl_projects.validation import (
    ProjectDocumentValidationError,
    validate_project_document,
)
from . import db as build_db
from .capability import FirmwareCapabilityError, canonical_firmware_capability, capability_sha256


GENERATOR_VERSION = os.environ.get("LVGL_GENERATOR_VERSION", "@lvd/codegen@0.1.0")
LVGL_COMMIT = os.environ.get(
    "LVGL_95_COMMIT",
    "85aa60d18b3d5e5588d7b247abf90198f07c8a63",
)
ESP_IDF_VERSION = os.environ.get("LVGL_ESP_IDF_VERSION", "5.4.4")
ESP_IDF_COMMIT = os.environ.get(
    "LVGL_ESP_IDF_COMMIT",
    "296b6eab9445fd720e71aecab961e2d3fbca9944",
)


def _content_sha(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class BuildInputError(ValueError):
    def __init__(self, code: str, message: str, reference: str | None = None):
        super().__init__(message)
        self.code = code
        self.reference = reference


def _required_profile(owner_user_id: int, reference: str) -> dict[str, Any]:
    record = catalog_db.get_reference(owner_user_id, reference)
    if record is None:
        raise BuildInputError("profile-revision-not-found", f"profile revision not found: {reference}", reference)
    return record


def _resolve_standalone_theme(
    owner_user_id: int,
    reference: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve and flatten an immutable standalone Theme inheritance chain."""

    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    current = reference
    while current:
        if current in seen:
            raise BuildInputError("theme-inheritance-cycle", f"standalone Theme inheritance cycle: {current}", current)
        seen.add(current)
        record = catalog_db.get_reference(owner_user_id, current)
        if record is None or record.get("kind") != "lvgl-theme":
            raise BuildInputError("theme-revision-not-found", f"Theme revision not found: {current}", current)
        chain.append(record)
        current = str(record["doc"].get("extends", ""))

    tokens: dict[str, dict[str, Any]] = {}
    for record in reversed(chain):
        for token in record["doc"].get("tokens", []):
            tokens[token["id"]] = copy.deepcopy(token)
    selected = chain[0]
    selected_doc = selected["doc"]
    flattened = {
        "id": selected_doc["id"],
        **({"displayName": selected_doc["displayName"]} if selected_doc.get("displayName") else {}),
        "tokens": list(tokens.values()),
    }
    return selected, flattened


def resolve_build_input(
    owner_user_id: int,
    target_id: str,
    target_revision: int,
) -> dict[str, Any]:
    target_record = catalog_db.get_revision(
        owner_user_id, "lvgl-build-target", target_id, target_revision,
    )
    if target_record is None:
        raise BuildInputError(
            "build-target-revision-not-found",
            f"build target revision not found: {target_id}@{target_revision}",
            f"{target_id}@{target_revision}",
        )
    target = target_record["doc"]
    if target["lvglVersion"] != "9.5.0":
        raise BuildInputError("unsupported-lvgl-version", "formal builds require LVGL 9.5.0")
    firmware_ref = target.get("firmwareProfileRef")
    if not firmware_ref:
        raise BuildInputError("firmware-profile-required", "formal builds must lock a FirmwareProfile revision")

    theme_ref = target["themeRef"]
    standalone_theme = theme_ref.startswith("theme:")
    ui_input = project_db.resolve_ui_build_input(
        owner_user_id, target["uiProjectRef"], None if standalone_theme else theme_ref,
    )
    if ui_input is None:
        raise BuildInputError(
            "ui-revision-not-found",
            f"UiProject/Theme revision not found: {target['uiProjectRef']}",
            target["uiProjectRef"],
        )
    if ui_input["colorFormatConfirmed"] is not True:
        raise BuildInputError(
            "color-format-not-confirmed",
            "formal builds require an explicitly confirmed DisplayProfile color format",
        )

    theme_record = None
    if standalone_theme:
        theme_record, resolved_theme = _resolve_standalone_theme(owner_user_id, theme_ref)
        ui_input = copy.deepcopy(ui_input)
        selected_id = resolved_theme["id"]
        ui_input["uiProject"]["themes"] = [
            resolved_theme,
            *[
                theme for theme in ui_input["uiProject"].get("themes", [])
                if isinstance(theme, dict) and theme.get("id") != selected_id
            ],
        ]

    controller_record = _required_profile(owner_user_id, target["controllerProfileRef"])
    controller = controller_record["doc"]
    display_record = _required_profile(owner_user_id, controller["displayRef"])
    display = display_record["doc"]
    firmware_record = _required_profile(owner_user_id, firmware_ref)
    firmware = firmware_record["doc"]
    try:
        firmware_capability = canonical_firmware_capability(firmware, target["lvglVersion"])
    except FirmwareCapabilityError as exc:
        raise BuildInputError(exc.code, str(exc), firmware_ref) from exc
    input_record = None
    if controller.get("inputProfileRef"):
        input_record = _required_profile(owner_user_id, controller["inputProfileRef"])

    ui = ui_input["uiProject"]
    if ui.get("designDisplayRef") != controller.get("displayRef"):
        raise BuildInputError(
            "build-target-display-mismatch",
            "UiProject and ControllerProfile must resolve to the same DisplayProfile revision",
        )

    try:
        asset_locks = asset_store.lock_project_assets(owner_user_id, ui)
    except asset_store.AssetStoreError as exc:
        raise BuildInputError(exc.code, str(exc), exc.reference) from exc

    snapshot = {
        "kind": "lvgl-project-snapshot",
        "snapshotVersion": 1,
        "uiProject": ui,
        "displayProfile": display,
        "controllerProfile": controller,
        "buildTarget": target,
        "actionRegistry": ui_input["actionRegistry"],
        "migrationNotes": ui_input["migrationNotes"],
        "colorFormatConfirmed": True,
    }
    try:
        validate_project_document(snapshot)
    except ProjectDocumentValidationError as exc:
        raise BuildInputError("build-input-validation", str(exc)) from exc

    profiles = {
        "display": display_record,
        "controller": controller_record,
        "firmware": firmware_record,
        "input": input_record,
        "theme": theme_record,
    }
    return {
        "formatVersion": 1,
        "generator": {
            "version": GENERATOR_VERSION,
            "lvglVersion": "9.5.0",
            "lvglCommit": LVGL_COMMIT,
            "espIdfVersion": ESP_IDF_VERSION,
            "espIdfCommit": ESP_IDF_COMMIT,
            "uiAbiVersion": firmware_capability["uiAbiVersion"],
        },
        "firmwareCapability": firmware_capability,
        "firmwareCapabilitySha256": capability_sha256(firmware_capability),
        "uiProject": ui,
        "uiProjectSha256": _content_sha(ui),
        "actionRegistry": ui_input["actionRegistry"],
        "actionRegistrySha256": _content_sha(ui_input["actionRegistry"]),
        "assets": asset_locks,
        "buildTarget": target,
        "profiles": {
            name: None if record is None else {
                "ref": f"{record['id']}@{record['revision']}",
                "sha256": record["sha256"],
                "doc": record["doc"],
            }
            for name, record in profiles.items()
        },
    }


def queue_build(
    owner_user_id: int,
    created_by: int,
    target_id: str,
    target_revision: int,
) -> dict[str, Any]:
    input_lock = resolve_build_input(owner_user_id, target_id, target_revision)
    return build_db.create_build(
        owner_user_id, created_by, target_id, target_revision, input_lock,
    )
