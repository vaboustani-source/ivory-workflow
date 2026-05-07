// Helpers for assembling display names from split first/last name columns.

export function fullName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ");
}

export function coupleFullNames(
  first1?: string | null,
  last1?: string | null,
  first2?: string | null,
  last2?: string | null,
): string {
  const a = fullName(first1, last1);
  const b = fullName(first2, last2);
  return [a, b].filter(Boolean).join(" & ");
}
