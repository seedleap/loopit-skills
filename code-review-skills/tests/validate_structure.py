#!/usr/bin/env python3
"""检查公开分发内容、案例与可复现示例；不判断业务审查结论。"""
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[1]
skill = root / 'skills/review-report'
sys.path.insert(0, str(skill / 'scripts'))
import render_compact_report as compact

# 来源与私有上下文留仓外；这里只接受不含个人目录/会话身份的公开内容。
private = re.compile(r'/Users/|/home/[^/\s]+/|[A-Za-z]:\\Users\\|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)
for file in sorted(root.rglob('*')):
    if not file.is_file() or file.suffix.lower() in {'.jpg', '.png', '.pyc'} or file == Path(__file__).resolve():
        continue
    text = file.read_text()
    assert not private.search(text), f'个人路径或会话身份：{file.relative_to(root)}'
    assert not file.is_symlink(), f'不允许 symlink：{file}'

memory = (skill / 'memory.md').read_text()
assert re.findall(r'<a id="(rr\d+)"', memory) == [f'rr{i:02}' for i in range(1, 22)], '21条案例身份缺失或乱序'
assert 'allow_implicit_invocation: true' in (skill / 'agents/openai.yaml').read_text()
for filename in ('SKILL.md', 'references/acceptance.md', 'references/report-data.md'):
    text = (skill / filename).read_text()
    assert '当次指令或当前项目合同' in text or '当次指令或当前项目合同授权' in text, f'授权前提缺失：{filename}'
    assert '模拟器可直接验证' not in text and '可直接使用空闲' not in text, f'残留个人授权：{filename}'

example = root / 'examples/coupon-preview'
snapshot = json.loads((example / 'snapshot.json').read_text())
review = json.loads((example / 'review.json').read_text())
compact.rr.validate_snapshot(snapshot)
compact.rr.validate_review(snapshot, review, False)
compact.validate_risks(snapshot, review)
assert snapshot['repo'] == '/example/quote-demo'
assert (example / 'report.html').read_text() == compact.build(snapshot, review), '示例未由当前生成器/输入生成'
for image in ('01-human.jpg', '02-evidence.jpg', '03-full-review.jpg'):
    data = (root / 'docs/images' / image).read_bytes()
    assert data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9'), f'无效JPEG：{image}'
print('validated review-report: portable resources, 21 cases, authorization boundaries and rendered example')
