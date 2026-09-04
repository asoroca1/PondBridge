# Cloudflare Stream

## Why it is here

A clip recorded on an iPhone is usually HEVC in a QuickTime container. Only
Safari decodes that, so a video posted to the media stream was a black player
for every member on Chrome or Firefox.

Stream re-encodes each upload to H.264/HLS, which plays everywhere. The upload
path itself did not change: the browser still PUTs straight to R2 over a
presigned URL, and Stream copies the file from there.

## What happens to a posted clip

1. The browser uploads to R2, exactly as before.
2. `POST /photos` saves the row with `stream_status = 'pending'`.
3. The API calls Stream's `/copy` with the R2 URL and stores the returned uid.
4. Stream encodes, then calls `POST /api/webhooks/cloudflare-stream`.
5. The webhook writes `stream_status = 'ready'` and the HLS manifest URL.
6. The feed plays the manifest — hls.js on Chrome and Firefox, natively on
   Safari.

If the webhook never arrives, a feed read reconciles any clip that is still
unplayable and has stopped looking fresh (30s), so a missed delivery costs a
short delay rather than a permanently stuck post. A feed with no unfinished
clips makes no outbound calls at all.

**Failure is not fatal.** If Stream is unconfigured or the ingest call fails,
the post still saves and still plays from the original upload — the same
Safari-only behaviour as before. Nothing regresses; it just does not improve.

## Setup

These steps need the Cloudflare dashboard and are not something the app can do
for itself.

1. **Enable Stream** on the account. It is usage-billed: $5 per 1,000 minutes
   stored per month, $1 per 1,000 minutes delivered. Encoding and ingest are
   free.
2. **Create an API token** with `Stream:Edit` on the account, and set it as
   `CLOUDFLARE_STREAM_API_TOKEN` in the API's environment. Leaving it blank
   falls back to `CLOUDFLARE_API_TOKEN`, which works but is broader than it
   needs to be.
3. **Subscribe the webhook.** Stream allows exactly one subscription per
   account, so this overwrites any existing one:

   ```bash
   curl -X PUT \
     -H "Authorization: Bearer $CLOUDFLARE_STREAM_API_TOKEN" \
     -d '{"notificationUrl":"https://api.pondbridgealumni.com/api/webhooks/cloudflare-stream"}' \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/stream/webhook"
   ```

   The response carries a `secret`. Set it as
   `CLOUDFLARE_STREAM_WEBHOOK_SECRET`. Without it every notification is
   rejected and the app falls back to reconciling on read.

## Cost control

- Deleting a post deletes its Stream video, so a removed clip stops being
  billed for storage.
- Playback is HLS rather than a progressive MP4 specifically so that delivery
  is billed for what a member actually watches, not for the whole file every
  time someone opens a post.

## Checking it works

`stream_status` on a `photos` row is the thing to look at:

| Value | Meaning |
| --- | --- |
| `pending` | Row saved, ingest not yet acknowledged |
| `processing` | Stream has the file and is encoding |
| `ready` | Playable; `stream_playback_url` holds the manifest |
| `error` | Stream could not encode it; the original upload still plays |
| `null` | A still, or a video posted before Stream was wired up |

A clip stuck in `pending` means the ingest call is failing — check the API logs
for `photo_stream_ingest_failed`. One stuck in `processing` with no webhook
traffic means the subscription or its secret is wrong; look for
`cloudflare_stream_webhook_rejected`.
