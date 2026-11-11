#!/usr/bin/env python3
"""Validate the repository shape without requiring external dependencies."""

from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SKILLS = (
    "loopit-tracking-plan",
    "loopit-tracking-implementation",
    "loopit-tracking-acceptance",
)


def main() -> None:
    assert (ROOT / "README.md").is_file()
    assert (ROOT / "LICENSE").is_file()
    assert (ROOT / "skills").is_dir()
    assert (ROOT / "tests").is_dir()

    for skill_name in SKILLS:
        skill_dir = ROOT / "skills" / skill_name
        skill_file = skill_dir / "SKILL.md"
        references = skill_dir / "references"
        assert skill_file.is_file(), skill_file
        assert references.is_dir(), references
        text = skill_file.read_text(encoding="utf-8")
        assert text.startswith("---\n"), skill_file
        assert f"name: {skill_name}\n" in text, skill_file
        assert "description:" in text, skill_file

        # A single installed skill must retain every linked local resource.
        for document in skill_dir.rglob("*.md"):
            for target in re.findall(r"\]\(([^\s)]+)\)", document.read_text(encoding="utf-8")):
                link = urlsplit(target)
                if link.scheme or link.netloc or not link.path:
                    continue
                resource = (document.parent / unquote(link.path)).resolve()
                assert resource.is_relative_to(skill_dir.resolve()), (document, target)
                assert resource.exists(), (document, target)

    plan_refs = ROOT / "skills" / "loopit-tracking-plan" / "references"
    assert (plan_refs / "output-format.md").is_file()
    assert (ROOT / "skills" / "loopit-tracking-implementation" / "references" / "implementation-checklist.md").is_file()
    assert (ROOT / "skills" / "loopit-tracking-acceptance" / "references" / "acceptance-matrix.md").is_file()
    print(f"validated {len(SKILLS)} skills")


if __name__ == "__main__":
    main()
