---
'@aiontheballot/migrations': minor
---

Add the operator's policy texts, `app.tenant_documents`: versioned per tenant and kind by trigger, drafts editable and
deletable by country admins, published versions frozen (even for the owner) and requiring text in the tenant's default
locale. The public reads published versions of active tenants.
