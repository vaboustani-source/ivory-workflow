import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Inline atom node that represents a {placeholder} token.
 * - Renders as a styled gold pill in the editor.
 * - Serializes to HTML as the literal "{key}" text wrapped in a span with
 *   data-placeholder, so the substitution engine can find/replace it
 *   AND so re-loading the HTML re-creates the pill (via parseHTML).
 *
 * The inputRule auto-converts typed "{some_key}" into a pill.
 */
export interface PlaceholderNodeAttrs {
  key: string;
}

export const PlaceholderNode = Node.create({
  name: "placeholder",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-placeholder-key") || (el.textContent || "").replace(/[{}]/g, "").trim(),
        renderHTML: (attrs) => ({ "data-placeholder-key": attrs.key }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-placeholder-key]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const key = (node.attrs as PlaceholderNodeAttrs).key;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-placeholder-key": key,
        class: "contract-placeholder-pill",
        style: "background:#d4a437;color:#fff;padding:1px 8px;border-radius:999px;font-style:italic;font-family:'Playfair Display',serif;font-size:0.9em;",
      }),
      `{${key}}`,
    ];
  },

  renderText({ node }) {
    return `{${(node.attrs as PlaceholderNodeAttrs).key}}`;
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("placeholderInputDetect"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          let modified = false;
          newState.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            const re = /\{([a-z_][a-z0-9_]*)\}/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(node.text)) !== null) {
              const from = pos + m.index;
              const to = from + m[0].length;
              tr.replaceWith(from, to, type.create({ key: m[1] }));
              modified = true;
              // Re-traverse from start; positions shifted.
              return false;
            }
          });
          return modified ? tr : null;
        },
      }),
    ];
  },
});
