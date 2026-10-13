#!/usr/bin/env node
/* unictos MCP server — exposes the Uniscan-verified skill catalog as MCP tools.
 * $0 backend: reads the public catalog at https://unictoai.github.io/unictos/skills.json
 * No API keys, no accounts, no tracking. Installs always resolve to the pinned,
 * human-reviewed commit — the server never invents or alters an install link.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CATALOG_URL = "https://unictoai.github.io/unictos/skills.json";
const SITE_URL = "https://unictoai.github.io/unictos/";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache = { at: 0, skills: [] };

async function loadCatalog() {
  const now = Date.now();
  if (cache.skills.length && now - cache.at < CACHE_TTL_MS) return cache.skills;
  const res = await fetch(CATALOG_URL, { headers: { "User-Agent": "unictos-mcp/1.0.0" } });
  if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  cache = { at: now, skills: data.skills || [] };
  return cache.skills;
}

function scoreOf(s) { return s.uniscan?.score ?? 0; }

function summary(s) {
  return {
    name: s.name,
    slug: s.slug,
    tagline: s.tagline,
    author: s.author,
    category: s.category,
    license: s.license,
    uniscan_score: scoreOf(s),
    verdict: s.uniscan?.verdict,
    listing: `${SITE_URL}#/s/${s.slug}`,
  };
}

function detail(s) {
  const u = s.uniscan || {};
  const f = u.findings || {};
  return {
    ...summary(s),
    description: s.description,
    use_cases: s.uses || [],
    permissions: (s.permissions || []).map(([level, text]) => ({ level, text })),
    safety: {
      score: u.score,
      verdict: u.verdict,
      scanned_at: u.scanned_at,
      scanner: `${u.scanner || "SkillSpector"} ${u.scanner_version || ""}`.trim(),
      findings: { critical: f.critical || 0, high: f.high || 0, medium: f.medium || 0, low: f.low || 0 },
      review_notes: u.notes || [],
      reviewer: s.review?.reviewer,
      report_url: u.report ? new URL(u.report, SITE_URL).href : null,
    },
    install: {
      pinned_commit: s.pinned_sha,
      repo: s.repo,
      path_in_repo: s.path,
      hint: s.install_hint,
      // Bit-for-bit the commit Uniscan scanned. Never auto-advance.
      pinned_archive: s.repo && s.pinned_sha ? `${s.repo}/archive/${s.pinned_sha}.zip` : null,
    },
  };
}

function matches(s, q) {
  const hay = [s.name, s.slug, s.tagline, s.description, s.author, s.category, ...(s.uses || [])]
    .filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

const server = new McpServer({ name: "unictos", version: "1.0.0" });

server.tool(
  "search_skills",
  "Search the unictos catalog of Uniscan-verified AI agent skills. Every result passed a static security scan plus human review. Returns safety scores so you can prefer verified-safe skills.",
  {
    query: z.string().describe("Keywords, e.g. 'pdf', 'react testing', 'postgres'"),
    category: z.string().optional().describe("Filter by category slug, e.g. 'security', 'code', 'data'"),
    min_score: z.number().optional().describe("Only skills with Uniscan score >= this (0-100)"),
    limit: z.number().optional().describe("Max results (default 8, max 25)"),
  },
  async ({ query, category, min_score, limit }) => {
    const skills = await loadCatalog();
    const n = Math.min(Math.max(limit ?? 8, 1), 25);
    const hits = skills
      .filter((s) => (!category || s.category === category) && matches(s, query))
      .filter((s) => scoreOf(s) >= (min_score ?? 0))
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, n)
      .map(summary);
    return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
  }
);

server.tool(
  "get_skill",
  "Full details for one verified skill: safety report, permissions, pinned commit and install info.",
  { slug: z.string().describe("Skill slug, e.g. 'security-audit'") },
  async ({ slug }) => {
    const skills = await loadCatalog();
    const s = skills.find((x) => x.slug === slug || x.name === slug);
    if (!s) return { content: [{ type: "text", text: `No verified skill found for "${slug}".` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(detail(s), null, 2) }] };
  }
);

server.tool(
  "list_categories",
  "All skill categories in the verified catalog with skill counts.",
  {},
  async () => {
    const skills = await loadCatalog();
    const counts = {};
    for (const s of skills) counts[s.category] = (counts[s.category] || 0) + 1;
    const out = Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    return { content: [{ type: "text", text: JSON.stringify({ total: skills.length, categories: out }, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
