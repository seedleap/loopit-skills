#!/usr/bin/env python3
"""隔离样例验证新版排序、证据、原始 patch 与注入保护；不证明业务代码正确。"""
import copy
import base64
from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import unittest
import render_compact_report as compact
import test_report as fixtures
from test_report import complete_form, Page


PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='


class Structure(HTMLParser):
    """记录实际元素祖先，避免只比较字符串先后却漏掉折叠层嵌套错误。"""
    def __init__(self, source):
        super().__init__()
        self.stack, self.ancestors = [], {}
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ancestors[attrs['id']] = tuple(identity for _, identity in self.stack if identity)
        if tag not in {'meta', 'img', 'br', 'hr', 'input', 'link', 'source', 'wbr'}:
            self.stack.append((tag, attrs.get('id')))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                return


def risk(rating):
    return dict(model_version='review-priority-v1', score=rating*25, floor=0,
                dimensions=[dict(name=str(i),weight=w,rating=rating,reason='结构测试理由',source='隔离样例') for i,w in enumerate(compact.WEIGHTS)])


class CompactTest(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.ReportTest()
        self.fixture.setUp()
        self.snapshot=self.fixture.snapshot()
        self.review=complete_form(self.snapshot)
        for file in self.review['files'].values():
            for d in [file]+list(file['hunks'].values()):
                d['risk_assessment']=risk(1)
                d['scope_assessment']={'classification':'范围待确认','reason':'仅用于隔离结构测试'}

    def tearDown(self):
        self.fixture.tearDown()

    def add_issue(self):
        item = next(f for f in self.snapshot['files'] if f['hunks'] and f['bucket'] != '测试')
        issue = dict(id='P1', priority='P2', title='隔离样例问题卡片', evidence='待确认', frequency='频率待确认',
                     locations=[dict(file_id=item['id'], line=1, symbol='value')],
                     condition='结构测试，不代表用户问题', invariant='验证引用完整性', impact='实际业务影响未评估',
                     scope='临时样例', recovery='不适用，结构测试', suggestion='真实问题须人工判断',
                     repro=dict(persona='样例读者', preconditions='仅打开报告样例', steps=['打开问题卡片', '点击代码块链接'],
                                actual='设备运行未验证', expected='报告展开对应代码', observations=['证据状态文字'],
                                type='候选复现路径/待验证', status='未执行业务验证', boundary='仅验证渲染'))
        self.review['issues'] = [issue]
        self.review['files'][item['id']]['hunks'][item['hunks'][0]['id']]['issues'] = ['P1']
        return issue, item

    def test_current_issue_and_inline_proof_are_visible_before_ai_fold(self):
        issue, item = self.add_issue()
        self.review['focus_review_html'] = '<p>⚠️ 样例的业务行为未验证，请只检查报告交互。</p>'
        hunk = item['hunks'][0]['id']
        issue['inline_evidence_html'] = ('<figure id="proof-P1"><img src="' + PNG + '" alt="隔离图片">'
            '<figcaption>隔离图像，不代表源码证据；版本 fixture，行 1。</figcaption></figure>'
            '<a href="#hunk-' + hunk + '">查原始块</a>')
        self.review['issue_evidence_html'] = '<p id="legacy-proof">旧入口仍可显示</p>'
        compact.rr.validate_review(self.snapshot, self.review, False)
        markup = compact.build(self.snapshot, self.review)
        structure, page = Structure(markup), Page(markup)
        self.assertNotIn('full-review', structure.ancestors['final-issue-P1'])
        self.assertIn('issues', structure.ancestors['final-proof-P1'])
        self.assertNotIn('full-review', structure.ancestors['final-proof-P1'])
        self.assertIn('full-review', structure.ancestors['final-file-' + item['id']])
        self.assertEqual(markup.count('id="final-issue-P1"'), 1)
        self.assertLess(markup.index('可达条件/关键原因'), markup.index('id="final-proof-P1"'))
        self.assertLess(markup.index('id="final-proof-P1"'), markup.index('破坏的不变量'))
        self.assertIn('href="#final-hunk-' + hunk + '"', markup)
        self.assertIn('legacy-proof', page.ids)
        self.assertCountEqual(page.patches, [f['patch'] for f in self.snapshot['files']])
        self.assertEqual(len(page.ids), len(set(page.ids)))
        for tag, attrs in page.tags:
            if tag == 'a' and attrs.get('href', '').startswith('#'):
                self.assertIn(attrs['href'][1:], page.ids)

    def test_inline_evidence_is_optional_and_rejects_invalid_field_values(self):
        issue, _ = self.add_issue()
        self.assertIn('final-issue-P1', Page(compact.build(self.snapshot, self.review)).ids)
        for invalid in (None, '', ' ', [], {}):
            with self.subTest(invalid=invalid), self.assertRaises(compact.rr.ReportError):
                issue['inline_evidence_html'] = invalid
                compact.build(self.snapshot, self.review)

    def test_raster_evidence_rejects_network_svg_mismatched_payload_and_events(self):
        invalid = ['https://example.invalid/a.png', '//example.invalid/a.png', 'file:///tmp/a.png',
                   'data:image/svg+xml;base64,PHN2Zy8+',
                   'data:image/png;base64,PHN2Zy8+', 'data:image/jpeg;base64,' + PNG.split(',')[1],
                   'data:image/png;base64,%%%']
        for src in invalid:
            with self.subTest(src=src):
                self.assertNotIn('<img', compact.safe_fragment('<img src="' + src + '">'))
        markup = compact.safe_fragment('<figure><img src="https://example.invalid/a" src="' + PNG
            + '" onerror="bad()" style="background:url(https://example.invalid/b)"><figcaption>图注</figcaption></figure>')
        images = [attrs for tag, attrs in Page(markup).tags if tag == 'img']
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]['src'], PNG)
        self.assertNotIn('example.invalid', markup)
        self.assertNotIn('onerror', markup)
        self.assertNotIn('style=', markup)
        self.assertIn('<figcaption>图注</figcaption>', markup)
        jpeg = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff\xe0fixture\xff\xd9').decode()
        self.assertEqual([a['src'] for t, a in Page(compact.safe_fragment('<img src="' + jpeg + '">')).tags if t == 'img'], [jpeg])

    def test_evidence_fragment_cannot_close_its_parent_or_leave_unclosed_elements(self):
        issue, _ = self.add_issue()
        issue['inline_evidence_html'] = '</details></article><figure id="contained"><strong>未闭合的片段'
        markup = compact.build(self.snapshot, self.review)
        structure = Structure(markup)
        self.assertIn('final-issue-P1', structure.ancestors['final-contained'])
        self.assertNotIn('<figure id="final-contained"><strong>未闭合的片段</div>', markup)
        self.assertIn('未闭合的片段</strong></figure></div>', markup)

    def test_complete_patch_links_and_removed_controls(self):
        self.review['sections'].append({'title':'提交演变与后续修复','headers':['不可渲染'], 'rows':[['仅保留内部数据']]})
        markup=compact.build(self.snapshot,self.review)
        page=Page(markup)
        self.assertCountEqual(page.patches,[f['patch'] for f in self.snapshot['files']])
        self.assertEqual(len(page.ids),len(set(page.ids)))
        for tag,attrs in page.tags:
            if tag=='a' and attrs.get('href','').startswith('#'):
                self.assertIn(attrs['href'][1:],page.ids)
        for deleted in ['path-filter','bucket-filter','issue-filter','filter-result']:
            self.assertNotIn(deleted,page.ids)
        for deleted in ['本轮实际验证','当前 HEAD 执行结果','审查依据与交付边界','验证结果与证据边界','提交演变与后续修复']:
            self.assertNotIn(deleted,markup)
        self.assertNotIn('本范围无此类改动',markup)
        self.assertEqual(compact.render_scope({'files':[]}, {'files':{},'issues':[]}, 'empty'),'')
        self.assertNotIn('<img',markup)

    def test_focus_layer_preserves_every_review_patch_and_target(self):
        item = next(f for f in self.snapshot['files'] if f['hunks'])
        target = 'final-hunk-' + item['hunks'][0]['id']
        self.review['focus_review_html'] = ('<h3>必须处理</h3><p>范围仍待确认，非确认冗余。</p>'
            '<a href="#' + target + '">查看对应逐块判断</a>')
        markup = compact.build(self.snapshot, self.review)
        page = Page(markup)
        self.assertLess(markup.index('id="focus-review"'), markup.index('id="full-review"'))
        wrapper = next(attrs for tag, attrs in page.tags if attrs.get('id') == 'full-review')
        self.assertNotIn('open', wrapper)
        self.assertCountEqual(page.patches, [f['patch'] for f in self.snapshot['files']])
        self.assertEqual(len(page.ids), len(set(page.ids)))
        self.assertTrue(any(tag == 'a' and attrs.get('href') == '#' + target
                            and 'data-open-target' in attrs for tag, attrs in page.tags))
        for tag, attrs in page.tags:
            if tag == 'a' and attrs.get('href', '').startswith('#'):
                self.assertIn(attrs['href'][1:], page.ids)
        for f in self.snapshot['files']:
            self.assertIn('final-file-' + f['id'], page.ids)
            for h in f['hunks']:
                self.assertIn('final-hunk-' + h['id'], page.ids)

    def test_focus_layer_does_not_allow_omitted_hunk_review(self):
        self.review['focus_review_html'] = '<p>摘要不能代替全量审查。</p>'
        item = next(f for f in self.snapshot['files'] if f['hunks'])
        del self.review['files'][item['id']]['hunks'][item['hunks'][0]['id']]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'snapshot.json').write_text(json.dumps(self.snapshot))
            (root / 'review.json').write_text(json.dumps(self.review))
            with self.assertRaises(compact.rr.ReportError):
                compact.load_pair(root / 'snapshot.json', root / 'review.json')

    def test_focus_fragment_uses_static_sanitizer_and_keeps_legacy_input(self):
        legacy = compact.build(self.snapshot, self.review)
        self.assertNotIn('id="full-review"', legacy)
        self.review['focus_review_html'] = ('<p>人工重点说明</p><script>bad()</script>'
            '<img src="https://example.invalid/track"><a href="javascript:bad()">bad</a>')
        markup = compact.build(self.snapshot, self.review)
        self.assertNotIn('<script>bad()', markup)
        self.assertNotIn('<img', markup)
        self.assertNotIn('javascript:', markup)
        for invalid in ['', [], {}]:
            self.review['focus_review_html'] = invalid
            with self.assertRaises(compact.rr.ReportError):
                compact.build(self.snapshot, self.review)

    def test_risk_sort_preserves_original_patch_and_ids(self):
        business=[f for f in self.snapshot['files'] if f['bucket']=='业务']
        high,low=business[-1],business[0]
        self.review['files'][high['id']]['risk_assessment']=risk(3)
        markup=compact.render_scope(self.snapshot,self.review,'fixture')
        self.assertLess(markup.index('id="fixture-file-'+high['id']),markup.index('id="fixture-file-'+low['id']))
        item=copy.deepcopy(next(f for f in business if f['hunks']))
        detail=copy.deepcopy(self.review['files'][item['id']])
        first=item['hunks'][0]
        second=copy.deepcopy(first);second['id']=first['id']+'-second'
        item['hunks'].append(second)
        item['patch']+='\n'+second['header']+'\n'+'\n'.join(second['lines'])+'\n'
        detail['hunks'][second['id']]=copy.deepcopy(detail['hunks'][first['id']])
        detail['hunks'][second['id']]['risk_assessment']=risk(3)
        markup=compact.render_file(item,detail,self.review,self.snapshot)
        self.assertLess(markup.index('id="hunk-'+second['id']+'"'),markup.index('id="hunk-'+first['id']+'"'))
        self.assertEqual(Page(markup).patches,[item['patch']])

    def test_score_math_and_max_child_cannot_be_diluted(self):
        compact.validate_risks(self.snapshot,self.review)
        item=next(f for f in self.snapshot['files'] if f['hunks'])
        detail=self.review['files'][item['id']]
        detail['hunks'][item['hunks'][0]['id']]['risk_assessment']=risk(3)
        with self.assertRaises(compact.rr.ReportError):compact.validate_risks(self.snapshot,self.review)
        detail['risk_assessment']['score']=75
        compact.validate_risks(self.snapshot,self.review)
        detail['risk_assessment']['score']=76
        with self.assertRaises(compact.rr.ReportError):compact.validate_risks(self.snapshot,self.review)

    def test_nonessential_warning_stays_on_its_hunk_and_preserves_diff_and_critical_alert(self):
        item = copy.deepcopy(next(f for f in self.snapshot['files'] if f['hunks']))
        detail = copy.deepcopy(self.review['files'][item['id']])
        first = item['hunks'][0]
        second = copy.deepcopy(first)
        second['id'] += '-necessary'
        item['hunks'] = [first, second]
        detail['hunks'] = {first['id']: copy.deepcopy(detail['hunks'][first['id']]),
                           second['id']: copy.deepcopy(detail['hunks'][first['id']])}
        detail['hunks'][first['id']].update(necessity='冗余', critical_chains=['埋点'])
        detail['hunks'][second['id']]['necessity'] = '必要'
        markup = compact.render_file(item, detail, self.review, self.snapshot)
        page = Page(markup)
        blocks = [attrs for tag, attrs in page.tags if tag == 'details' and attrs.get('class') == 'hunk-review']
        self.assertEqual([block['data-necessity'] for block in blocks], ['冗余', '必要'])
        self.assertEqual(markup.count('⚠️ 非必要'), 1)
        self.assertIn('‼️ 改动埋点关键链路，仔细审查', markup)
        self.assertIn('class="hunk-title critical-title"', markup)
        self.assertEqual(page.patches, [item['patch']])
        css = (compact.ROOT / 'assets/report.css').read_text()
        self.assertIn('.hunk-review[data-necessity="冗余"]>summary', css)
        self.assertIn('.hunk-review[data-necessity="过度改动"]>summary', css)
        self.assertIn('background:#fff4cc', css)

    def test_evidence_fragments_cannot_execute_or_load_resources(self):
        markup=compact.safe_fragment('<script>alert(1)</script><img src="https://example.invalid/x"><a href="javascript:alert(1)" onclick="bad()">bad</a><a href="#proof">good</a>')
        self.assertNotIn('<script',markup)
        self.assertNotIn('<img',markup)
        self.assertNotIn('javascript:',markup)
        self.assertNotIn('onclick',markup)
        self.assertIn('href="#proof"',markup)

    def test_only_confirmed_nonessential_statuses_get_warning(self):
        item = next(f for f in self.snapshot['files'] if f['hunks'])
        hunk = item['hunks'][0]
        original = self.review['files'][item['id']]['hunks'][hunk['id']]
        for necessity in ['必要', '有条件必要', '冗余', '过度改动', '证据不足']:
            with self.subTest(necessity=necessity):
                detail = copy.deepcopy(original)
                detail['necessity'] = necessity
                markup = compact.render_hunk(hunk, detail, 1, False)
                expected = necessity in ['冗余', '过度改动']
                self.assertEqual('⚠️ 非必要' in markup, expected)
                self.assertEqual('necessity-badge necessity-nonessential' in markup, expected)
                self.assertIn('必要性：', markup)
                self.assertIn('data-necessity="' + necessity + '"', markup)
                # 必要性标记不得修改源码及其旧/新行号。
                self.assertIn(compact.rr.render_diff(hunk['header'], hunk['lines'], hunk['id'], detail.get('focus', [])), markup)

    def relation_input(self):
        """两个隔离范围验证映射；快照内容相同，不声称模拟了业务提交历史。"""
        commits = [dict(key=key, commit=key * 20, subject='隔离阶段' + key,
                        snapshot_data=self.snapshot, review_data=self.review)
                   for key in ('c1', 'c2')]
        file_ids = [f['id'] for f in self.snapshot['files']]
        relation = dict(id='R1', kind='需求', title='搜索页展示推荐',
                        summary='一个需求跨两次代码变化', status='后续修正已完成，设备未验证',
                        steps=[dict(commit_key=key, kind=kind, summary=summary, file_ids=file_ids[:])
                               for key, kind, summary in [('c1', '需求', '首次展示'), ('c2', '修复', '修正已有展示')]])
        return commits, relation

    def test_historical_evidence_has_independent_anchors_and_cannot_change_snapshot(self):
        issue, item = self.add_issue()
        hunk = item['hunks'][0]['id']
        issue['inline_evidence_html'] = '<p id="proof-P1"><a href="#hunk-' + hunk + '">历史块</a></p>'
        historical = copy.deepcopy(self.review)
        historical['issues'][0]['title'] = '历史阶段的问题，不代表当前仍存在'
        commits, relation = self.relation_input()
        for source in commits:
            source['review_data'] = historical
        self.review['change_relations'] = [relation]
        self.review['focus_review_html'] = '<p>按当前状态阅读。</p>'
        before = copy.deepcopy(self.snapshot)
        markup = compact.build(self.snapshot, self.review, commits)
        page = Page(markup)
        for prefix in ('R1-c1', 'R1-c2', 'final'):
            self.assertIn(prefix + '-proof-P1', page.ids)
            self.assertIn('href="#' + prefix + '-hunk-' + hunk + '"', markup)
        self.assertEqual(self.snapshot, before)
        self.assertEqual(len(page.ids), len(set(page.ids)))
        self.assertCountEqual(page.patches, [f['patch'] for f in self.snapshot['files']] * 3)
        historical['issues'][0]['inline_evidence_html'] = []
        with self.assertRaises(compact.rr.ReportError):
            compact.build(self.snapshot, self.review, commits)

    def test_relation_contains_chronological_code_and_distinct_types(self):
        commits, relation = self.relation_input()
        self.review['change_relations'] = [relation]
        markup = compact.build(self.snapshot, self.review, commits)
        page = Page(markup)
        self.assertIn('2 个 commit', markup)
        self.assertEqual(markup.count('class="change-relation"'), 1)
        self.assertIn('R 是关系编号，不是 commit 编号', markup)
        self.assertIn('class="change-kind">需求', markup)
        self.assertIn('class="change-kind">修复', markup)
        first = markup.index('id="step-R1-c1"')
        second = markup.index('id="step-R1-c2"')
        file_id = self.snapshot['files'][0]['id']
        self.assertLess(first, markup.index('id="R1-c1-file-' + file_id + '"'))
        self.assertLess(markup.index('id="R1-c1-file-' + file_id + '"'), second)
        self.assertNotIn('class="commit-section"', markup)
        self.assertEqual(len(page.ids), len(set(page.ids)))
        for tag, attrs in page.tags:
            if tag == 'a' and attrs.get('href', '').startswith('#'):
                self.assertIn(attrs['href'][1:], page.ids)
            if tag == 'details' and attrs.get('class') == 'file-review' and attrs.get('id', '').startswith('R1-'):
                fid = attrs['id'].split('-file-')[-1]
                item = next(f for f in self.snapshot['files'] if f['id'] == fid)
                self.assertEqual('open' in attrs, item['bucket'] != '测试')
        self.assertCountEqual(page.patches, [f['patch'] for f in self.snapshot['files']] * 3)

    def test_shared_files_have_unique_relation_anchors_and_preserve_sources(self):
        commits, relation = self.relation_input()
        another = copy.deepcopy(relation)
        another.update(id='R2', kind='修复', title='同一文件支撑另一修复',
                       origin={'label': 'origin/dev', 'summary': '基线已有机制'})
        another['steps'] = [another['steps'][0]]
        another['steps'][0]['file_ids'] = [self.snapshot['files'][0]['id']]
        self.review['change_relations'] = [relation, another]
        before = copy.deepcopy((self.snapshot, self.review))
        markup = compact.build(self.snapshot, self.review, commits)
        self.assertIn('起点：origin/dev', markup)
        page = Page(markup)
        self.assertEqual(len(page.ids), len(set(page.ids)))
        self.assertEqual(before, (self.snapshot, self.review))

    def test_invalid_relation_mapping_never_silently_omits_code(self):
        commits, relation = self.relation_input()
        mutations = [
            lambda r: r[0]['steps'][0].update(commit_key='missing'),
            lambda r: r[0]['steps'][0].update(file_ids=['F999']),
            lambda r: r[0]['steps'].reverse(),
            lambda r: r[0]['steps'].pop(),
            lambda r: r[0]['steps'][0]['file_ids'].pop(),
            lambda r: r[0].update(kind='根据subject自动猜测'),
            lambda r: r[0]['steps'][0].update(kind=''),
            lambda r: r.append(copy.deepcopy(r[0])),
        ]
        with self.assertRaises(compact.rr.ReportError):
            compact.build(self.snapshot, self.review, commits)
        for mutation in mutations:
            relations = [copy.deepcopy(relation)]
            mutation(relations)
            self.review['change_relations'] = relations
            with self.subTest(relations=relations), self.assertRaises(compact.rr.ReportError):
                compact.build(self.snapshot, self.review, commits)

    def test_single_range_relation_and_escaped_labels(self):
        _, relation = self.relation_input()
        relation['steps'] = [relation['steps'][0]]
        relation['steps'][0]['commit_key'] = 'final'
        relation['title'] = '<script>不是代码</script>'
        self.review['change_relations'] = [relation]
        markup = compact.build(self.snapshot, self.review)
        self.assertIn('&lt;script&gt;不是代码&lt;/script&gt;', markup)
        self.assertNotIn('<script>不是代码</script>', markup)
        self.assertIn('id="step-R1-final"', markup)


if __name__=='__main__':
    unittest.main(verbosity=2)
