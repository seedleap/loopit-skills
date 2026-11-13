#!/usr/bin/env python3
"""用隔离 Git 仓库和虚构代码生成真实报告；只验证报告能力，不代表业务验收。"""
import argparse
import copy
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

BEFORE = {
    'quote.js': '// 虚构展示报价，不参与真实支付。\nexport function quote(quantity, unitPrice) {\n  return quantity * unitPrice;\n}\n',
    'quote-label.js': 'export function quoteLabel() {\n  return "商品小计";\n}\n',
}
AFTER = {
    'quote.js': '// 虚构展示报价，不参与真实支付。\nexport function quote(quantity, unitPrice, discountPercent = 0) {\n  const subtotal = quantity * unitPrice;\n  return subtotal * (1 - discountPercent);\n}\n',
    'quote-label.js': 'export function quoteLabel() {\n  return "优惠后金额预览";\n}\n',
}


def git(repo, *args):
    # 固定样例身份和时间，让公开示例可复现且不携带本机 Git 配置。
    env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
           'GIT_AUTHOR_DATE': '2026-01-01T00:00:00Z', 'GIT_COMMITTER_DATE': '2026-01-01T00:00:00Z'}
    return subprocess.check_output(['git', '-C', str(repo), *args], env=env, text=True).strip()


def assessment(ratings, reasons):
    weights = [25, 20, 20, 15, 10, 10]
    return dict(model_version='review-priority-v1', score=int(sum(w*r/4 for w, r in zip(weights, ratings))+.5),
                floor=0, reason=reasons[0], confidence='示例范围内代码依据明确，界面运行待验证',
                aggregation='文件分数保留最高块分数', dimensions=[
                    dict(name=name, weight=w, rating=r, reason=reason, source='虚构隔离样例 src/quote*.js')
                    for name, w, r, reason in zip(['业务影响','公共复用','已有功能','复杂度','规模','验证缺口'], weights, ratings, reasons)])


def generate(skill_root, output):
    sys.path.insert(0, str(skill_root / 'scripts'))
    collect = importlib.import_module('collect_diff')
    compact = importlib.import_module('render_compact_report')
    output.mkdir(parents=True, exist_ok=True)
    for name in ('report.html', 'snapshot.json', 'review.json'):
        if (output / name).exists():
            raise ValueError(f'{name} 已存在，请使用新的输出目录')
    with tempfile.TemporaryDirectory(prefix='review-report-example-') as directory:
        repo = Path(directory) / 'repo'
        (repo / 'src').mkdir(parents=True)
        git(repo, 'init', '-b', 'feature/coupon-preview')
        git(repo, 'config', 'user.name', 'Example')
        git(repo, 'config', 'user.email', 'example@example.invalid')
        for name, content in BEFORE.items():
            (repo / 'src' / name).write_text(content)
        git(repo, 'add', 'src')
        git(repo, 'commit', '-m', '示例基线')
        for name, content in AFTER.items():
            (repo / 'src' / name).write_text(content)
        snapshot_file = Path(directory) / 'snapshot.json'
        subprocess.run([sys.executable, str(skill_root / 'scripts/collect_diff.py'), '--repo', str(repo),
                        '--scope', 'worktree', '--output', str(snapshot_file)], check=True, stdout=subprocess.DEVNULL)
        snapshot = json.loads(snapshot_file.read_text())
    # 仅导出副本使用明确的虚构路径；patch、行号和真实 Git 内容身份不变。
    snapshot['repo'] = '/example/quote-demo'
    snapshot['captured_at'] = '2026-11-13T00:00:00+00:00'
    snapshot['fingerprint'] = collect.fingerprint(snapshot)
    review = collect.review_form(snapshot)
    review.update(title='优惠预览 · 审查报告示例', target_label='冻结示例基线',
                  goal=['增加优惠比例的金额预览', '让预览文案明确区别于支付结果'],
                  non_goals=['真实支付、服务端计价、业务验收'],
                  summary='❌ 示例存在一处百分比换算错误；修正后补验 0%、10%、100%。以下均为虚构代码的报告演示。')
    review['focus_review_html'] = (
        '<h3>本次改动与通过标准</h3>'
        '<p>改前：只展示商品小计。改后：支持优惠比例，并显示“优惠后金额预览”。</p>'
        '<p>✅ 文案范围清楚（代码层）。❌ 金额计算问题见下方唯一 P1 主卡。</p>'
        '<p>⚠️ 开发修正百分比换算；测试核对 2 × 50、优惠 10% 应为 90，0% 为 100，100% 为 0。界面与真实业务未验。</p>'
        '<p>读者动作：开发处理 P1；AI 展开底稿核对全部文件、必要性与原始 diff。</p>'
        '<p><strong>示例说明：</strong>本页由正式生成器渲染；虚构隔离代码，非业务验收。</p>')
    quote = next(f for f in snapshot['files'] if f['path'] == 'src/quote.js')
    for item in snapshot['files']:
        is_quote = item is quote
        detail = review['files'][item['id']]
        ratings = [2, 1, 2, 1, 1, 3] if is_quote else [1, 1, 0, 0, 1, 1]
        reasons = (['优惠比例错误会改变展示金额','样例只有报价预览消费者','新增优惠参数改变原金额输出',
                    '局部同步计算，无状态或网络','少量增删，核心算式变化','只做代码核对，尚无界面回归'] if is_quote else
                   ['只变更预览文案','样例预览页使用标签','没有改变数据或错误行为','固定字符串，无分支',
                    '单行替换','真实界面未执行'])
        detail.update(purpose='计算展示金额' if is_quote else '提供预览标签',
                      position=item['path'] + ':1', change='增加优惠参数与展示算式' if is_quote else '明确这是预览金额',
                      why='样例需求要求按百分比预览优惠后金额' if is_quote else '避免读者把预览值当作已支付金额',
                      without='没有优惠预览能力' if is_quote else '读者无法从标签识别预览范围',
                      necessity='必要', reasonableness='新增参数范围有限；算式未除以 100，需按 P1 修正' if is_quote else '仅替换标签，保留原函数消费者',
                      loss='否', risk='P1：优惠 10 被直接当作倍数减去' if is_quote else '无',
                      risk_assessment=assessment(ratings, reasons),
                      scope_assessment=dict(classification='私有文件', reason='虚构隔离样例，只用于金额预览演示'),
                      requirement_context=dict(description='预览优惠比例对应金额' if is_quote else '显示“优惠后金额预览”',
                                               source='本文件的虚构示例目标', coverage='明确要求', rationale=''),
                      minimum_change=dict(verdict='符合', reason='分别保留局部算式与标签职责，无额外抽取'))
        for hunk in item['hunks']:
            detail['hunks'][hunk['id']].update(
                title='输入优惠比例后看到对应预览金额' if is_quote else '查看金额时看到预览标签',
                change=detail['change'], necessity='必要', reasonableness=detail['reasonableness'], without=detail['without'],
                evidence='E1：src/quote.js 第 4 行，百分比 10 未换算为 0.1' if is_quote else 'E2：src/quote-label.js 第 2 行仅改展示文案',
                issues=['P1'] if is_quote else [], risk_assessment=copy.deepcopy(detail['risk_assessment']),
                scope_assessment=dict(classification='私有方法', reason='样例模块内部预览用途'),
                focus=[dict(side='new', line=4, marker=1, explanation='10% 的输入是 10，必须先除以 100')] if is_quote else [])
    review['issues'] = [dict(
        id='P1', priority='P2', title='优惠 10% 时，预览金额变为负数', evidence='代码实锤', frequency='频率待确认',
        user_problem='样例读者输入 2 件、单价 50、优惠 10%，预览算式给出 −900。',
        condition='quantity=2、unitPrice=50、discountPercent=10',
        reason='输入以百分数表示，计算却直接从 1 减去 10，少了 /100。',
        invariant='有效优惠比例下，预览金额应在 0 与原小计之间',
        impact='样例金额预览错误；无真实支付或生产数据', scope='仅此虚构报价样例',
        recovery='修正算式并重新预览', suggestion='将比例换算为 discountPercent / 100，核对 0%、10%、100%。',
        evidence_refs=['E1：冻结示例 src/quote.js:4'],
        locations=[dict(file_id=quote['id'], line=4, symbol='quote')],
        inline_evidence_html='<article class="proof"><strong>E1 · 示例目标源码 / 关键行（非 diff）</strong>'
            '<pre><span class="line">3  const subtotal = quantity * unitPrice;</span>'
            '<span class="focus">4  return subtotal * (1 - discountPercent);</span></pre>'
            '<p>① 2 × 50 × (1 − 10) = −900；预期 2 × 50 × (1 − 10/100) = 90。</p>'
            '<a href="#hunk-' + quote['hunks'][0]['id'] + '">展开原始代码块与逐项判断</a></article>',
        repro=dict(persona='虚构预览页读者', preconditions='仅为样例；无真实业务界面',
                   steps=['输入数量 2、单价 50、优惠 10%', '观察预览金额'], actual='按代码计算为 −900', expected='应为 90',
                   observations=['预览金额与百分比换算'], type='候选复现路径/待验证', status='只核对代码，界面未执行',
                   boundary='不代表设备、后台或真实项目验收'))]
    review['change_relations'] = [dict(id='R1', kind='需求', title='优惠后金额预览',
        summary='扩展预览算式和标签；目标范围内没有网络请求、持久化或支付副作用。',
        status='文案代码已核对；算式 P1 待修正；界面未验', steps=[dict(commit_key='final', kind='需求',
        summary='当前未提交样例变化，非虚构新增 commit', file_ids=[f['id'] for f in snapshot['files']])])]
    rows = {
        '当前改动影响范围与潜在隐患': ['预览读者','金额与标签','P1：百分比算式'],
        '基线、约束与验证矩阵': ['隔离 Git 基线 → 工作区','无支付/网络','代码层核对，界面待验'],
        '最小必要改动基线': ['需求：优惠预览','局部计算与标签','不改真实支付'],
        '最小必要改动门禁': ['两个文件分别承担计算和文案','均有直接目标','没有额外抽取'],
        '功能点前后差异': ['原小计 → 优惠预览','0% 保留旧行为','10% 算式 P1'],
        '文件功能影响与丢失': ['报价计算与标签','原函数保留','旧无优惠输入默认 0'],
        '冗余/过度改动': ['未发现样例范围外变化','两处均必要','必要不代表算式正确'],
        '用户视角验证': ['2 件 × 50，优惠 10%','应为 90','候选路径，界面待验'],
        '待确认改动与验证边界': ['无真实消费者','无设备/后台验证','仅演示报告能力'],
    }
    review['sections'] = [dict(title=title, headers=['对象','判断','依据/边界'], rows=[values]) for title, values in rows.items()]
    review['validations'] = [dict(name='示例代码核对', result='算式错误已定位', layer='代码',
        oracle='10% 应先换算为 0.1', boundary='未执行真实界面或业务验收')]
    compact.rr.validate_snapshot(snapshot)
    compact.rr.validate_review(snapshot, review, False)
    compact.validate_risks(snapshot, review)
    for name, data in [('snapshot.json', snapshot), ('review.json', review)]:
        (output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    (output / 'report.html').write_text(compact.build(snapshot, review))
    print('Generated safe example: ' + str(output / 'report.html'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill-root', type=Path, default=Path(__file__).resolve().parents[1] / 'skills/review-report')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    generate(args.skill_root.resolve(), args.output_dir.resolve())
