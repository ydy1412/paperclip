# Capture ingress through the existing Cloudflare Tunnel

Keep the existing Personal Brain Worker and tunnel settings unchanged. Add a
separate HTTP VPC service for Dovix loopback port 3100 on the existing tunnel,
and bind it only to the capture Worker. The Worker forwards only exact JSON
`POST /api/sourcing-capture`; other paths cannot reach Dovix. It forwards no
cookies, proxy identity headers or caller-selected destination. Dovix validates
its capture-only bearer against current membership, project and plugin state.

Using the installed authenticated Wrangler CLI:

```sh
wrangler vpc service list
wrangler vpc service create dovix-product-capture --type http --tunnel-id CONFIRMED_TUNNEL_ID --ipv4 127.0.0.1 --http-port 3100
```

Record the returned service ID in a local copy of `wrangler.jsonc.example`, then
`wrangler deploy --config PATH_TO_CONFIG`. Set the resulting fixed HTTPS origin
as `PAPERCLIP_SOURCING_CAPTURE_URL` in the Dovix runtime so the settings form is
prefilled. No Quick Tunnel hostname is persisted in extension settings.

Deploy native Auto Sourcing before the compatible Dovix build and its additive
0304 schema migration. Use this repository's existing backup/compatible overlay
procedure; never upgrade the older operating core just to install this feature.
Create a disposable capture connection and verify public 401, path rejection,
actual fixture ingestion, duplicate response and revocation before handing over.

Revoke capture connections or disable this Worker to stop ingress. Keep native
original files/rows and project associations; rollback must not delete products.
Existing scheduled image workers keep following their project settings; capture
itself never enqueues collection, processing or publication.

Official references: https://developers.cloudflare.com/workers-vpc/examples/private-api/
and https://developer.chrome.com/docs/extensions/develop/concepts/activeTab.
