"""观察力Agent 专用数据入口：冻结已读取的 patch，严格验证后生成正式 H5。"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import collect_diff as collector


def write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def prepare(directory):
    data = json.loads((directory / 'input.json').read_text())
    diff = data['diff']
    identity = diff['identity']
    files = []
    for source in diff['files']:
        fid = f'F{len(files) + 1:03d}'
        hunks = collector.parse_hunks(source['patch'], fid)
        bucket, basis = collector.bucket(source['path'])
        if bucket == '测试':
            raise ValueError('测试源码不能进入观察力Agent的业务审查快照')
        binary = source['binary']
        status = source['status']
        files.append(dict(id=fid, path=source['path'], old_path=source.get('previous'),
                          status='binary' if binary else 'renamed' if status.startswith('R') else 'added' if status in ('?', 'A') else 'deleted' if status == 'D' else 'mode-only' if not hunks else 'modified',
                          bucket=bucket, category_basis=basis,
                          before_lines=None, after_lines=None, binary=binary, patch=source['patch'], hunks=hunks,
                          added=None if binary else sum(line.startswith('+') for h in hunks for line in h['lines']),
                          removed=None if binary else sum(line.startswith('-') for h in hunks for line in h['lines'])))
    # 未读取的整文件行数明确为未知，不能用 hunk 行数冒充总行数。
    snapshot = dict(version=1, repo=data['repo'], branch=diff.get('branch', '(detached HEAD)'),
                    head=identity['head'], base=identity['base'], target=identity['target'],
                    scope=diff['scope'], files=files)
    snapshot['fingerprint'] = collector.fingerprint(snapshot)
    snapshot['captured_at'] = datetime.now(timezone.utc).isoformat()
    write(directory / 'snapshot.json', snapshot)
    write(directory / 'review-template.json', collector.review_form(snapshot))
    write(directory / 'test-change-stats.json', data['tests'])


def publish(directory):
    # 正式生成器同时检查文件/hunk全量覆盖、人工评分、关系和指纹，不降级为草稿。
    command = [sys.executable, str(Path(__file__).with_name('render_compact_report.py')),
               '--snapshot', str(directory / 'snapshot.json'), '--review', str(directory / 'pending-review.json'),
               '--output', str(directory / '审查报告.html')]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip())
    (directory / 'pending-review.json').replace(directory / 'review.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'publish'])
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    try:
        globals()[args.action](Path(args.directory).resolve())
    except (ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
