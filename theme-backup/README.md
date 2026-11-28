# Pulse theme backup (known good, 26 Nov 2026)

Shopify's **"Update theme"** button resets these files to the plain Horizon defaults and breaks the
pulsemotion.in design. Everything in this folder is the working Pulse version.

| File | What it holds |
|---|---|
| `layout/theme.liquid` | Google Tag Manager, Pulse structured data (SEO), Pulse icons (call/WhatsApp/cart), drawer styles, favicon fallback, login nudge |
| `snippets/stylesheets.liquid` | Pulse fonts and CSS (cards, colours, photo framing) |
| `snippets/scripts.liquid` | Lighter home page scripts |
| `templates/*.json` | Page layouts: product, category, blog, article, rent, donate, contact, home |
| `assets/pulse-favicon.png` | Browser-tab icon |

**Restore:** duplicate the live theme, upload these files to the copy, preview, publish.
**Prevention:** never click "Update theme" in Online Store → Themes.

**Also customised (28 Nov 2026):**
- `snippets/meta-tags.liquid` (saved here): home page uses the saved SEO title/description, "Pulse Motion" title suffix and site name, default share image.
- `sections/header.liquid` (not saved, 58 KB Horizon file): on line ~404 the hidden `<h1>{{ shop.name }}</h1>` was changed to `<p>` so the home page has one H1. Re-apply after any theme update.
- `snippets/pulse-structured-data.liquid` is a Pulse file and survives updates.
