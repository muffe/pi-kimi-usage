# pi-kimi-usage

[![pi package](https://img.shields.io/badge/pi-package-7c3aed)](https://shittycodingagent.ai/packages)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

A pi extension that shows compact Kimi usage info in the footer, only when a `kimi-coding` model is selected.

Example output:

```text
Kimi · 7d 6% 6d20h · 5h 28% 1h40m
```

![preview](./assets/preview.svg)

## Features

- Shows Kimi usage only for `kimi-coding` models
- Refreshes on session start, every 60 seconds, and on turn end
- Reads auth from:
  1. `KIMI_API_KEY`
  2. `~/.pi/agent/auth.json` → `kimi-coding.key`
     - literal key
     - env var name
     - shell command prefixed with `!`
- Uses `KIMI_CODE_BASE_URL` if set, otherwise defaults to `https://api.kimi.com/coding/v1/usages`

## Install locally

```bash
pi install /opt/pi-kimi-usage
```

## Publish

### npm

```bash
cd /opt/pi-kimi-usage
npm publish
```

Install:

```bash
pi install npm:pi-kimi-usage
```

### Git

Push this folder to a Git repository, then install with:

```bash
pi install git:github.com/muffe/pi-kimi-usage
```

## GitHub repo notes

If you publish this on GitHub and want richer badges, replace or add badges like:

```md
[![npm version](https://img.shields.io/npm/v/pi-kimi-usage)](https://www.npmjs.com/package/pi-kimi-usage)
[![CI](https://github.com/muffe/pi-kimi-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/muffe/pi-kimi-usage/actions/workflows/ci.yml)
```

If you want the pi package gallery preview to use a hosted image, update `package.json` and point `pi.image` to a public URL, for example a raw GitHub asset URL.

## Notes

This extension intentionally resolves `auth.json` shell-command keys (values starting with `!`) to match pi auth behavior.
