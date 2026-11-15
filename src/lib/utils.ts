import { createCn } from "cn/config";

export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["title-lg", "title", "heading", "body", "callout", "footnote", "caption"] }] } },
});
