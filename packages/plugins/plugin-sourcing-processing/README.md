# 소싱 상품 가공

This local plugin exposes thirteen product tools backed by the existing scoped Auto
Sourcing catalog. Configure a company-scoped `serviceToken` secret reference and
the project's `sourceProducts` allowlist, or its already bound collected sources.
Select this plugin in an agent profile; skills alone do not grant its tools.

`list-sourcing-workspace(stage=unprocessed)` → `get-processing-source` → `start-managed-processing` →
`get-managed-product` → uploaded reference search/read → `save-managed-product`
→ reread. Saves require the current revision and preserve SKU identity/prices.
The host checks the authenticated run, assigned issue/project, plugin company
configuration and source scope. No direct network, secrets, order, marketplace
import, enqueue or publication capability is declared. Select an enabled registered
Coupang store with `list-product-stores`, then use `recommend-coupang-category`
and `get-coupang-category-metadata`. The host resolves credentials and makes the
existing provider reads. These tools do not save a category or attest required
product facts. `get-processing-source` returns the original source hash, SKU
options and images even after the common product has been edited. Use a bound
store's `accountId` and the original source `productId`. It reuses the existing
authorized processing read bridge. Actual pixel crops and local Chinese text removal are available through inspect-product-image and process-product-image. Outputs are scoped authenticated PNG previews with original/output hashes and quality flags; marketplace image hosting remains separate.

The assigned `sourcing-reference-processing` skill includes
`scripts/plugin-tools.mjs`. It discovers allowed native tools and invokes them
with the injected company, agent and run identity. It normalizes the API base
path and does not retry writes automatically. A saved `ready` stage does not
prove required product facts or image edits are complete. Preserve original
purchase exclusions and incompatibility warnings in translations.

`get-product-image` reads a scoped derivative through the same native read capability. The skill helper saves the returned PNG into the current run scratch directory without printing image bytes. Agents can inspect and attach that file with their existing tools. No host path is exposed or accepted.

`get-image-provider-status` reports Auto Sourcing's internal Higgsfield MCP configuration and authenticated account/model check without returning credentials. Agents receive only the native scoped tools, never the remote Higgsfield MCP. Once configured, `process-product-image(provider=higgsfield, removeAllText=true)` submits the exact source PNG for removal of all letters, digits and logo lettering. Preserve those source facts in Korean options/detail. Cloud mode does not accept local crop/cleanup/removeChinese. A pending response requires waiting and repeating the exact same original requestId, revision and parameters; a known job is resumed; an unknown submission is blocked without another generation. Only a finished owned PNG changes matching product references. Always visually compare product geometry and run all-language OCR; `reviewRequired` remains true. MCP billing and server-owned OAuth setup are described in Auto Sourcing's `specs/005-product-publishing/higgsfield-connection.md`.
