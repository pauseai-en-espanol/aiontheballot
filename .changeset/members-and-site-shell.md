---
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/e2e': minor
---

Choosing a site and managing its members (editorial workflow A6, A7; PLAN R94–R98). After sign-in, a member of one
site lands on its dashboard and anyone else on the site list; every site screen has a shell with a site switcher and
its sections. The members screen shows everyone's names and roles, emails only to country and platform admins, and lets
them remove a role (never the site's last country admin) or give a member another. New API routes: `GET /api/t/:tenant`,
`GET /api/t/:tenant/members`, `POST /api/t/:tenant/members/:userId/roles` and
`DELETE /api/t/:tenant/members/:userId/roles/:role`; `GET /api/tenants` also says whether the user is a platform admin.
