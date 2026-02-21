# Security

## Dependabot: jsonpath (frontend)

**Alert:** jsonpath – Arbitrary Code Injection (GHSA-87r5-mp6g-5w5j)  
**Status:** Acknowledged, no fix available.

`jsonpath` is a **transitive build-only** dependency: `react-scripts` → webpack → `bfj` → `jsonpath`. It is not used at runtime and does not process untrusted input in this project. The maintainers have not released a patched version; the recommended alternative (`jsonpath-plus`) is not API-compatible with `bfj`.

You may **dismiss** this Dependabot alert in GitHub (Security → Dependabot alerts) with the reason **“No fix available”** or **“Vulnerability is in a non-used path.”**
