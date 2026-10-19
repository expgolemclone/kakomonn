# kakomonn-sync

A Cloudflare Worker for cross-device learning records and Azure Speech authentication.

## Learning log

Open the [dashboard](https://kakomonn-sync.kakomonn.workers.dev/) in a browser profile with [Reader installed and authenticated](../kakomonn-reader/README.md#installation).

## Open the next question

Bookmark this URL on iPhone Safari, or use the [Windows launcher](../docs/guide.md#windows-setup):

```text
https://kakomonn-sync.kakomonn.workers.dev/open
```

The launcher currently targets `chushoks.kakomonn.com`. For other supported qualification sites, open a question page directly with Reader installed.

## Development

See the shared [test requirements](../docs/guide.md#tests) and [`package.json`](../package.json) for commands. API validation lives in [`contracts/kakomonn.mjs`](../contracts/kakomonn.mjs); metrics and persistence live in [`src/learning-store.js`](src/learning-store.js). Refer to the source rather than maintaining separate API or metric specifications.

## Deployment

Prepare the shared [test environment](../docs/guide.md#tests). Authenticate with Azure and create a free F0 Speech resource in Japan East. Replace `<unique-name>` with a globally unique resource name.

```powershell
az login
az group create --name kakomonn-reader --location japaneast
az cognitiveservices account create --name <unique-name> --resource-group kakomonn-reader --kind SpeechServices --sku F0 --location japaneast --yes
$speechKey = az cognitiveservices account keys list --name <unique-name> --resource-group kakomonn-reader --query key1 --output tsv
```

Authenticate with Cloudflare and register the secrets. Use a cryptographically random value of at least 256 bits for `SYNC_TOKEN`. Never commit tokens or keys.

```powershell
npx --no-install wrangler login
npx --no-install wrangler secret put SYNC_TOKEN --config kakomonn-sync/wrangler.jsonc
$speechKey | npx --no-install wrangler secret put AZURE_SPEECH_KEY --config kakomonn-sync/wrangler.jsonc
```

For copy-failure reports to [Issue #29](https://github.com/expgolemclone/kakomonn/issues/29), create a fine-grained GitHub PAT restricted to `expgolemclone/kakomonn` with `Issues: Read and write`. Store it only as a Worker secret, never in `.env`, a browser, or a URL:

```powershell
npx --no-install wrangler secret put GITHUB_COPY_FAILURE_TOKEN --config kakomonn-sync/wrangler.jsonc
```

After passing the complete tests and pushing `main`, deploy and verify production:

```powershell
npm run deploy:kakomonn-sync
```

Production verification requires real Chrome, Tampermonkey, a configured Reader token, and an authenticated `gh` CLI. It records a production answer and posts a controlled copy-failure report to GitHub. Run this verification once per deployment, not as a replacement for the complete tests. Use the [release order](../docs/guide.md#release-and-deployment) before publishing a dependent Reader change.
