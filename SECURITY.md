# Security Policy

## Supported Versions

Security fixes are applied to the current `main` branch and deployed through the existing Vercel and Render production projects.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. Report it privately through GitHub Security Advisories when available, or contact the repository owner directly with:

- A short description of the issue and affected area.
- Steps to reproduce or proof-of-concept details.
- Any known impact, affected environment, or suggested remediation.

Expect an initial acknowledgement within 72 hours. Valid reports will be triaged by severity, fixed on a private or short-lived branch, and disclosed after the fix is released.

## Security Expectations

- Never commit real `.env` files, Supabase service role keys, Groq API keys, admin secrets, or deploy tokens.
- Keep scoring and answer resolution server-authoritative.
- Treat lobby codes, reconnect flows, admin routes, and live race-feed ingestion as security-sensitive surfaces.
- Run dependency audits, CodeQL, and secret scanning before merging changes into `main`.
