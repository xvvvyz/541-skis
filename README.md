# 541 Skis

The only ski you need.

## Develop

```bash
bun i
bun dev
bun lint
```

## Config

Worker: `.dev.vars` / `.dev.vars.production`

```bash
OPENROUTER_API_KEY
REPLICATE_API_TOKEN
ORDER_FROM
ORDER_TO
ORDER_COPY
CONTACT_EMAIL
```

## Deploy

```bash
bun run deploy
```

## Scripts

```bash
# A model's outline from its CNC base export
uv run python -I scripts/outline.py base.ai > src/client/shapes/185.json

# The home page's small copies of the example designs
uv run --with pillow python -I scripts/thumbnails.py

# The home page's link preview, static/og/home.jpg
uv run --with pillow --with resvg-py python -I scripts/og.py
```

Print file details are in [docs/print.md](docs/print.md).
