#!/usr/bin/env python3
"""Validate the repository shape without requiring external dependencies."""

from pathlib import Path


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

    plan_refs = ROOT / "skills" / "loopit-tracking-plan" / "references"
    assert (plan_refs / "output-format.md").is_file()
    assert (ROOT / "skills" / "loopit-tracking-implementation" / "references" / "implementation-checklist.md").is_file()
    assert (ROOT / "skills" / "loopit-tracking-acceptance" / "references" / "acceptance-matrix.md").is_file()
    print(f"validated {len(SKILLS)} skills")


if __name__ == "__main__":
    main()
