import { normalizeCatalogText } from "./productInterpreter";

export const IDENTIFIER_TYPES = Object.freeze({
  SKU: "sku",
  BARCODE: "barcode",
  SUPPLIER_CODE: "supplier_code",
  INTERNAL_CODE: "internal_code",
});

export async function resolveProductByIdentifier({
  supabase,
  identifierType,
  identifierValue,
  name,
  price = 0,
  category = null,
  barcode = null,
}) {
  if (!supabase) throw new Error("Supabase client é obrigatório.");

  const type = normalizeCatalogText(identifierType).replace(/\s+/g, "_");
  const value = String(identifierValue ?? "").trim();

  if (!type || !value) {
    throw new Error("Tipo e valor do identificador são obrigatórios.");
  }

  const { data, error } = await supabase.rpc("resolve_or_create_product_identifier", {
    p_identifier_type: type,
    p_identifier_value: value,
    p_name: name?.trim() || null,
    p_price: Number.isFinite(Number(price)) ? Number(price) : 0,
    p_category: category?.trim() || null,
    p_barcode: barcode?.trim() || null,
  });

  if (error) throw error;
  return data;
}
