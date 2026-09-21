import copy

import pytest
from fastapi import HTTPException

from app.routes.lvgl_projects import _validated_doc
from app.tools.lvgl_projects.validation import (
    ProjectDocumentValidationError,
    validate_project_document,
)


def v1_project():
    return {
        "schemaVersion": 1,
        "meta": {
            "name": "Panel",
            "lvglVersion": "9.4",
            "appVersion": "0.1.0",
            "createdAt": "2026-09-10T00:00:00Z",
            "modifiedAt": "2026-09-10T00:00:00Z",
        },
        "display": {"width": 240, "height": 240, "shape": "round", "colorDepth": 16},
        "screens": [{
            "id": "screen-1",
            "name": "main",
            "isHome": True,
            "styles": [],
            "consts": [],
            "root": {
                "id": "root-1",
                "type": "obj",
                "props": {},
                "styles": [],
                "inlineStyles": [],
                "events": [],
                "bindings": [],
                "children": [],
            },
        }],
        "components": [],
        "styles": [],
        "consts": [],
        "subjects": [],
        "assets": {"fonts": [], "images": []},
        "translations": None,
        "codegen": {"outputDirName": "ui", "exportXml": False, "userIncludes": []},
    }


def v2_project():
    return {
        "schemaVersion": 2,
        "kind": "lvgl-ui-project",
        "meta": {
            "id": "ui:panel",
            "revision": 1,
            "name": "Panel",
            "appVersion": "0.1.0",
            "createdAt": "2026-09-10T00:00:00Z",
            "modifiedAt": "2026-09-10T00:00:00Z",
        },
        "designDisplayRef": "display:240x240-rgb565@1",
        "themes": [{"id": "default", "tokens": []}],
        "subjects": [{
            "id": "subject:level",
            "codeName": "level",
            "type": "int",
            "initial": 0,
            "min": 0,
            "max": 100,
        }],
        "screens": [{
            "id": "screen:main",
            "codeName": "main",
            "isHome": True,
            "styles": [],
            "consts": [],
            "root": {
                "id": "node:root",
                "type": "obj",
                "props": {},
                "styleRefs": [],
                "styles": [],
                "events": [],
                "bindings": [],
                "children": [{
                    "id": "node:slider",
                    "type": "slider",
                    "codeName": "level_slider",
                    "props": {},
                    "styleRefs": [],
                    "styles": [],
                    "events": [{
                        "on": "value_changed",
                        "action": "subject.set",
                        "args": {"subject": "subject:level", "value": "value"},
                    }],
                    "bindings": [{
                        "kind": "prop",
                        "prop": "value",
                        "subject": "subject:level",
                    }],
                    "children": [],
                }],
            },
        }],
        "components": [],
        "styles": [],
        "consts": [],
        "assets": {"fonts": [], "images": [], "icons": []},
        "translations": None,
    }


def project_snapshot():
    return {
        "kind": "lvgl-project-snapshot",
        "snapshotVersion": 1,
        "uiProject": v2_project(),
        "displayProfile": {
            "schemaVersion": 1,
            "kind": "display-profile",
            "id": "display:240x240-rgb565",
            "revision": 1,
            "logicalSize": {"width": 240, "height": 240},
            "shape": "round",
            "colorFormat": "RGB565",
        },
        "controllerProfile": None,
        "buildTarget": {
            "schemaVersion": 1,
            "kind": "lvgl-build-target",
            "id": "target:panel-draft",
            "revision": 1,
            "uiProjectRef": "ui:panel@1",
            "themeRef": "ui:panel@1#theme:default",
            "lvglVersion": "9.5.0",
        },
        "actionRegistry": {},
        "migrationNotes": [],
        "colorFormatConfirmed": True,
    }


def issue_codes(error):
    return {issue["code"] for issue in error.value.issues}


def test_accepts_v2_and_controlled_v1_compatibility_documents():
    assert validate_project_document(v2_project())["schemaVersion"] == 2
    assert validate_project_document(v1_project())["schemaVersion"] == 1
    assert validate_project_document(project_snapshot())["snapshotVersion"] == 1


def test_snapshot_locks_ui_and_display_revisions():
    bad = project_snapshot()
    bad["displayProfile"]["revision"] = 2
    with pytest.raises(ProjectDocumentValidationError) as error:
        validate_project_document(bad)
    assert "display-ref-mismatch" in issue_codes(error)


def test_snapshot_uses_its_action_registry_for_project_callbacks():
    snapshot = project_snapshot()
    child = snapshot["uiProject"]["screens"][0]["root"]["children"][0]
    child["events"] = [{"on": "clicked", "action": "custom.save_settings"}]
    snapshot["actionRegistry"] = {
        "custom.save_settings": {
            "id": "custom.save_settings",
            "params": [{"name": "userData", "type": "string"}],
        },
    }
    assert validate_project_document(snapshot)["kind"] == "lvgl-project-snapshot"


def test_rejects_v2_structural_and_semantic_errors():
    bad = v2_project()
    bad["screens"][0]["root"]["children"][0]["id"] = "node:root"
    bad["screens"][0]["root"]["children"][0]["bindings"][0]["subject"] = "subject:missing"
    bad["screens"][0]["root"]["children"][0]["events"][0]["action"] = "shell.execute"

    with pytest.raises(ProjectDocumentValidationError) as error:
        validate_project_document(bad)

    assert {"duplicate-id", "subject-not-found", "unknown-action"} <= issue_codes(error)


def test_rejects_missing_action_args_and_theme_cycles():
    bad = v2_project()
    bad["screens"][0]["root"]["children"][0]["events"][0]["args"] = {
        "subject": "subject:level",
    }
    bad["themes"] = [
        {"id": "day", "extends": "night", "tokens": []},
        {"id": "night", "extends": "day", "tokens": []},
    ]

    with pytest.raises(ProjectDocumentValidationError) as error:
        validate_project_document(bad)

    assert {"missing-action-arg", "theme-cycle"} <= issue_codes(error)


def test_rejects_untrusted_code_in_both_schema_generations():
    for doc in (v1_project(), v2_project()):
        bad = copy.deepcopy(doc)
        bad["screens"][0]["root"]["cPatch"] = {"post": "system(\"x\");"}
        with pytest.raises(ProjectDocumentValidationError) as error:
            validate_project_document(bad)
        assert "untrusted-code-forbidden" in issue_codes(error)


def test_rejects_unknown_or_incomplete_formats():
    with pytest.raises(ProjectDocumentValidationError) as unknown:
        validate_project_document({"schemaVersion": 3, "kind": "lvgl-ui-project"})
    assert "unsupported-format" in issue_codes(unknown)

    bad = v2_project()
    del bad["screens"]
    with pytest.raises(ProjectDocumentValidationError) as structural:
        validate_project_document(bad)
    assert "schema" in issue_codes(structural)


def test_route_maps_validation_errors_to_actionable_422():
    with pytest.raises(HTTPException) as error:
        _validated_doc({"schemaVersion": 2, "kind": "lvgl-ui-project"})
    assert error.value.status_code == 422
    assert error.value.detail["code"] == "lvgl-project-validation"
    assert error.value.detail["issues"]
