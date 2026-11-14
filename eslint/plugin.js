import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");

const rel = (filename) => path.relative(ROOT, filename).split(path.sep).join("/");

const GAMES = fs
  .readdirSync(path.join(ROOT, "src/games"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const REGISTRIES = new Set([
  "convex/games.ts",
  "convex/previews.ts",
  "convex/modes.ts",
  "convex/schema.ts",
  "convex/testing.ts",
  "convex/crons.ts",
  "convex/http.ts",
  "src/games/index.tsx",
  "src/App.tsx",
  "og/server.mjs",
]);

const isTest = (file) => /\.(test|spec)\.tsx?$/.test(file) || file.startsWith("e2e/") || file.startsWith("scripts/");

const gameOf = (file) => {
  for (const g of GAMES) {
    if (file.startsWith(`src/games/${g}/`)) return g;
    if (file === `convex/${g}.ts` || file.startsWith(`convex/${g}/`)) return g;
    if (file.startsWith(`og/games/${g}.`)) return g;
    if (new RegExp(`^convex/${g}[A-Z.][^/]*\\.test\\.ts$`).test(file)) return g;
    if (new RegExp(`^e2e/${g}[-.][^/]*$`).test(file)) return g;
  }
  return null;
};

const resolveImport = (fromFile, source) => {
  if (source.startsWith("@/")) return `src/${source.slice(2)}`;
  if (!source.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source));
};

const withExt = (target) => {
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) {
    const full = path.join(ROOT, target + ext);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return target + ext;
  }
  return target;
};

const serverOnlyCache = new Map();
const isConvexFunctionFile = (file) => {
  if (!file.startsWith("convex/") || file.startsWith("convex/_generated/")) return false;
  if (serverOnlyCache.has(file)) return serverOnlyCache.get(file);
  let text = "";
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    text = "";
  }
  const result = /from "(\.\.?\/)+_generated\/server"|from "convex\/server"|^"use node"/m.test(text);
  serverOnlyCache.set(file, result);
  return result;
};

const COMMENT_DIRECTIVE = /^\s*(platform:|@vite-ignore|[#@]__PURE__|@refresh|webpackChunkName|\/ <reference)/;

const noComments = {
  meta: {
    type: "problem",
    messages: {
      comment:
        "No comments. Say it with names, types and tests; put lasting knowledge in the game's skill (.agents/skills/game-<name>/SKILL.md) or AGENTS.md. Only a constraint forced on us by something we can't change (iOS, Android, Convex, Yahoo, a library) may stay, written as `// platform: ...`.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          if (COMMENT_DIRECTIVE.test(comment.value)) continue;
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
};

const COLOR_WORDS =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const TW_COLOR = new RegExp(
  `^(?:-?)(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|fill|stroke|from|via|to|shadow|outline|decoration|accent|caret|divide|placeholder|inset-shadow|drop-shadow)-(?:${COLOR_WORDS})(?:-\\d{2,3})?(?:\\/\\d+)?$`,
);
const HEX = /(?:^|[^&\w/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const NAMED = new Set(
  "red orange yellow green blue purple pink brown black white gray grey cyan magenta gold silver navy teal lime maroon olive aqua fuchsia crimson coral salmon khaki ivory beige tan orchid plum violet indigo turquoise".split(
    " ",
  ),
);
const COLOR_ATTRS = new Set(["fill", "stroke", "color", "stopColor", "floodColor", "lightingColor", "backgroundColor"]);
const COLOR_KEY = /(color|background|fill|stroke|border|shadow|outline|style)$/i;
const SAFE_VALUE = /^(none|currentColor|transparent|inherit|initial|unset)$/;

const isPalette = (file) => /(^|\/)palette\.(ts|tsx|mjs|js)$/.test(file) || file === "src/themes.ts";

const classTokens = (text) => text.split(/\s+/).filter(Boolean);
const stripVariants = (token) => {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) last = i;
  }
  return token
    .slice(last + 1)
    .replace(/^!/, "")
    .replace(/!$/, "");
};
const looksLikeClasses = (text) => {
  const tokens = classTokens(text);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => /^[!\-\w[\]&>:_/.%()#,=*@'"+~]+$/.test(t))) return false;
  return tokens.filter((t) => t.includes("-") || t.includes(":")).length * 2 >= tokens.length;
};

const stringsOf = (node) => {
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? q.value.raw);
  return [];
};

const noRawColor = {
  meta: {
    type: "problem",
    messages: {
      raw: "Raw color `{{value}}`. Colors come from the theme: a token like `bg-card`, `text-muted-foreground` or `var(--tile-green)` (add tokens in scripts/gen-themes.py and src/style.css). Fixed colors that must not follow the theme (a physical board, a canvas) live in that game's palette.ts and are imported from there.",
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (isPalette(file) || /\.test\.ts$/.test(file)) return {};
    const report = (node, value) => context.report({ node, messageId: "raw", data: { value: value.slice(0, 40) } });
    const check = (node) => {
      for (const text of stringsOf(node)) {
        const hex = text.match(HEX);
        if (hex) return report(node, hex[0].trim());
        const fn = text.match(COLOR_FN);
        if (fn) return report(node, fn[0]);
        if (looksLikeClasses(text)) {
          const bad = classTokens(text)
            .map(stripVariants)
            .find((t) => TW_COLOR.test(t));
          if (bad) return report(node, bad);
        }
      }
    };
    const namedIn = (valueNode) => {
      if (valueNode?.type === "Literal" && typeof valueNode.value === "string") {
        const v = valueNode.value.trim();
        if (NAMED.has(v.toLowerCase()) && !SAFE_VALUE.test(v)) report(valueNode, v);
      }
    };
    return {
      Literal: check,
      TemplateLiteral: check,
      JSXAttribute(node) {
        if (node.name.type === "JSXIdentifier" && COLOR_ATTRS.has(node.name.name)) {
          const v = node.value?.type === "JSXExpressionContainer" ? node.value.expression : node.value;
          namedIn(v);
        }
      },
      Property(node) {
        const key = node.key.type === "Identifier" ? node.key.name : typeof node.key.value === "string" ? node.key.value : "";
        if (COLOR_KEY.test(key)) namedIn(node.value);
      },
      AssignmentExpression(node) {
        if (
          node.left.type === "MemberExpression" &&
          node.left.property.type === "Identifier" &&
          /^(fillStyle|strokeStyle|shadowColor)$/.test(node.left.property.name)
        ) {
          namedIn(node.right);
        }
      },
    };
  },
};

const UI_DIR = "src/components/ui/";

const noRawButton = {
  meta: {
    type: "problem",
    messages: {
      button:
        "No naked <{{tag}}>. Use `Button` or `IconButton` from @/components/ui/button (or a shared part built on them: AsyncButton, ConfirmButton, ListRow, FloatButton). If none fits, add a variant or size to src/components/ui/button.tsx instead of styling a raw element.",
      role: 'No `role="button"` on a plain element. Use `Button` or `IconButton` from @/components/ui/button.',
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (file.startsWith(UI_DIR) || file.startsWith("prototypes/")) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const tag = node.name.name;
        if (tag === "button") return context.report({ node, messageId: "button", data: { tag } });
        const attr = (name) => node.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);
        if (tag === "input") {
          const type = attr("type")?.value;
          if (type?.type === "Literal" && /^(button|submit|reset)$/.test(type.value))
            context.report({ node, messageId: "button", data: { tag: `input type="${type.value}"` } });
        }
        const role = attr("role")?.value;
        if (/^[a-z]/.test(tag) && role?.type === "Literal" && role.value === "button") context.report({ node, messageId: "role" });
      },
    };
  },
};

const AVATAR_FILES = new Set(["src/components/PlayerAvatar.tsx", "src/components/PlayerCard.tsx"]);
const FACE_SOURCE = /\b(image|avatar|picture|photo|pfp|face)\b|discordapp|cdn\.discord/i;

const noRawAvatar = {
  meta: {
    type: "problem",
    messages: {
      avatar:
        "Show a person with `PlayerAvatar` (or `AvatarStack`, `PlayerCard`) from @/components, never a raw <img> or background image: it carries their frame, color ring, glow, badge and online dot.",
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (AVATAR_FILES.has(file)) return {};
    const source = context.sourceCode;
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "img") return;
        const src = node.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === "src");
        if (src?.value && FACE_SOURCE.test(source.getText(src.value))) context.report({ node, messageId: "avatar" });
      },
      Property(node) {
        const key = node.key.type === "Identifier" ? node.key.name : node.key.value;
        if (
          (key === "backgroundImage" || key === "background") &&
          /url\(/.test(source.getText(node.value)) &&
          FACE_SOURCE.test(source.getText(node.value))
        ) {
          context.report({ node, messageId: "avatar" });
        }
      },
    };
  },
};

const RADIUS_SIZES = new Set(["xs", "sm", "md", "lg", "3xl", "full", "none"]);
const TYPE_SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[[\d.]+(px|rem|em)\])$/;
const RADIUS = /^rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-(.+))?$/;

const designTokens = {
  meta: {
    type: "problem",
    messages: {
      type: "`{{token}}` isn't one of the 7 type sizes: text-title-lg, text-title, text-heading, text-body, text-callout, text-footnote, text-caption.",
      radius:
        "`{{token}}` isn't one of the radius steps: rounded-sm (8), rounded-md (12), rounded-lg (16), rounded-3xl (28), rounded-full for avatars, chips and icon buttons, and rounded-xs (3) only for cells and pieces on a board.",
      sticky:
        "Nothing `sticky` to the top: iOS 26 blurs the band under the status bar, and text pinned there is unreadable. Keep headers in the flow below TOP_CLEAR.",
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (!file.startsWith("src/")) return {};
    const check = (node) => {
      for (const text of stringsOf(node)) {
        if (!looksLikeClasses(text)) continue;
        const tokens = classTokens(text).map(stripVariants);
        if (tokens.includes("sticky") && tokens.some((t) => /^-?top-/.test(t))) context.report({ node, messageId: "sticky" });
        for (const token of tokens) {
          if (TYPE_SIZE.test(token)) context.report({ node, messageId: "type", data: { token } });
          const r = token.match(RADIUS);
          if (r && !RADIUS_SIZES.has(r[1] ?? "")) context.report({ node, messageId: "radius", data: { token } });
        }
      }
    };
    return { Literal: check, TemplateLiteral: check };
  },
};

const packageBoundaries = {
  meta: {
    type: "problem",
    messages: {
      crossGame:
        "{{from}} can't import {{to}}'s code ({{source}}). Each game is its own package; lift what both need into convex/lib, src/components or src/lib.",
      sharedToGame:
        "Shared code can't depend on a game ({{source}} is {{to}}'s). Move this into the game's package, or register the game in one of the registries (convex/games.ts, convex/previews.ts, src/games/index.tsx...).",
      serverValue:
        "{{source}} is a Convex function file (it imports _generated/server), so the app can only import types from it (`import type`). Move what the phone needs into a pure module (convex/lib or the game's folder) that both sides import.",
      engineImpure:
        "{{source}} pulls server code into a pure game module. Files in convex/<game>/ are shared with phones: no Convex server imports, no browser APIs.",
    },
  },
  create(context) {
    const file = rel(context.filename);
    const from = gameOf(file);
    const test = isTest(file);
    const registry = REGISTRIES.has(file);
    const pureEngine = from && file.startsWith(`convex/${from}/`) && !test;
    const check = (node, source, typeOnly) => {
      if (typeof source !== "string") return;
      const resolved = resolveImport(file, source);
      if (!resolved) return;
      const target = withExt(resolved);
      const to = gameOf(target);
      if (!test && !registry && to && from && to !== from) context.report({ node, messageId: "crossGame", data: { from, to, source } });
      if (!test && !registry && to && !from) context.report({ node, messageId: "sharedToGame", data: { to, source } });
      if (!typeOnly && file.startsWith("src/") && isConvexFunctionFile(target))
        context.report({ node, messageId: "serverValue", data: { source } });
      if (
        !typeOnly &&
        pureEngine &&
        (target.startsWith("convex/_generated/server") || target.startsWith("convex/lib/") || isConvexFunctionFile(target))
      ) {
        context.report({ node, messageId: "engineImpure", data: { source } });
      }
    };
    const typeOnlyImport = (node) =>
      node.importKind === "type" || (node.specifiers.length > 0 && node.specifiers.every((s) => s.importKind === "type"));
    return {
      ImportDeclaration(node) {
        check(node, node.source.value, typeOnlyImport(node));
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value, node.exportKind === "type");
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value, node.exportKind === "type");
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value, false);
      },
    };
  },
};

const noAsyncOnClick = {
  meta: {
    type: "problem",
    messages: {
      async:
        "An async tap handler can run twice on a double tap and swallow its errors. Use `AsyncButton` or `usePending` from @/components/AsyncButton.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== "onClick" || node.value?.type !== "JSXExpressionContainer") return;
        const fn = node.value.expression;
        if ((fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression") && fn.async)
          context.report({ node, messageId: "async" });
      },
    };
  },
};

const e2eWaits = {
  meta: {
    type: "problem",
    messages: {
      timeout:
        "Wait on something you can observe (`ready(page)`, `holdsStill`, `settled`, polling `getMatch`, a data-* attribute), never on time.",
      idle: "`networkidle` means nothing over a WebSocket. Wait on what the screen shows instead (`ready(page)`).",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.property.type === "Identifier" && node.property.name === "waitForTimeout") context.report({ node, messageId: "timeout" });
      },
      Literal(node) {
        if (node.value === "networkidle") context.report({ node, messageId: "idle" });
      },
    };
  },
};

const TAILWIND_AT_RULES = new Set([
  "utility",
  "keyframes",
  "theme",
  "custom-variant",
  "variant",
  "layer",
  "property",
  "font-face",
  "media",
  "supports",
  "container",
  "import",
  "source",
  "plugin",
]);

const tailwindCss = {
  meta: {
    type: "problem",
    language: "css/css",
    messages: {
      file: "The only stylesheet is src/style.css. Style with Tailwind classes in the component; put shared pieces in a component under src/components.",
      selector:
        "`{{selector}}` is a hand-written class. Style with Tailwind classes in the component. Something Tailwind can't say inline (a frame effect, a physical tile) becomes `@utility <name> { ... }`; an animation becomes `--animate-<name>` in @theme plus its @keyframes; anything interactive or interruptible uses Motion (motion/react).",
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (file !== "src/style.css") {
      return {
        StyleSheet(node) {
          context.report({ node, messageId: "file" });
        },
      };
    }
    const stack = [];
    return {
      Atrule(node) {
        stack.push(node.name);
      },
      "Atrule:exit"() {
        stack.pop();
      },
      Rule(node) {
        if (stack.some((n) => n === "utility" || n === "keyframes")) return;
        if (!stack.every((n) => TAILWIND_AT_RULES.has(n))) return;
        const selector = context.sourceCode.getText(node.prelude);
        if (/(^|[\s,>+~(])\.[a-zA-Z_-]/.test(selector.replace(/\.dark\b/g, "")))
          context.report({ node: node.prelude, messageId: "selector", data: { selector: selector.slice(0, 60) } });
      },
    };
  },
};

const SUBTEXT_PROPS = new Set(["subtitle", "subtext", "description", "caption", "helperText", "hint", "blurb", "lede", "summary"]);
const PROSE_WORDS = 3;
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const staticText = (node) => {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === "JSXExpressionContainer") return staticText(node.expression);
  return null;
};
const elementName = (node) => {
  const n = node.openingElement?.name;
  if (!n) return "";
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") return `${n.object.name}.${n.property.name}`;
  return "";
};
const attrOf = (node, name) => node.openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);
const classText = (node) => {
  const attr = attrOf(node, "className");
  if (!attr?.value) return "";
  if (attr.value.type === "Literal") return String(attr.value.value);
  const expr = attr.value.expression;
  if (!expr) return "";
  const parts = [];
  const walk = (e) => {
    if (!e) return;
    if (e.type === "Literal" && typeof e.value === "string") parts.push(e.value);
    else if (e.type === "TemplateLiteral") e.quasis.forEach((q) => parts.push(q.value.cooked ?? ""));
    else if (e.type === "CallExpression") e.arguments.forEach(walk);
    else if (e.type === "LogicalExpression" || e.type === "BinaryExpression") (walk(e.left), walk(e.right));
    else if (e.type === "ConditionalExpression") (walk(e.consequent), walk(e.alternate));
  };
  walk(expr);
  return parts.join(" ");
};
const onlyStaticText = (node) => {
  const kids = node.children.filter((c) => !(c.type === "JSXText" && c.value.trim() === ""));
  if (kids.length === 0) return null;
  if (!kids.every((c) => c.type === "JSXText" || (c.type === "JSXExpressionContainer" && staticText(c) !== null))) return null;
  return kids
    .map((c) => (c.type === "JSXText" ? c.value : staticText(c)))
    .join(" ")
    .trim();
};
const HEADING_TAG = /^h[1-6]$/;
const HEADING_COMPONENT = /(Title|Heading)$/;
const HEADING_CLASS = /(^|\s|:)(text-title-lg|text-title|text-heading)(\s|$)/;
const isHeading = (node) => {
  const name = elementName(node);
  if (/^AlertDialog/.test(name)) return false;
  return HEADING_TAG.test(name) || HEADING_COMPONENT.test(name) || HEADING_CLASS.test(classText(node));
};
const PROSE_TAGS = new Set(["p", "span", "div", "small", "li"]);
const EMPTY_STATE = /^(no|nothing|nobody|none|there (is|are) no|you (have no|haven't)|not yet)\b/i;
const DESCRIPTION_COMPONENT = /^(Drawer|Dialog|Sheet|Card)Description$/;

const noSubtext = {
  meta: {
    type: "problem",
    messages: {
      prop: "No filler subtext: `{{prop}}` is a hard-coded sentence. Say it with the title or the control. Real information (a name, a rating, a count) is fine as an expression.",
      under: 'No filler subtext under a heading: "{{text}}". The heading and the controls say it; drop the sentence.',
      empty: 'No empty-state prose ("{{text}}"). Render the section only when it has something in it.',
      description:
        'No filler description: "{{text}}". Sheets and dialogs are titled; if screen readers need a description, it must carry real information.',
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (file.startsWith(UI_DIR)) return {};
    const clip = (t) => t.replace(/\s+/g, " ").slice(0, 50);
    return {
      JSXAttribute(node) {
        if (!SUBTEXT_PROPS.has(node.name.name)) return;
        const text = staticText(node.value);
        if (text !== null && words(text) >= 2) context.report({ node, messageId: "prop", data: { prop: node.name.name } });
      },
      JSXElement(node) {
        const name = elementName(node);
        const text = onlyStaticText(node);
        if (text && DESCRIPTION_COMPONENT.test(name) && words(text) >= PROSE_WORDS) {
          context.report({ node, messageId: "description", data: { text: clip(text) } });
        }
        if (text && PROSE_TAGS.has(name) && EMPTY_STATE.test(text) && words(text) >= 2)
          context.report({ node, messageId: "empty", data: { text: clip(text) } });
        const siblings = node.children.filter((c) => c.type === "JSXElement");
        siblings.forEach((child, i) => {
          const next = siblings[i + 1];
          if (!next || !isHeading(child) || !PROSE_TAGS.has(elementName(next))) return;
          const prose = onlyStaticText(next);
          if (prose && words(prose) >= PROSE_WORDS) context.report({ node: next, messageId: "under", data: { text: clip(prose) } });
        });
      },
    };
  },
};

const CARD_COMPONENTS = new Set([
  "Group",
  "Card",
  "InviteCard",
  "PlayerCard",
  "StatCard",
  "ModeCard",
  "GameCard",
  "DeedCard",
  "HoleCard",
  "BoardCard",
]);
const isCard = (node) => {
  const name = elementName(node);
  if (CARD_COMPONENTS.has(name)) return true;
  if (name === "Button") {
    const variant = attrOf(node, "variant");
    return staticText(variant?.value) === "card";
  }
  if (!/^[a-z]/.test(name)) return false;
  const tokens = classTokens(classText(node)).map(stripVariants);
  return tokens.includes("bg-card") && tokens.some((t) => /^rounded(-|$)/.test(t) && t !== "rounded-full" && t !== "rounded-none");
};

const noNestedCards = {
  meta: {
    type: "problem",
    messages: {
      nested:
        "A card inside a card (`{{inner}}` inside `{{outer}}`). Never nest cards: make the inner one rows of the outer Group, or lift it out as its own section.",
    },
  },
  create(context) {
    const file = rel(context.filename);
    if (file.startsWith(UI_DIR)) return {};
    const stack = [];
    return {
      JSXElement(node) {
        const card = isCard(node);
        if (card && stack.length)
          context.report({
            node: node.openingElement,
            messageId: "nested",
            data: { inner: elementName(node), outer: elementName(stack[stack.length - 1]) },
          });
        if (card) stack.push(node);
      },
      "JSXElement:exit"(node) {
        if (stack[stack.length - 1] === node) stack.pop();
      },
    };
  },
};

export default {
  meta: { name: "group53" },
  rules: {
    "no-comments": noComments,
    "no-raw-color": noRawColor,
    "no-raw-button": noRawButton,
    "no-raw-avatar": noRawAvatar,
    "design-tokens": designTokens,
    "package-boundaries": packageBoundaries,
    "no-async-onclick": noAsyncOnClick,
    "e2e-waits": e2eWaits,
    "tailwind-css": tailwindCss,
    "no-subtext": noSubtext,
    "no-nested-cards": noNestedCards,
  },
};
