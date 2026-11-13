"""校验修复/需求与冻结提交的多对多映射，并在关系下就近呈现完整代码审查。"""
from __future__ import annotations

import copy
import re

import render_report as rr


KINDS = ("修复", "需求")


def sources(snapshot, review, commits):
    """单范围以 final 引用；多提交只允许引用已冻结的显式 manifest。"""
    if not commits:
        return {"final": {"commit": snapshot["target"], "snapshot_data": snapshot,
                          "review_data": review, "subject": review["title"]}}
    result = {}
    for commit in commits:
        key = commit["key"]
        rr.require(isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_-]+", key)
                   and key != "final" and key not in result, "commit key 重复或不合法")
        result[key] = commit
    return result


def validate(relations, source_map):
    """拒绝悬空映射、乱序演变或漏掉提交/文件；允许一个文件支撑多条关系。"""
    rr.require(isinstance(relations, list) and bool(relations),
               "多提交报告须填写 change_relations：修复/需求关系及其代码演变")
    seen_ids, covered, covered_commits = set(), set(), set()
    positions = {key: index for index, key in enumerate(source_map)}
    first_positions = []
    for relation in relations:
        rr.require(isinstance(relation, dict), "change_relations 每项应为对象")
        relation_id = rr.field(relation, "id", str, "关系")
        rr.require(re.fullmatch(r"R[1-9]\d*", relation_id) and relation_id not in seen_ids,
                   "关系 ID 必须为唯一 R1、R2 等，不能当成 commit 编号")
        seen_ids.add(relation_id)
        for name in ("title", "summary", "status"):
            rr.field(relation, name, str, relation_id)
        rr.require(relation.get("kind") in KINDS, f"{relation_id}: 类型须为修复或需求")
        if "origin" in relation:
            rr.require(isinstance(relation["origin"], dict), "origin 应为基线来源对象")
            for name in ("label", "summary"):
                rr.field(relation["origin"], name, str, relation_id + ".origin")
        steps = rr.field(relation, "steps", list, relation_id)
        rr.require(bool(steps), f"{relation_id}: 至少一个实际代码变化阶段")
        previous = -1
        for index, step in enumerate(steps):
            rr.require(isinstance(step, dict), "关系阶段应为对象")
            key = rr.field(step, "commit_key", str, relation_id)
            rr.require(key in source_map, f"{relation_id}: 未知 commit_key {key}")
            rr.require(positions[key] > previous, f"{relation_id}: 阶段须按冻结提交顺序且不能重复")
            previous = positions[key]
            if index == 0:
                first_positions.append(previous)
            rr.require(step.get("kind") in KINDS, f"{relation_id}: 每阶段须标修复或需求")
            rr.field(step, "summary", str, relation_id + ".steps")
            file_ids = rr.field(step, "file_ids", list, relation_id)
            rr.string_list(file_ids, relation_id + ".file_ids")
            rr.require(len(file_ids) == len(set(file_ids)), "同一阶段不能重复列文件")
            actual = {item["id"] for item in source_map[key]["snapshot_data"]["files"]}
            rr.require(set(file_ids) <= actual, f"{relation_id}: 引用了范围外文件")
            rr.require(bool(file_ids) or not actual, f"{relation_id}: 有 diff 的阶段须列相关文件")
            covered.update((key, file_id) for file_id in file_ids)
            covered_commits.add(key)
    rr.require(first_positions == sorted(first_positions), "关系按首次代码变化的提交顺序展示")
    expected = {(key, item["id"]) for key, source in source_map.items()
                for item in source["snapshot_data"]["files"]}
    rr.require(covered == expected and covered_commits == set(source_map),
               "change_relations 必须覆盖全部冻结提交及各提交的全部 diff 文件")


def render(relations, source_map, render_scope, render_issue, final_issues):
    """每阶段复用原文件/hunk审查；只创建展示副本，不改快照、patch或证据坐标。"""
    output = ['<section id="change-relations"><h2>修复与需求 · 随代码展开</h2>',
              '<p class="group-note">R 是关系编号，不是 commit 编号；一条关系可跨多个提交，同一提交可涉及多条关系。阶段内业务/辅助/测试分别展示，文件和块按危险系数降序。</p>']
    for relation in relations:
        rid = relation["id"]
        output.append(f'<article class="change-relation" id="relation-{rr.esc(rid)}">'
                      f'<h3><span class="change-kind">{rr.esc(relation["kind"])}</span> '
                      f'{rr.esc(rid)} · {rr.esc(relation["title"])}</h3>'
                      f'<p>{rr.esc(relation["summary"])}</p>'
                      f'<p class="relation-status"><strong>当前状态：</strong>{rr.esc(relation["status"])}</p>')
        if relation.get("origin"):
            origin = relation["origin"]
            output.append(f'<p class="relation-origin">起点：{rr.esc(origin["label"])} · {rr.esc(origin["summary"])}</p>')
        for step in relation["steps"]:
            source = source_map[step["commit_key"]]
            key = rid + "-" + step["commit_key"]
            selected = set(step["file_ids"])
            snapshot, review = copy.deepcopy(source["snapshot_data"]), copy.deepcopy(source["review_data"])
            snapshot["files"] = [item for item in snapshot["files"] if item["id"] in selected]
            review["files"] = {fid: detail for fid, detail in review["files"].items() if fid in selected}
            # 全量矩阵仍在最终完整 diff 和侧车数据中，避免每阶段重复整张跨文件总表。
            review["sections"] = []
            issues = []
            referenced = {issue_id for detail in review["files"].values()
                          for hunk in detail["hunks"].values() for issue_id in hunk.get("issues", [])}
            for issue in review["issues"]:
                issue["locations"] = [loc for loc in issue["locations"] if loc["file_id"] in selected]
                if issue["locations"] or issue["id"] in referenced:
                    issues.append(issue)
            review["issues"] = issues
            output.append(f'<section class="change-step" id="step-{rr.esc(key)}">'
                          f'<h4><span class="change-kind">{rr.esc(step["kind"])}</span> '
                          f'{rr.esc(str(source["commit"])[:9])} · {rr.esc(source["subject"])}</h4>'
                          f'<p>{rr.esc(step["summary"])}</p>')
            markup = render_scope(snapshot, review, key)
            for issue in issues:
                if issue["id"] in final_issues and issue["title"] == final_issues[issue["id"]]["title"]:
                    markup = markup.replace(f'href="#{key}-issue-{issue["id"]}"',
                                            f'href="#final-issue-{issue["id"]}"')
                else:
                    markup += render_issue(issue, snapshot, review, key)
            output.append(markup + '</section>')
        output.append('</article>')
    return ''.join(output) + '</section>'
