# Security Policy

## Reporting a Vulnerability

STORMFEA runs as a local server on your own machine and is not designed to be exposed to the internet. It has no authentication, no user accounts, and no cloud backend.

That said, if you find a security issue — particularly one that could affect users who expose the server on a local network (e.g., in a school lab or team setting) — please report it privately rather than opening a public issue.

**Email:** micah.t.stoll@gmail.com  
**Subject line:** `[STORMFEA SECURITY]`

Include:
- A description of the issue and the potential impact
- Steps to reproduce (or a proof-of-concept if you have one)
- Your suggested fix, if any

You'll get a response within 7 days. If the issue is confirmed, a fix will be released and you'll be credited in the changelog unless you prefer to stay anonymous.

## Scope

| Area | In scope |
|------|----------|
| Local server (Express routes, file upload handling) | Yes |
| Solver / analysis pipeline | Yes if reachable from the network |
| Client-side PDF generation | Yes |
| Onshape API credential handling | Yes |
| Third-party dependencies (TetGen, Gmsh) | No — report upstream |

## Supported Versions

Only the latest release on `main` receives security fixes.
