"""Execute a locked target Python script with path semantics normalized across hosts."""

from __future__ import annotations

import pathlib
import runpy
import sys


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("target script path is required")
    module_mode = sys.argv[1] == "--module"
    if module_mode and len(sys.argv) < 3:
        raise SystemExit("target module name is required")
    target_index = 2 if module_mode else 1
    script, args = sys.argv[target_index], sys.argv[target_index + 1:]
    if sys.platform == "win32":
        original = pathlib.WindowsPath.relative_to

        def relative_to_posix(self, *other, **kwargs):
            result = original(self, *other, **kwargs)
            return pathlib.PurePosixPath(*result.parts)

        pathlib.WindowsPath.relative_to = relative_to_posix
    sys.argv = [script, *args]
    if module_mode:
        runpy.run_module(script, run_name="__main__", alter_sys=True)
    else:
        runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
