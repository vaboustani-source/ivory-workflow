// Shared prose styles for resource content, used by the couple portal
// reader and the studio admin preview. Near-double-spaced, editorial rhythm.
export const RESOURCE_PROSE_CSS = `
.resource-prose {
  color: var(--foreground);
  font-size: 17px;
  line-height: 2.0;
}
.resource-prose > * + * { margin-top: 2.1em; }
.resource-prose > *:first-child { margin-top: 0.5em; }
.resource-prose h1, .resource-prose h2, .resource-prose h3, .resource-prose h4 {
  font-family: 'Playfair Display', Georgia, serif;
  color: var(--primary);
  line-height: 1.25;
  margin-top: 4em;
  margin-bottom: 1.1em;
  font-style: italic;
}
.resource-prose > h1:first-child,
.resource-prose > h2:first-child,
.resource-prose > h3:first-child,
.resource-prose > h4:first-child { margin-top: 0.5em; }
.resource-prose h1 { font-size: 28px; }
.resource-prose h2 { font-size: 24px; }
.resource-prose h3 { font-size: 20px; }
.resource-prose h4 { font-size: 18px; }
.resource-prose p { margin: 1.4em 0; }
.resource-prose strong { color: var(--primary); font-weight: 600; }
.resource-prose a { color: var(--magenta); text-decoration: underline; text-underline-offset: 3px; }
.resource-prose ul, .resource-prose ol {
  margin: 2em 0;
  padding-left: 1.4em;
}
.resource-prose li { margin: 1.05em 0; padding-left: 0.25em; line-height: 1.85; }
.resource-prose ul li::marker { color: var(--gold); }
.resource-prose ol li::marker { color: var(--gold); font-weight: 600; }
.resource-prose blockquote {
  margin: 3em 0;
  padding: 1.5em 1.7em;
  background: var(--background-alt);
  border-left: 3px solid var(--gold);
  border-radius: 6px;
  font-style: normal;
  color: var(--foreground);
}
.resource-prose blockquote p { margin: 0.6em 0; }
.resource-prose blockquote p:first-child { margin-top: 0; }
.resource-prose blockquote p:last-child { margin-bottom: 0; }
.resource-prose hr {
  border: none;
  border-top: 1px solid color-mix(in oklab, var(--gold) 35%, transparent);
  margin: 4em auto;
  width: 60%;
}
.resource-prose img { border-radius: 8px; margin: 1.5em 0; max-width: 100%; height: auto; }
.resource-prose code {
  background: var(--background-alt);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.92em;
}
`;
