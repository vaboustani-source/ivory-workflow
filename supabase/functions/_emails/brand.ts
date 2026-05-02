// Shared brand tokens for all transactional emails.
// Single source of truth — change colors/fonts/studio name here and every
// email reflects it on next deploy.

export const BRAND = {
  // Colors
  cream: "#F5EDE6",
  blush: "#F2DCDC",
  burgundy: "#6B1F2A",
  plum: "#4A1F3D",
  magenta: "#C5266F",
  gold: "#B8924A",
  sage: "#5A7A4A",
  textPrimary: "#2A1820",
  textSecondary: "#7A6B70",
  hairline: "#E8DAD9",

  // Layout
  emailMaxWidth: 600,
  contentPadding: 40,

  // Brand
  studioName: "Stories by Victoria",
  studioMonogram: "SBV",
  fromName: "Stories by Victoria",
  fromEmail: "hello@mail.victoriaboustani.com",
  studioWebsite: "https://victoriaboustani.com",

  // Fonts
  fontHeadingsUrl:
    "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&display=swap",
  fontBodyUrl:
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap",
  fontHeadings: "'Playfair Display', Georgia, serif",
  fontBody: "'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif",
};
