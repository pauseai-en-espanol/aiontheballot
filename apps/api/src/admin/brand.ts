import type { DB } from '@aiontheballot/db/generated/db';

import { BRAND_SLOTS } from '@aiontheballot/domain/public-home';
import { sql, type Transaction } from 'kysely';

import { dropFileIfUnnamed, type LogoUpload, storeLogoFile } from './structure.js';

/** The slots a site's brand images fill (R59, R72), in the order its settings show them. */
export const BRAND_SLOT_NAMES: readonly string[] = Object.values(BRAND_SLOTS);

/**
 * One slot of a site's brand images, as its settings show it (admin forms §2, settings; PLAN R195): the site's own
 * upload, which members see through the site's images route, or an image of the platform's catalogue, named, or none.
 */
export interface BrandSlot {
  slot: string;
  file: { id: string; contentType: string } | null;
  /** A platform image the slot names (its name, empty if RLS hides it), set by the platform. */
  asset: { name: string } | null;
}

/** The site's brand images, slot by slot, read under RLS (any member). */
export const listBrand = async (trx: Transaction<DB>, tenantId: string): Promise<BrandSlot[]> => {
  const rows = await trx
    .selectFrom('app.tenant_brand_selections as s')
    .leftJoin('app.files as f', 'f.id', 's.file_id')
    .leftJoin('app.brand_assets as a', 'a.id', 's.brand_asset_id')
    .select(['s.slot', 'f.id as file_id', 'f.content_type', 's.brand_asset_id', 'a.name'])
    .where('s.tenant_id', '=', tenantId)
    .where('s.slot', 'in', BRAND_SLOT_NAMES)
    .execute();
  return BRAND_SLOT_NAMES.map((slot) => {
    const row = rows.find((candidate) => candidate.slot === slot);
    return {
      slot,
      file:
        row?.file_id && row.content_type
          ? { id: row.file_id, contentType: row.content_type }
          : null,
      asset: row?.brand_asset_id ? { name: row.name ?? '' } : null,
    };
  });
};

/**
 * Sets a slot of the site's brand images to an upload whose bytes the caller stored first in the site's public assets,
 * or empties it (`null`). Only the site's country admins and platform admins may (RLS on the selections). The file a
 * slot named before goes if nothing else names it, as a replaced party logo's does; a platform image it named stays.
 * The public site serves the new one at once (`public_read`: a file an active site selects). 'otherType' when those
 * bytes are already the site's file of another type.
 */
export const setBrandImage = async (
  trx: Transaction<DB>,
  tenantId: string,
  slot: string,
  upload: LogoUpload | null,
): Promise<'changed' | 'otherType' | 'platformImage'> => {
  const current = await trx
    .selectFrom('app.tenant_brand_selections')
    .select(['file_id', 'brand_asset_id'])
    .where('tenant_id', '=', tenantId)
    .where('slot', '=', slot)
    .forUpdate()
    .executeTakeFirst();
  // A slot the platform filled with one of its images is replaced by an upload of the site's own, never emptied here.
  if (!upload && current?.brand_asset_id) {
    return 'platformImage';
  }
  let fileId: string | null = null;
  if (upload) {
    const stored = await storeLogoFile(trx, tenantId, upload);
    if (!stored) {
      return 'otherType';
    }
    fileId = stored;
    await sql`
      INSERT INTO app.tenant_brand_selections (tenant_id, slot, file_id)
      VALUES (${tenantId}, ${slot}, ${fileId})
      ON CONFLICT (tenant_id, slot) DO UPDATE SET file_id = EXCLUDED.file_id, brand_asset_id = NULL`.execute(
      trx,
    );
  } else {
    await trx
      .deleteFrom('app.tenant_brand_selections')
      .where('tenant_id', '=', tenantId)
      .where('slot', '=', slot)
      .execute();
  }
  if (current?.file_id && current.file_id !== fileId) {
    await dropFileIfUnnamed(trx, current.file_id);
  }
  return 'changed';
};
