import sanitizeHtml from "sanitize-html";

/**
 * Strips ALL HTML tags and returns plain text.
 * Use for chat messages, forum posts, profile bios, photo captions,
 * family tree names, activity messages, etc.
 */
export function sanitizeText(input) {
  if (input === null || input === undefined) return "";
  const value = String(input);
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "recursiveEscape"
  }).trim();
}

/**
 * Allows a safe HTML subset: bold, italic, underline, links, lists,
 * line breaks, paragraphs, and headings.
 * Use for rich text content like email broadcasts.
 */
export function sanitizeHtmlContent(input) {
  if (input === null || input === undefined) return "";
  const value = String(input);
  return sanitizeHtml(value, {
    allowedTags: [
      "b", "i", "em", "strong", "u", "a",
      "ul", "ol", "li",
      "p", "br",
      "h1", "h2", "h3", "h4",
      "blockquote"
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" })
    }
  }).trim();
}
