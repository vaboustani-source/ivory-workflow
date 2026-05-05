export type ContractorRole =
  | "second_shooter"
  | "associate_photographer"
  | "videographer"
  | "second_videographer"
  | "photo_assistant";

export const CONTRACTOR_ROLES: { value: ContractorRole; label: string }[] = [
  { value: "second_shooter", label: "Second Shooter" },
  { value: "associate_photographer", label: "Associate Photographer" },
  { value: "videographer", label: "Videographer" },
  { value: "second_videographer", label: "Second Videographer" },
  { value: "photo_assistant", label: "Photo Assistant" },
];

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return CONTRACTOR_ROLES.find((r) => r.value === role)?.label ?? role;
}

export type ServiceRequestStatus =
  | "sent"
  | "accepted"
  | "declined"
  | "no_response"
  | "cancelled"
  | "booked";

/** Haversine distance in miles between two lat/lng pairs. */
export function milesBetween(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
