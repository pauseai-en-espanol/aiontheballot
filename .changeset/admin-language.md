---
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/e2e': minor
---

A language switch at the foot of every admin page (PLAN R108): English or Spanish, kept in a preference cookie on the
admin host, over the browser's language, which still decides until someone chooses. With scripts, the page redraws in
place and keeps what was typed. The accessibility check waits for a page redrawn after a save to get its title back.
