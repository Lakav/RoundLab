export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function zoneLabel(
  zoneId: string,
  labels: Record<string, string> | undefined,
): string {
  return labels?.[zoneId] ?? zoneId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function teamLabel(name: string): string {
  if (name.startsWith("team_")) return `Équipe ${name.slice(5)}`;
  return name;
}

export function performanceColor(value: number | null): string {
  if (value === null) return "text-neutral-500";
  if (value >= 1.1) return "text-emerald-300";
  if (value < 0.8) return "text-rose-300";
  return "text-neutral-200";
}

export function mostFrequent(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]?.[0] ?? null;
}

export function weaponLabel(weapon: string | null): string {
  if (weapon === null) return "—";
  return weapon.replace(/^weapon_/, "").replaceAll("_", " ").toUpperCase();
}

export function number(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function ratio(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

export function economyLabel(category: string | null): string {
  if (category === "eco") return "Eco";
  if (category === "force_buy") return "Force-buy";
  if (category === "full_buy") return "Full-buy";
  return "Indisponible";
}
