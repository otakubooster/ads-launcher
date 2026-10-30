/** An ad account as the scope switcher sees it: Brand ▸ Market ▸ Ad account. */
export type ScopeAccount = {
  id: string;
  name: string;
  brand: string;
  market: string;
};

/** An empty selection means "All accounts". */
export function scopeLabel(accounts: ScopeAccount[], selectedIds: string[]) {
  if (selectedIds.length === 0) return "All accounts";
  if (selectedIds.length === 1) {
    const a = accounts.find((x) => x.id === selectedIds[0]);
    return a ? `${a.brand} ▸ ${a.market} ▸ ${a.name}` : "1 account";
  }
  const brands = new Set(accounts.filter((a) => selectedIds.includes(a.id)).map((a) => a.brand));
  const [onlyBrand] = brands;
  if (brands.size === 1 && onlyBrand) return `${onlyBrand} ▸ ${selectedIds.length} accounts`;
  return `${selectedIds.length} accounts`;
}

export function groupByBrand(accounts: ScopeAccount[]) {
  const groups = new Map<string, ScopeAccount[]>();
  for (const a of accounts) groups.set(a.brand, [...(groups.get(a.brand) ?? []), a]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
