#!/usr/bin/env python3
"""
STORMFEA Design Research & Improvement Agent

Two commands:
  research   — fetch sources, synthesize digest, append to DESIGN_RESEARCH.md
  implement  — read latest digest, generate one CSS change, apply to index.html

Runs weekly in GitHub Actions; also callable locally:
  ANTHROPIC_API_KEY=... python scripts/design_research.py research
  ANTHROPIC_API_KEY=... python scripts/design_research.py implement
"""

import os, sys, json, datetime, re, requests
import anthropic

client = anthropic.Anthropic()
TODAY  = datetime.date.today().isoformat()

HAIKU  = 'claude-haiku-4-5-20251001'
SONNET = 'claude-sonnet-4-6'


# ── Helpers ──────────────────────────────────────────────────────────────────

def strip_html(text: str, limit: int = 4000) -> str:
    text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
    text = re.sub(r'<style[^>]*>[\s\S]*?</style>',  '', text, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def fetch(url: str, limit: int = 4000) -> str:
    try:
        r = requests.get(url, timeout=15,
                         headers={'User-Agent': 'STORMFEA-ResearchBot/1.0'})
        return strip_html(r.text, limit)
    except Exception as e:
        return f'[fetch failed: {e}]'


def gh_search(query: str, token: str) -> list:
    try:
        r = requests.get(
            'https://api.github.com/search/repositories',
            params={'q': query, 'sort': 'updated', 'per_page': 5},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        return [{'name': i['full_name'], 'desc': i.get('description', ''),
                 'url': i['html_url'], 'stars': i.get('stargazers_count', 0)}
                for i in r.json().get('items', [])]
    except Exception as e:
        return [{'error': str(e)}]


def gh_search_issues(query: str, token: str) -> list:
    try:
        r = requests.get(
            'https://api.github.com/search/issues',
            params={'q': query, 'sort': 'updated', 'per_page': 5},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        return [{'title': i['title'], 'url': i['html_url'],
                 'body': (i.get('body') or '')[:300]}
                for i in r.json().get('items', [])]
    except Exception as e:
        return [{'error': str(e)}]


def css_block(path: str) -> str:
    """Return the first <style>…</style> block in an HTML file."""
    content = open(path).read()
    m = re.search(r'<style>([\s\S]*?)</style>', content)
    return m.group(1)[:10000] if m else content[:10000]


def gha_output(key: str, value: str) -> None:
    """Write a key=value pair to $GITHUB_OUTPUT (no-op outside GHA)."""
    out = os.environ.get('GITHUB_OUTPUT', '')
    if out:
        safe = value.replace('\n', ' ').replace('%', '%25')
        with open(out, 'a') as f:
            f.write(f'{key}={safe}\n')


# ── Research ─────────────────────────────────────────────────────────────────

def run_research() -> None:
    design_md = open('DESIGN.md').read()
    token     = os.environ.get('GITHUB_TOKEN', '')

    sources = {
        'cc_docs':     fetch('https://docs.anthropic.com/en/docs/claude-code/overview', 3000),
        'cc_hooks':    fetch('https://docs.anthropic.com/en/docs/claude-code/hooks', 2000),
        'anth_news':   fetch('https://www.anthropic.com/news', 2000),
        'design_blog': fetch('https://claude.com/blog/improving-frontend-design-through-skills', 2000),
        'mcp_market':  fetch('https://mcpmarket.com/tools/skills', 2000),
        'gh_repos':    gh_search('claude-code design skill UI frontend', token),
        'gh_issues':   gh_search_issues('claude code design UI improvement in:title,body', token),
    }

    prompt = f"""You are the STORMFEA design research agent. Research UI/UX improvements for a
vanilla-JS engineering analysis tool that must feel like a precision instrument panel, not a web app.

STORMFEA DESIGN RULES (must be respected — never suggest anything that breaks these):
{design_md}

GATHERED SOURCES — {TODAY}:

=== Claude Code Docs (Overview) ===
{sources['cc_docs']}

=== Claude Code Docs (Hooks) ===
{sources['cc_hooks']}

=== Anthropic News ===
{sources['anth_news']}

=== Claude Design Skills Blog ===
{sources['design_blog']}

=== MCP Market (skills) ===
{sources['mcp_market']}

=== GitHub repos: claude-code design skill UI ===
{json.dumps(sources['gh_repos'], indent=2)}

=== GitHub issues: claude code design UI improvement ===
{json.dumps(sources['gh_issues'], indent=2)}

Write the weekly digest below. Output NOTHING outside this block.

## Design Research — {TODAY}

### Videos & Tutorials
[bullet list, or "Nothing new this week."]

### Anthropic / Claude Code Updates
[new features, tools, or capabilities relevant to STORMFEA's design quality, or "No notable updates."]

### GitHub & MCP Market Finds
[repos, skills, or MCP servers worth noting with one-line descriptions, or "Nothing new."]

### Actionable for STORMFEA
[Numbered list. Each item must be a CONCRETE, SAFE CSS change:
  - Name the exact CSS property and selector
  - State the current value and the proposed value
  - Cite the DESIGN.md rule it satisfies
  - Assess risk (low / medium — skip anything high-risk)
If no new insights: "1. No new actions this week — design system is current."]
"""

    resp = client.messages.create(
        model=HAIKU, max_tokens=1600,
        messages=[{'role': 'user', 'content': prompt}],
    )
    digest = resp.content[0].text.strip()

    with open('DESIGN_RESEARCH.md', 'a') as f:
        f.write(f'\n{digest}\n\n---\n')

    print(digest)


# ── Implement ─────────────────────────────────────────────────────────────────

def run_implement() -> None:
    design_md = open('DESIGN.md').read()
    research  = open('DESIGN_RESEARCH.md').read()

    # Most recent entry = last non-empty section between --- dividers
    parts  = [p.strip() for p in research.split('---') if p.strip()]
    latest = parts[-1] if parts else ''

    current_css = css_block('client/index.html')

    prompt = f"""You implement one CSS improvement to STORMFEA's index.html.

DESIGN RULES:
{design_md}

LATEST RESEARCH:
{latest}

CURRENT CSS (<style> block from client/index.html):
{current_css}

TASK: Pick the single most impactful LOW-RISK CSS change from the actionable list.
"Low-risk" means: adding a new rule, tweaking a colour token, tightening letter-spacing,
adjusting padding via a variable — NOT restructuring layout, NOT changing display types,
NOT touching JS or HTML.

If the actionable list says "No new actions this week" or contains only medium/high-risk
changes, output exactly (raw JSON, no markdown):
{{"skip": true}}

Otherwise output ONLY valid JSON (no markdown fences, no prose before or after):
{{
  "description": "≤10 words: what this change does",
  "old_text": "exact string to find — copy character-perfect from the CSS above,
               include 3 full lines of surrounding context so it is unique in the file",
  "new_text": "replacement string — same surrounding context, only the changed part differs"
}}

CRITICAL: old_text will be used in a Python str.replace(). It must match the source exactly,
including whitespace and newlines. When in doubt, include more context, not less.
"""

    resp = client.messages.create(
        model=SONNET, max_tokens=900,
        messages=[{'role': 'user', 'content': prompt}],
    )
    raw = resp.content[0].text.strip()

    # Strip markdown fences if present
    if '```' in raw:
        m = re.search(r'```(?:json)?\s*([\s\S]+?)\s*```', raw)
        if m:
            raw = m.group(1).strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f'JSON parse error: {e}\nRaw output:\n{raw}')
        gha_output('skip', 'true')
        return

    if result.get('skip'):
        print('No improvement to implement this week.')
        gha_output('skip', 'true')
        return

    description = result.get('description', 'CSS improvement')
    old_text    = result['old_text']
    new_text    = result['new_text']

    with open('client/index.html') as f:
        content = f.read()

    if old_text not in content:
        print('ERROR: old_text not found in file — skipping.')
        print(f'--- old_text ---\n{old_text}\n---')
        gha_output('skip', 'true')
        return

    new_content = content.replace(old_text, new_text, 1)
    with open('client/index.html', 'w') as f:
        f.write(new_content)

    print(f'Applied: {description}')
    gha_output('skip',        'false')
    gha_output('description', description)


# ── Entry point ───────────────────────────────────────────────────────────────

COMMANDS = {'research': run_research, 'implement': run_implement}

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'research'
    if cmd not in COMMANDS:
        print(f'Unknown command: {cmd}. Options: research | implement', file=sys.stderr)
        sys.exit(1)
    COMMANDS[cmd]()
