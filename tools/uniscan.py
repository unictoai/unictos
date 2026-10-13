#!/usr/bin/env python3
"""Uniscan worker: scan pinned skill commits with SkillSpector, refresh reports.

Usage: python tools/uniscan.py [slug]

- No slug: scan every skill in docs/skills.json at its pinned SHA.
- With slug: scan just that skill.
- Weekly schedule also checks upstream: if the repo's HEAD moved past the
  pinned SHA, the skill's verdict flips to "re-review" (human re-checks
  before the pin advances). The pin NEVER moves on its own.

What this script updates per skill:
  uniscan.scanned_at, uniscan.scanner_version, uniscan.findings,
  uniscan.report, uniscan.upstream_sha / uniscan.verdict ("re-review" only)
What it never touches: uniscan.score (human-assigned after review).
"""

import json
import os
import subprocess
import sys
import tempfile
from datetime import date

SKILLS_JSON = "docs/skills.json"
REPORTS_DIR = "docs/reports"


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def fetch_pinned(repo_url, sha, dest):
    """Download the repo tarball at exactly the pinned commit."""
    os.makedirs(dest, exist_ok=True)
    # repo_url like https://github.com/owner/name[.git]
    base = repo_url[:-4] if repo_url.endswith(".git") else repo_url
    url = f"{base}/archive/{sha}.tar.gz"
    tar_path = os.path.join(dest, "repo.tar.gz")
    r = run(["curl", "-sL", "--max-time", "120", "-o", tar_path, url])
    if r.returncode != 0 or not os.path.exists(tar_path):
        return False
    e = run(["tar", "xzf", tar_path, "-C", dest, "--strip-components=1"])
    os.remove(tar_path)
    return e.returncode == 0


def upstream_head(repo_url):
    r = run(["git", "ls-remote", repo_url, "HEAD"])
    return r.stdout.split()[0] if r.returncode == 0 and r.stdout else None


def scan_skill(skill):
    slug = skill["slug"]
    print(f"--- {slug} ---")
    with tempfile.TemporaryDirectory(prefix="uniscan-") as tmp:
        repo_dir = os.path.join(tmp, "repo")
        if not fetch_pinned(skill["repo"], skill["pinned_sha"], repo_dir):
            print(f"  !! could not fetch pinned SHA {skill['pinned_sha'][:12]}")
            return False
        target = os.path.join(repo_dir, skill["path"])
        report_path = os.path.join(REPORTS_DIR, f"{slug}.json")
        os.makedirs(REPORTS_DIR, exist_ok=True)
        s = run(
            ["skillspector", "scan", target, "--no-llm",
             "--format", "json", "--output", report_path]
        )
        if s.returncode != 0 or not os.path.exists(report_path):
            print(f"  !! scan failed: {s.stderr[:200]}")
            return False
        with open(report_path) as fh:
            report = json.load(fh)
    sev = {}
    for issue in report.get("issues", []):
        k = (issue.get("severity") or "?").lower()
        sev[k] = sev.get(k, 0) + 1
    sv = run(["skillspector", "--version"])
    version = sv.stdout.strip().split()[-1] if sv.returncode == 0 else "unknown"
    u = skill["uniscan"]
    u["scanned_at"] = date.today().isoformat()
    u["scanner_version"] = version
    u["findings"] = {
        "critical": sev.get("critical", 0),
        "high": sev.get("high", 0),
        "medium": sev.get("medium", 0),
        "low": sev.get("low", 0),
    }
    u["report"] = f"reports/{slug}.json"
    print(f"  findings: {u['findings']} (score untouched: {u['score']})")
    return True


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    with open(SKILLS_JSON) as fh:
        catalog = json.load(fh)
    changed = False
    for skill in catalog["skills"]:
        if only and skill["slug"] != only:
            continue
        # Upstream drift check: never move the pin automatically.
        head = upstream_head(skill["repo"])
        if head and head != skill["pinned_sha"]:
            if skill["uniscan"].get("verdict") != "re-review":
                skill["uniscan"]["verdict"] = "re-review"
                skill["uniscan"]["upstream_sha"] = head
                print(f"--- {skill['slug']}: upstream moved "
                      f"{skill['pinned_sha'][:8]} -> {head[:8]}; marked re-review")
                changed = True
        if scan_skill(skill):
            changed = True
    if changed:
        catalog["generated_at"] = date.today().isoformat()
        with open(SKILLS_JSON, "w") as fh:
            json.dump(catalog, fh, indent=1)
            fh.write("\n")
        print("skills.json updated")
    else:
        print("nothing changed")


if __name__ == "__main__":
    main()
