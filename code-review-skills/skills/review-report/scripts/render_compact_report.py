#!/usr/bin/env python3
"""按人工评分渲染紧凑报告；复用原始快照校验与完整 diff，不自动判断语义风险。"""
from __future__ import annotations

import argparse
import base64
import binascii
import copy
import hashlib
import json
from pathlib import Path
import re
from html.parser import HTMLParser

import render_report as rr
import change_relations

ROOT = Path(__file__).resolve().parent.parent
LEGACY_HUNK = rr.render_hunk
WEIGHTS = [25, 20, 20, 15, 10, 10]


def safe_fragment(source):
    """证据只接受静态内容与内嵌栅格图，不产生自动网络请求。"""
    class Fragment(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.output = []
            self.open_tags = []

        def handle_starttag(self, tag, attrs):
            if tag not in {'p','ul','ol','li','a','strong','em','code','pre','span','article','h3','h4','details','summary','br','figure','figcaption','img'}:
                return
            attrs = dict(attrs)
            if tag == 'img':
                src = attrs.get('src') or ''
                match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})', src)
                if not match:
                    return
                try:
                    raw = base64.b64decode(match[2], validate=True)
                except (ValueError, binascii.Error):
                    return
                if not (raw.startswith(b'\x89PNG\r\n\x1a\n') if match[1] == 'png'
                        else raw.startswith(b'\xff\xd8\xff') and raw.endswith(b'\xff\xd9')):
                    return
            allowed = []
            for key, value in attrs.items():
                if key in {'class','id'} and value and re.fullmatch(r'[\w\s-]+', value):
                    allowed.append(f'{key}="{rr.esc(value)}"')
                elif tag == 'a' and key == 'href' and value and (value.startswith('#') or value.startswith('https://')):
                    allowed.append(f'href="{rr.esc(value)}"')
                    if value.startswith('#'):
                        allowed.append('data-open-target')
                elif tag == 'img' and key in {'src', 'alt', 'title'} and value:
                    allowed.append(f'{key}="{rr.esc(value)}"')
            self.output.append('<' + tag + (' ' + ' '.join(allowed) if allowed else '') + '>')
            if tag not in {'br', 'img'}:
                self.open_tags.append(tag)

        def handle_endtag(self, tag):
            if tag in self.open_tags:
                while self.open_tags:
                    opened = self.open_tags.pop()
                    self.output.append(f'</{opened}>')
                    if opened == tag:
                        break

        def handle_data(self, text):
            self.output.append(rr.esc(text))

    fragment = Fragment()
    fragment.feed(source)
    while fragment.open_tags:
        fragment.output.append(f'</{fragment.open_tags.pop()}>')
    return ''.join(fragment.output)


def inline_evidence(issue):
    """可选证据须在当前与历史问题上遵守同一输入和清洗规则。"""
    if 'inline_evidence_html' not in issue:
        return ''
    source = issue['inline_evidence_html']
    if not isinstance(source, str) or not source.strip():
        raise rr.ReportError(f'{issue["id"]}: inline_evidence_html 必须为非空字符串')
    return safe_fragment(source)


def priority(detail):
    """未知评分优先补证；区间按上界排序，绝不默认零风险。"""
    risk = detail.get('risk_assessment', {})
    return risk.get('score') if risk.get('score') is not None else risk.get('score_range', [0, 100])[1]


def badges(detail):
    risk = detail.get('risk_assessment', {})
    score = risk.get('score')
    value = str(score) if score is not None else '–'.join(map(str, risk.get('score_range', [0, 100])))
    high = priority(detail)
    band, label = next((band, label) for limit, band, label in [(25, 'low', '低'), (50, 'medium', '中'), (75, 'high', '高'), (101, 'very-high', '很高')] if high < limit)
    label = label if score is not None else '待补证'
    scope = detail.get('scope_assessment', {}).get('classification', '范围待确认')
    output = f'<span class="scope-badge">{rr.esc(scope)}</span><span class="risk-badge risk-{band}">危险系数 {value}/100 · {label}</span>'
    for chain in detail.get('critical_chains', []):
        output += f'<span class="critical-alert">‼️ 改动{rr.esc(chain)}关键链路，仔细审查</span>'
    flags = list(detail.get('review_flags', []))
    if detail.get('necessity') == '冗余':
        flags.append('冗余')
    if detail.get('necessity') == '过度改动':
        flags.append('额外重构扩大范围')
    return output + ''.join(f'<span class="scope-warning">{rr.esc(flag)}</span>' for flag in dict.fromkeys(flags))


def rationale(detail):
    """展示可追溯的评分理由，数字不冒充经校准的缺陷概率。"""
    risk = detail.get('risk_assessment', {})
    scope = detail.get('scope_assessment', {})
    rows = [[d['name'], str(d['weight']), str(d.get('rating', '未知')), d['reason'], d['source']] for d in risk.get('dimensions', [])]
    return (f'<p class="risk-reason">{rr.esc(risk.get("reason", "评分依据待补充"))}</p>'
            + f'<details class="risk-detail"><summary>评分依据与影响范围</summary><p>{rr.esc(scope.get("reason", "作用域待核对"))}</p>'
            + (rr.render_table('六维评分', ['维度', '权重', '等级 0–4', '本项依据', '证据'], rows) if rows else '<p>六维证据待补充</p>')
            + f'<p>模型 {rr.esc(risk.get("model_version", "待补充"))}；置信度：{rr.esc(risk.get("confidence", "待确认"))}。{rr.esc(risk.get("floor_reason", "无额外升级下限"))}。{rr.esc(risk.get("aggregation", ""))}</p></details>')


def render_hunk(hunk, detail, index, draft):
    output = LEGACY_HUNK(hunk, detail, index, draft)
    added = sum(line.startswith('+') for line in hunk['lines'])
    removed = sum(line.startswith('-') for line in hunk['lines'])
    # 50行是此展示版本的启发式提醒，不是行业门槛或用户指定阈值。
    large = added + removed >= 50 or detail.get('large_change', False)
    extra = f'<span class="delta">+{added} / −{removed} 行</span>' + ('<span class="scope-warning">⚠️ 大段改动</span>' if large else '')
    output = output.replace('</summary>', f'<span class="title-badges">{extra}{badges(detail)}</span></summary>{rationale(detail)}', 1)
    if detail.get('critical_chains'):
        output = output.replace('class="hunk-title"', 'class="hunk-title critical-title"', 1)
    return output


rr.render_hunk = render_hunk


def render_file(item, detail, review, snapshot, expanded=False):
    """仅对展示副本重排块；原始 patch 的复制下载保持字节一致。"""
    displayed = copy.deepcopy(item)
    ordered = sorted(item['hunks'], key=lambda h: -priority(detail['hunks'][h['id']]))
    metadata = ['\n'.join(lines) for header, lines in rr.split_patch(item['patch']) if header is None]
    displayed['hunks'] = ordered
    displayed['patch'] = '\n'.join(metadata + [h['header'] + '\n' + '\n'.join(h['lines']) for h in ordered]) + ('\n' if item['patch'].endswith('\n') else '')
    output = rr.render_file(displayed, detail, review['issues'], False, snapshot)
    link = rr.file_path_link(displayed, snapshot)
    labelled = re.sub(r'>([^<]+)</a>$', lambda m: f'><span class="file-name">{rr.esc(Path(item["path"]).name)}</span><span class="full-path">{m[1]}</span></a>', link)
    labelled = labelled.replace('class="file-path"', f'class="file-path" title="{rr.esc(item["path"])}"', 1)
    output = output.replace(link, labelled, 1)
    raw = lambda text: base64.b64encode(text.encode()).decode()
    output = output.replace('data-patch-base64="' + raw(displayed['patch']) + '"', 'data-patch-base64="' + raw(item['patch']) + '"')
    output = output.replace('class="file-metrics">', 'class="file-metrics">' + badges(detail), 1)
    output = output.replace('<div class="file-content">', '<div class="file-content">' + rationale(detail), 1)
    if detail.get('critical_chains'):
        output = output.replace('class="file-path"', 'class="file-path critical-title"', 1)
    if expanded:
        output = re.sub(r'<details class="(?:file-review|hunk-review)"[^>]*>',
                        lambda match: match[0] if re.search(r'\sopen(?:\s|>)', match[0])
                        else match[0][:-1] + ' open>', output)
    return output


def namespace(markup, key):
    """组合多个冻结范围时隔离 ID，并同步问题/证据锚点。"""
    markup = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{key}-{m[1]}"', markup)
    return re.sub(r'href="#([^"]+)"', lambda m: f'href="#{key}-{m[1]}"', markup)


def render_scope(snapshot, review, key, inline_open=False):
    output = []
    for name, title in [('业务', '业务代码'), ('辅助', '配置、文档与其他辅助文件'), ('测试', '测试 · 紧凑摘要')]:
        files = [f for f in snapshot['files'] if (review['files'][f['id']].get('bucket', f['bucket']) == name if name != '辅助' else review['files'][f['id']].get('bucket', f['bucket']) not in ['业务', '测试'])]
        if not files:
            continue
        files.sort(key=lambda f: -priority(review['files'][f['id']]))
        output.append(f'<div class="file-group"><h3>{title}</h3><p class="group-note">{len(files)} 文件 · 文件及内部代码块均按危险系数降序</p><ol class="file-list">')
        output += [render_file(f, review['files'][f['id']], review, snapshot,
                               expanded=inline_open and name != '测试') for f in files]
        output.append('</ol></div>')
    hidden_titles = ('提交演变', '后续修复', '撤回关系', '先辨清两种差异', '本轮实际验证', '当前HEAD执行结果', '当前 HEAD 执行结果', '审查依据与交付边界', '验证结果与证据边界')
    sections = [s for s in review.get('sections', []) if not any(title in s['title'] for title in hidden_titles)]
    if sections:
        output.append('<details class="semantic-details"><summary>完整语义审查明细</summary>')
        output += [rr.render_table(section['title'], section['headers'], section['rows']) for section in sections]
        output.append('</details>')
    return namespace(''.join(output), key)


def validate_risks(snapshot, review):
    """正式新版拒绝缺评分、错算分或用均值稀释高风险块。"""
    for item in snapshot['files']:
        file = review['files'][item['id']]
        for detail in [file] + list(file['hunks'].values()):
            risk = detail.get('risk_assessment', {})
            rr.require(risk.get('model_version') == 'review-priority-v1', '缺少本版人工评分')
            score = risk.get('score')
            rr.require(score is None or type(score) is int and 0 <= score <= 100, '评分范围不合法')
            rr.require(bool(detail.get('scope_assessment', {}).get('reason')), '缺少作用域判断依据')
            dims = risk.get('dimensions', [])
            rr.require([d['weight'] for d in dims] == WEIGHTS, '六维权重不一致')
            lo = hi = 0
            for dim in dims:
                value = dim.get('rating')
                rr.require(value is None or type(value) is int and 0 <= value <= 4, '评分等级不合法')
                rr.require(bool(dim.get('reason')) and bool(dim.get('source')), '缺少评分理由/来源')
                lo += dim['weight'] * (value or 0) / 4
                hi += dim['weight'] * (4 if value is None else value) / 4
            base = [int(lo + .5), int(hi + .5)]
            floor = risk.get('floor', 0)
            rr.require(type(floor) is int and 0 <= floor <= 100, '升级下限不合法')
            rr.require(not floor or bool(risk.get('floor_reason')), '升级下限缺少依据')
            expected = [max(v, floor) for v in base]
            if detail is file:
                children = list(file['hunks'].values())
                for child in children:
                    child_risk = child['risk_assessment']
                    bounds = [child_risk['score']] * 2 if child_risk.get('score') is not None else child_risk['score_range']
                    expected = [max(a, b) for a, b in zip(expected, bounds)]
            actual = [risk['score']] * 2 if risk.get('score') is not None else risk.get('score_range')
            rr.require(actual == expected, f'{item["path"]}: 风险算分不一致 {actual} != {expected}')


def load_pair(snapshot_path, review_path):
    snapshot = json.loads(Path(snapshot_path).read_text())
    review = json.loads(Path(review_path).read_text())
    rr.validate_snapshot(snapshot)
    rr.validate_review(snapshot, review, False)
    validate_risks(snapshot, review)
    return snapshot, review


def build(snapshot, review, commits=()):
    # 重点层来自完成逐项审查后的人工提炼，不参与过滤或替代全量输入校验。
    focus_html = review.get('focus_review_html')
    if focus_html is not None and (not isinstance(focus_html, str) or not focus_html.strip()):
        raise rr.ReportError('focus_review_html 必须为非空的人工重点说明；旧输入可省略此字段')
    relations = review.get('change_relations')
    source_map = change_relations.sources(snapshot, review, commits)
    if commits or relations is not None:
        change_relations.validate(relations, source_map)
    css = (ROOT/'assets/report.css').read_text() + (ROOT/'assets/compact.css').read_text()
    js = (ROOT/'assets/compact.js').read_text()
    parts = ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">', f'<title>{rr.esc(review["title"])}</title><style>{css}</style></head><body><main>']
    branch = snapshot['branch']
    target = review.get('target_label', snapshot['base'][:9])
    commit_count = f' · {len(commits)} 个 commit' if commits else ''
    parts.append(f'<header class="report-header"><h1>{rr.esc(review["title"])}</h1><p class="compact-overview">{rr.esc(branch)} → {rr.esc(target)}{commit_count} · <span class="addition">+{rr.sum_count(snapshot["files"], "added")}</span> / <span class="deletion">−{rr.sum_count(snapshot["files"], "removed")}</span> 行</p><h2>结论</h2><p>{rr.esc(review["summary"])}</p></header>')
    if focus_html:
        parts.append('<section id="focus-review"><h2>👤 给人看的 · 分支改动、测试关注与行动</h2>' + safe_fragment(focus_html) + '</section>')
    if review['issues']:
        parts.append('<section id="issues"><h2>确认问题 · 优先审查</h2>')
        for issue in sorted(review['issues'], key=lambda i: (i['priority'], int(i['id'][1:]))):
            parts.append(namespace(rr.render_issue(issue, {f['id']: f for f in snapshot['files']}, review['files'],
                                                  inline_evidence(issue)), 'final'))
        if review.get('issue_evidence_html'):
            parts.append(safe_fragment(review['issue_evidence_html']))
        parts.append('</section>')
    if focus_html:
        parts.append('<details id="full-review" class="snapshot-details"><summary>🤖 给 AI 二次复核 · 人工按需查证 · '
                     + str(len(snapshot['files'])) + ' 个文件 / '
                     + str(sum(len(f['hunks']) for f in snapshot['files']))
                     + ' 个代码块 · 完整判断与原始 diff</summary>'
                     + '<p>人工通常不必逐项阅读。AI 请逐块核对需求关联、独立必要性、原行为、消费者、反例与证据，不能只复述已有结论；人工质疑或抽检时查对应材料。</p>')
    parts.append('<nav class="jump-nav">' + ('<a href="#issues">确认问题</a>' if review['issues'] else '') + ''.join(f'<a data-open-target href="#relation-{rr.esc(r["id"])}">{rr.esc(r["id"])} · {rr.esc(r["kind"])} · {rr.esc(r["title"])}</a>' for r in (relations or [])) + '<a href="#final-diff">最终完整 diff</a></nav>')
    parts.append('<details class="snapshot-details"><summary>审查快照身份</summary>' + rr.fields_list([('HEAD', snapshot['head']), ('对比基线', snapshot['base']), ('快照时间', snapshot['captured_at']), ('指纹', snapshot['fingerprint'])]) + rr.render_goal(review['goal']) + '</details>')
    parts.append('<div class="review-toolbar"><button id="expand-all">展开业务与辅助文件</button><button id="collapse-all">收起全部文件</button><label><input id="wrap-code" type="checkbox">代码换行</label><span id="interaction-status" aria-live="polite"></span></div>')
    if relations:
        def historical_issue(issue, scope_snapshot, scope_review, key):
            note = '<p>该阶段的问题以本关系的当前状态为准，不能视作最终仍未修复。</p>'
            return note + namespace(rr.render_issue(issue, {f['id']: f for f in scope_snapshot['files']}, scope_review['files'],
                                                    inline_evidence(issue)), key)
        parts.append(change_relations.render(relations, source_map,
                                            lambda s, r, key: render_scope(s, r, key, inline_open=True), historical_issue,
                                            {i['id']: i for i in review['issues']}))
    if any(commit.get('inventory') for commit in commits):
        parts.append('<details class="snapshot-details"><summary>合并继承文件清单</summary>')
        for commit in commits:
            if commit.get('inventory'):
                parts.append(f'<p>{rr.esc(commit["commit"][:9])}</p><ul>' + ''.join(f'<li>{rr.esc(i["path"])} · {"第二父原样继承" if i["equal_second_parent"] else "双方整合，见对应关系代码"}</li>' for i in commit['inventory']) + '</ul>')
        parts.append('</details>')
    parts.append('<section id="final-diff"><h2>最终完整 diff · 文件与块按危险系数降序</h2>' + render_scope(snapshot, review, 'final') + '</section>')
    parts.append('<details class="risk-method"><summary>危险系数如何计算</summary>' + safe_fragment(review.get('risk_method_html', '<p>六维人工评估，非故障概率。详见 Skill 风险评分规则。</p>')) + '</details>')
    if focus_html:
        parts.append('</details>')
    # 语义映射保留在侧车 review JSON；不重新铺出用户已删除的总述/验证表。
    parts.append(f'<footer>审查快照 {rr.esc(snapshot["head"][:9])} · 评分模型 review-priority-v1 · 单文件离线报告</footer></main><script>{js}</script></body></html>')
    content = '\n'.join(parts)
    digest = lambda value: base64.b64encode(hashlib.sha256(value.encode()).digest()).decode()
    csp = f"default-src 'none'; style-src 'sha256-{digest(css)}'; script-src 'sha256-{digest(js)}'; img-src data:; base-uri 'none'; form-action 'none'"
    return content.replace('<title>', f'<meta http-equiv="Content-Security-Policy" content="{rr.esc(csp)}"><title>', 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--commits', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    snapshot, review = load_pair(args.snapshot, args.review)
    rr.require(not args.output.resolve().is_relative_to(Path(snapshot['repo']).resolve()), '报告输出必须在业务仓库外')
    commits = json.loads(args.commits.read_text()) if args.commits else []
    for commit in commits:
        commit['snapshot_data'], commit['review_data'] = load_pair(args.commits.parent/commit['snapshot'], args.commits.parent/commit['review'])
    args.output.write_text(build(snapshot, review, commits))
    print(f'Generated {args.output}')


if __name__ == '__main__':
    main()
