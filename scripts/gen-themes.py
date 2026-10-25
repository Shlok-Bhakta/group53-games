# Regenerate the theme block in src/style.css: python3 scripts/gen-themes.py > /tmp/themes.css, then paste it over the "/* Themes." section.
# Generates the theme section of src/style.css. Each theme has light and dark modes.
import sys

W = "#ffffff"
def t(bg, fg, card, primary, pfg, muted, mfg, border, green, yellow, gray, hit,
      ink=W, yink="#1f2328", gink=W, accent=None, popover=None, blank=None, edge=None, destructive=None, hink=None):
    return dict(background=bg, foreground=fg, card=card, popover=popover or card, primary=primary,
        **{"primary-foreground": pfg}, secondary=muted, **{"secondary-foreground": fg}, muted=muted,
        **{"muted-foreground": mfg}, accent=accent or muted, **{"accent-foreground": fg}, border=border,
        input=border, ring=primary, destructive=destructive or hit, **{"card-foreground": fg, "popover-foreground": fg},
        **{"tile-green": green, "tile-yellow": yellow, "tile-gray": gray, "tile-hit": hit, "tile-ink": ink,
           "tile-yellow-ink": yink, "tile-gray-ink": gink, "tile-hit-ink": hink or ink, "tile-blank": blank or card, "tile-edge": edge or border})

THEMES = {
  # Poker night: felt table, gold chips.
  "felt": (
    t("oklch(0.955 0.012 160)", "oklch(0.22 0.04 165)", "oklch(0.99 0.004 160)", "oklch(0.43 0.09 162)", "oklch(0.98 0.01 160)",
      "oklch(0.915 0.017 160)", "oklch(0.46 0.03 165)", "oklch(0.86 0.02 160)",
      "oklch(0.6 0.15 148)", "oklch(0.79 0.16 82)", "oklch(0.62 0.02 160)", "oklch(0.61 0.22 22)", blank=W, edge="oklch(0.8 0.025 160)", destructive="oklch(0.52 0.2 25)"),
    t("oklch(0.255 0.045 162)", "oklch(0.96 0.012 150)", "oklch(0.3 0.05 162)", "oklch(0.83 0.14 85)", "oklch(0.24 0.045 162)",
      "oklch(0.345 0.048 162)", "oklch(0.79 0.03 155)", "oklch(1 0 0 / 10%)",
      "oklch(0.6 0.14 148)", "oklch(0.8 0.15 82)", "oklch(0.47 0.03 160)", "oklch(0.62 0.21 22)", popover="oklch(0.32 0.05 162)", destructive="oklch(0.76 0.15 22)",
      blank="oklch(0.34 0.05 162)", edge="oklch(0.46 0.05 162)"),
  ),
  "catppuccin": (  # Latte / Mocha
    t("#e6e9ef", "#4c4f69", "#eff1f5", "#8839ef", "#eff1f5", "#dce0e8", "#5c5f77", "#ccd0da",
      "#40a02b", "#df8e1d", "#7c7f93", "#d20f39", yink="#303446", blank="#eff1f5", edge="#bcc0cc"),
    t("#181825", "#cdd6f4", "#1e1e2e", "#cba6f7", "#11111b", "#313244", "#a6adc8", "#313244",
      "#a6e3a1", "#f9e2af", "#585b70", "#f38ba8", ink="#11111b", yink="#11111b", gink="#cdd6f4", popover="#313244",
      blank="#313244", edge="#45475a"),
  ),
  "gruvbox": (
    t("#f2e5bc", "#3c3836", "#fbf1c7", "#af3a03", "#fbf1c7", "#ebdbb2", "#665c54", "#d5c4a1",
      "#79740e", "#b57614", "#928374", "#9d0006", yink="#fbf1c7", edge="#bdae93"),
    t("#1d2021", "#ebdbb2", "#282828", "#fe8019", "#1d2021", "#3c3836", "#a89984", "#3c3836",
      "#b8bb26", "#fabd2f", "#665c54", "#fb4934", ink="#1d2021", yink="#1d2021", gink="#ebdbb2", popover="#32302f", destructive="#fe6f5e",
      blank="#3c3836", edge="#504945"),
  ),
  "nord": (  # Snow Storm / Polar Night
    t("#e5e9f0", "#2e3440", "#eceff4", "#4b6a93", "#eceff4", "#d8dee9", "#4c566a", "#d8dee9",
      "#a3be8c", "#ebcb8b", "#7b88a1", "#bf616a", ink="#2e3440", yink="#2e3440", blank="#eceff4", edge="#c2cad8", destructive="#a5434e"),
    t("#2e3440", "#eceff4", "#3b4252", "#88c0d0", "#2e3440", "#434c5e", "#b4bccb", "#434c5e",
      "#a3be8c", "#ebcb8b", "#4c566a", "#bf616a", ink="#2e3440", yink="#2e3440", gink="#eceff4", popover="#434c5e", destructive="#eba3aa",
      blank="#434c5e", edge="#4c566a"),
  ),
  "tokyonight": (  # Day / Night
    t("#e1e2e7", "#3760bf", "#e9e9ec", "#2563c7", W, "#d0d5e3", "#4e5a8f", "#c4c8da",
      "#587539", "#8c6c3e", "#848cb5", "#f52a65", yink=W, blank="#e9e9ec", edge="#b4b8cc", destructive="#c71a50"),
    t("#16161e", "#c0caf5", "#1a1b26", "#7aa2f7", "#16161e", "#292e42", "#a9b1d6", "#292e42",
      "#9ece6a", "#e0af68", "#414868", "#f7768e", ink="#16161e", yink="#16161e", gink="#c0caf5", popover="#292e42",
      blank="#292e42", edge="#3b4261"),
  ),
  "dracula": (  # Alucard / Dracula
    t("#f5f1de", "#1f1f1f", "#fffbeb", "#644ac9", W, "#ece7cf", "#6c664b", "#dedccf",
      "#14710a", "#846e15", "#8a8672", "#cb3a2a", yink=W, blank="#fffbeb", edge="#cfcbb4"),
    t("#21222c", "#f8f8f2", "#282a36", "#bd93f9", "#21222c", "#343746", "#b6bad0", "#44475a",
      "#50fa7b", "#f1fa8c", "#44475a", "#ff5555", ink="#21222c", yink="#21222c", gink="#f8f8f2", popover="#343746", destructive="#ff7a7a",
      blank="#343746", edge="#44475a"),
  ),
  "rosepine": (  # Dawn / Main
    t("#faf4ed", "#575279", "#fffaf3", "#286983", "#fffaf3", "#f2e9e1", "#625e7d", "#dfdad9",
      "#286983", "#ea9d34", "#86819a", "#b4637a", yink="#575279", blank="#fffaf3", edge="#cecacd", destructive="#9a4560"),
    t("#191724", "#e0def4", "#1f1d2e", "#ebbcba", "#191724", "#26233a", "#908caa", "#26233a",
      "#31748f", "#f6c177", "#403d52", "#eb6f92", ink="#e0def4", yink="#191724", gink="#e0def4", hink="#191724", popover="#26233a",
      blank="#26233a", edge="#403d52"),
  ),
  "slate": (
    t("#f1f5f9", "#0f172a", W, "#0f172a", "#f8fafc", "#e2e8f0", "#64748b", "#e2e8f0",
      "#16a34a", "#eab308", "#64748b", "#dc2626", blank=W, edge="#cbd5e1"),
    t("#0f172a", "#f1f5f9", "#1e293b", "#f1f5f9", "#0f172a", "#334155", "#94a3b8", "#334155",
      "#16a34a", "#eab308", "#475569", "#ef4444", popover="#1e293b", destructive="#f87171", blank="#1e293b", edge="#475569"),
  ),
  "varsity": (  # Oxblood and gold
    t("oklch(0.962 0.009 20)", "oklch(0.22 0.03 15)", W, "oklch(0.43 0.14 18)", "oklch(0.98 0.01 20)",
      "oklch(0.925 0.013 20)", "oklch(0.47 0.03 18)", "oklch(0.87 0.015 20)",
      "oklch(0.58 0.14 148)", "oklch(0.79 0.16 82)", "oklch(0.62 0.02 20)", "oklch(0.58 0.22 25)", blank=W, edge="oklch(0.8 0.02 20)", destructive="oklch(0.5 0.2 25)"),
    t("oklch(0.22 0.04 15)", "oklch(0.96 0.01 30)", "oklch(0.27 0.05 15)", "oklch(0.83 0.14 85)", "oklch(0.22 0.05 15)",
      "oklch(0.315 0.048 15)", "oklch(0.78 0.03 25)", "oklch(1 0 0 / 10%)",
      "oklch(0.6 0.14 148)", "oklch(0.8 0.15 82)", "oklch(0.45 0.04 15)", "oklch(0.63 0.21 25)", popover="oklch(0.29 0.05 15)", destructive="oklch(0.78 0.14 25)",
      blank="oklch(0.31 0.05 15)", edge="oklch(0.44 0.06 15)"),
  ),
  "wordle": (
    t("#f6f7f8", "#1a1a1b", W, "#437c3e", W, "#e9eaec", "#5c5f63", "#d3d6da",
      "#5d9a57", "#c9b458", "#787c7e", "#e5484d", yink="#1a1a1b", blank=W, edge="#d3d6da", destructive="#c62d33"),
    t("#121213", "#f8f8f8", "#1d1d1f", "#467a42", W, "#2a2a2c", "#9b9ca0", "#3a3a3c",
      "#538d4e", "#b59f3b", "#3a3a3c", "#e5484d", yink="#121213", popover="#262628", destructive="#ff7b7f", blank="#1d1d1f", edge="#3a3a3c"),
  ),
}

# Board squares (light, dark) per theme and mode.
BOARDS = {
  "felt": (("#ebecd0", "#739552"), ("#e6e8c7", "#5f8a4a")),
  "catppuccin": (("#e6e9ef", "#8c8fa1"), ("#bac2de", "#585b70")),
  "gruvbox": (("#ebdbb2", "#a89984"), ("#d5c4a1", "#7c6f64")),
  "nord": (("#e5e9f0", "#81a1c1"), ("#d8dee9", "#5e81ac")),
  "tokyonight": (("#e9e9ec", "#7890dd"), ("#c0caf5", "#3d59a1")),
  "dracula": (("#fffbeb", "#a69ccf"), ("#f8f8f2", "#6272a4")),
  "rosepine": (("#faf4ed", "#d7827e"), ("#e0def4", "#6e6a86")),
  "slate": (("#e2e8f0", "#64748b"), ("#cbd5e1", "#475569")),
  "varsity": (("#f5e6c8", "#9b2c3a"), ("#f0dcb4", "#7a1f2b")),
  "wordle": (("#ebecd0", "#6aaa64"), ("#d3d6da", "#538d4e")),
}

def block(sel, vals):
    return sel + " {\n" + "\n".join(f"  --{k}: {v};" for k, v in vals.items()) + "\n}\n"

out = ["/* Themes. Felt is the default; the rest switch on data-palette (on <html>, or on any element for previews). */\n"]
for name, (light, dark) in THEMES.items():
    (bl, bd), (dl, dd) = BOARDS[name]
    light = {**light, "board-light": bl, "board-dark": bd}
    dark = {**dark, "board-light": dl, "board-dark": dd}
    lsel = f'[data-palette="{name}"]' + (", :root" if name == "felt" else "")
    dsel = f':is(.dark[data-palette="{name}"], .dark [data-palette="{name}"])' + (", .dark" if name == "felt" else "")
    out.append(block(lsel, light) + block(dsel, dark))
sys.stdout.write("\n".join(out))
