const status = document.querySelector("#status"), details = document.querySelector("#details");
const retry = document.querySelector("#retry"), discard = document.querySelector("#discard");
const labels = { mainImage: "대표 이미지", detailImages: "상세 이미지", options: "옵션", price: "가격" };
async function run(type) {
  retry.hidden = true; discard.hidden = true; status.textContent = "상품을 보내고 있습니다…"; details.textContent = "";
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (result.error) throw new Error(result.error);
    if (result.setupRequired) { status.textContent = "처음 한 번 연결해 주세요."; details.textContent = "Dovix 쇼핑몰 관리 설정에서 연결 정보를 복사할 수 있습니다."; return; }
    if (result.retryRequired) { status.textContent = "이전에 전송하지 못한 상품이 있습니다."; details.textContent = result.title; retry.hidden = false; discard.hidden = false; return; }
    if (result.discarded) { status.textContent = "대기 상품을 버렸습니다. 상품 페이지에서 다시 눌러 주세요."; return; }
    status.textContent = result.status === "already_saved" ? "이미 저장된 상품입니다." : "가공 전 상품에 저장했습니다.";
    details.textContent = result.title + (result.missingFields.length ? ` · 누락: ${result.missingFields.map(x => labels[x] ?? x).join(", ")}` : "") + " · 현재 페이지에서 읽은 범위입니다. 옵션·상세 이미지 전체가 포함됐는지 가공 전에 확인해 주세요.";
  } catch (error) { status.textContent = error.message; const { pending } = await chrome.storage.local.get("pending"); retry.hidden = !pending; discard.hidden = !pending; }
}
retry.onclick = () => run("retry"); discard.onclick = () => run("discard");
document.querySelector("#settings").onclick = () => chrome.runtime.openOptionsPage();
run("capture");
