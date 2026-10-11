# 소싱 상품 가공

This local plugin exposes six product tools backed by the existing scoped Auto
Sourcing catalog. Configure a company-scoped `serviceToken` secret reference and
the project's `sourceProducts` allowlist, or its already bound collected sources.
Select this plugin in an agent profile; skills alone do not grant its tools.

`list-sourcing-workspace(stage=unprocessed)` → `start-managed-processing` →
`get-managed-product` → uploaded reference search/read → `save-managed-product`
→ reread. Saves require the current revision and preserve SKU identity/prices.
The host checks the authenticated run, assigned issue/project, plugin company
configuration and source scope. No direct network, secrets, order, marketplace
import, enqueue or publication capability is declared. Pixel cropping and
provider category validation require separate supported tools.
