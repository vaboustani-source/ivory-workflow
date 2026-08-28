// Shared brand tokens for all transactional emails.
// Single source of truth — change colors/fonts/studio name here and every
// email reflects it on next deploy.

export const BRAND = {
  // Colors
  cream: "#F6EFE3",
  blush: "#F9E7EE",
  burgundy: "#4A1D31",
  plum: "#411928",
  magenta: "#B41E64",
  gold: "#C9A24A",
  sage: "#4C6B2B",
  textPrimary: "#2A1A22",
  textSecondary: "#7C6A72",
  hairline: "#E7DCD2",

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
