#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
from pathlib import Path


def macho(path: Path) -> bool:
    if not path.is_file() or path.is_symlink():
        return False
    result = subprocess.run(
        ["file", "-b", str(path)], capture_output=True, text=True, check=False
    )
    return "Mach-O" in result.stdout


def install_id(path: Path) -> str | None:
    result = subprocess.run(
        ["otool", "-D", str(path)], capture_output=True, text=True, check=False
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines[1] if len(lines) > 1 else None


def dependencies(path: Path) -> list[str]:
    result = subprocess.run(
        ["otool", "-L", str(path)], capture_output=True, text=True, check=True
    )
    identifier = install_id(path)
    values = []
    for line in result.stdout.splitlines()[1:]:
        value = line.strip().split(" (", 1)[0]
        if value and value != identifier:
            values.append(value)
    return values


def is_system(path: str) -> bool:
    return path.startswith(("/usr/lib/", "/System/"))


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: bundle-postgres.py SRC DST")
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    deps_dir = dst / "lib" / "deps"

    shutil.rmtree(dst, ignore_errors=True)
    for name in ("bin", "lib"):
        shutil.copytree(src / name, dst / name, symlinks=True)
    target_share = dst / "share"
    target_share.mkdir(parents=True)
    for item in (src / "share").iterdir():
        if item.name.startswith("postgresql"):
            shutil.copytree(item, target_share / item.name, symlinks=True)
    deps_dir.mkdir(parents=True, exist_ok=True)

    roots = [p for p in (dst / "bin").rglob("*") if macho(p)]
    roots += [p for p in (dst / "lib").rglob("*") if macho(p)]

    mapping: dict[str, Path] = {}
    sources: dict[Path, Path] = {path: path for path in roots}
    queue = list(roots)
    seen: set[Path] = set()
    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)
        source_root = sources[current]
        for dep in dependencies(current):
            if is_system(dep):
                continue
            if dep.startswith("@loader_path/"):
                source = source_root.parent / dep.removeprefix("@loader_path/")
            elif dep.startswith("@"):
                continue
            else:
                source = Path(dep)
            if not source.exists():
                raise SystemExit(f"missing dependency {dep} for {current}")
            key = dep if not dep.startswith("@") else f"{current.parent}:{dep}"
            if key in mapping:
                continue
            name = source.name
            target = deps_dir / name
            if target.exists():
                name = f"{source.parent.name}-{name}"
                target = deps_dir / name
            shutil.copy2(source, target, follow_symlinks=True)
            mapping[key] = target
            sources[target] = source
            queue.append(target)

    macho_files = [p for p in (dst / "bin").rglob("*") if macho(p)]
    macho_files += [p for p in (dst / "lib").rglob("*") if macho(p)]

    for path in macho_files:
        directory = path.parent
        relative = os.path.relpath(deps_dir, directory)
        for dep in dependencies(path):
            if dep.startswith("@loader_path/"):
                key = f"{path.parent}:{dep}"
            else:
                key = dep
            target = mapping.get(key)
            if target is None:
                continue
            prefix = "@loader_path" if relative == "." else f"@loader_path/{relative}"
            subprocess.run(
                [
                    "install_name_tool",
                    "-change",
                    dep,
                    f"{prefix}/{target.name}",
                    str(path),
                ],
                check=True,
                capture_output=True,
            )
        if directory == deps_dir:
            subprocess.run(
                [
                    "install_name_tool",
                    "-id",
                    f"@loader_path/{path.name}",
                    str(path),
                ],
                check=False,
                capture_output=True,
            )
        subprocess.run(
            ["codesign", "--force", "--sign", "-", str(path)],
            check=True,
            capture_output=True,
        )

    print(f"bundled PostgreSQL into {dst}")


if __name__ == "__main__":
    main()
