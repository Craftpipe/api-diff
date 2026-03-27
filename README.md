# api-diff

> Snapshot, diff, and visualize REST API response changes from the command line.

`api-diff` is a zero-config CLI tool that detects breaking changes between API deployments. Point it at any set of REST endpoints and it runs a full pipeline: fetches responses, diffs JSON structures (added/removed/changed fields, type changes, status-code shifts), classifies breaking vs. non-breaking changes, and generates a color-coded terminal summary plus a standalone HTML report.

---

## Install

```bash
npm install -g api-diff
```

Or run without installing:

```bash
npx api-diff --help
```

---

## Quick Start

```bash
# 1. Create a starter config
api-diff init

# 2. Edit api-diff.config.json with your endpoints

# 3. Take a baseline snapshot before your deployment
api-diff snapshot --config api-diff.config.json --output baseline.json

# 4. Deploy your changes, then take a second snapshot
api-diff snapshot --config api-diff.config.json --output current.json

# 5. Diff the two snapshots
api-diff diff --snapshot-a baseline.json --snapshot-b current.json --output result.json

# 6. Generate an HTML report
api-diff report --diff result.json --output report.html

# Or run the full pipeline in one command
api-diff run --config api-diff.config.json --baseline baseline.json
```

---

## Commands

| Command | Description |
|---|---|
| `init` | Create a starter `api-diff.config.json` |
| `snapshot` | Fetch all endpoints and save a snapshot |
| `diff` | Compare two snapshots and output a diff file |
| `report` | Generate a standalone HTML report from a diff file |
| `run` | Run the full pipeline: snapshot → diff → report |

Run `api-diff <command> --help` for options on any command.

---

## Config Format

```json
{
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN",
    "Accept": "application/json"
  },
  "endpoints": [
    {
      "name": "List Users",
      "url": "https://api.example.com/users",
      "method": "GET"
    },
    {
      "name": "Create User",
      "url": "https://api.example.com/users",
      "method": "POST",
      "headers": { "Content-Type": "application/json" },
      "body": { "name": "Jane", "email": "jane@example.com" }
    }
  ]
}
```

Top-level `headers` are merged with per-endpoint `headers`. Supported methods: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.

---

## CI Integration

Drop this into `.github/workflows/api-diff.yml` to automatically detect breaking API changes on every deployment:

```yaml
name: API Diff

on:
  push:
    branches: [main]

jobs:
  api-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install api-diff
        run: npm install -g api-diff

      - name: Download baseline snapshot
        # Replace with however you store/retrieve your baseline
        run: curl -o baseline.json "${{ secrets.BASELINE_SNAPSHOT_URL }}"

      - name: Take current snapshot
        run: api-diff snapshot --config api-diff.config.json --output current.json
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}

      - name: Diff snapshots
        run: api-diff diff --snapshot-a baseline.json --snapshot-b current.json --output diff.json

      - name: Generate HTML report
        run: api-diff report --diff diff.json --output report.html

      - name: Upload report artifact
        uses: actions/upload-artifact@v4
        with:
          name: api-diff-report
          path: report.html
```

> **Note:** `api-diff --help` and `api-diff` with no arguments exit with code **0**. Only genuine errors (missing required options, unreadable files, etc.) exit with code **1**, so the tool is safe to use in CI pipelines.

---

## HTML Report

The `report` command generates a self-contained HTML file with:

- **Summary cards** — total / unchanged / changed / added / removed / breaking counts
- **Per-endpoint table** — status badge, breaking flag, and a detailed change list
- **Color-coded diffs** — breaking changes highlighted in red, non-breaking in amber
- **Before/after values** — shows the exact `from` and `to` for every changed field

Open the file in any browser — no server required.

---

## Change Classification

| Change type | Breaking? |
|---|---|
| Field deleted from response body | ✅ Yes |
| Field value changed | ✅ Yes |
| Status code changed from 2xx to non-2xx | ✅ Yes |
| Field added to response body | ❌ No |
| Array item added | ❌ No |
| Endpoint added | ❌ No |
| Endpoint removed | ✅ Yes |

---

## License

MIT © [Craftpipe](https://heijnesdigital.com)

---

## Built with AI

This tool was built with AI assistance by [Craftpipe](https://heijnesdigital.com).
