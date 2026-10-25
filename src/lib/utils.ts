import { createCn } from "cn/config";

// Class merging that knows the app's type scale (style.css), so `text-title` is a size, not a color, and
// replaces `text-heading` instead of knocking out `text-foreground`.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["title-lg", "title", "heading", "body", "callout", "footnote", "caption"] }] } },
});
