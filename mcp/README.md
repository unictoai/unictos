# unictos MCP server

Search the [unictos](https://unictoai.github.io/unictos/) catalog of **106 Uniscan-verified AI agent skills** from inside Claude Code, Claude Desktop, or any MCP-compatible client.

No API keys. No accounts. No tracking. The server reads the public catalog (`skills.json`) — the same data the website renders.

## Install

**Claude Code** (one command):

```bash
claude mcp add unictos -- npx -y unictos-mcp
```

**Claude Desktop** — add to your MCP config:

```json
{
  "mcpServers": {
    "unictos": { "command": "npx", "args": ["-y", "unictos-mcp"] }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `search_skills` | Search verified skills by keyword, with optional category filter and minimum Uniscan safety score |
| `get_skill` | Full detail: safety report, permissions in plain words, review notes, pinned commit, install info |
| `list_categories` | All categories with skill counts |

Example: *"Find me a verified-safe skill for working with PDFs"* → searches the catalog, returns the top matches with safety scores, and the agent can pull the full scan report before installing anything.

## Trust model

- Every skill passed a **SkillSpector static scan + human review** — scores and findings come straight from the public Uniscan reports.
- Installs resolve to a **pinned commit** — the exact code that was scanned. Pins never auto-advance.
- The server never invents install links; if a skill isn't in the verified catalog, it says so.

## Develop

```bash
npm install
node src/index.js   # stdio MCP server
```

## Publish

```bash
npm login
npm publish --access public
```
