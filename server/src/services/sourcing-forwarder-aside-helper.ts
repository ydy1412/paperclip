declare const xmlRequest: XMLHttpRequest | undefined;

// The provider's public CallBackPost accepts only return code 1. Keep its raw
// response (and all request data) out of the agent's report.
export function forwarderLoginAdmission() {
  if (typeof xmlRequest === "undefined" || !xmlRequest || xmlRequest.readyState !== 4) return "pending";
  if (!xmlRequest.responseURL || new URL(xmlRequest.responseURL).origin !== "https://www.next1688.com"
    || new URL(xmlRequest.responseURL).pathname.toLowerCase() !== "/front/join/login_ajax.asp") return "pending";
  if (xmlRequest.status !== 200) return "blocked";
  return parseInt(xmlRequest.responseText, 10) === 1 ? "accepted" : "rejected";
}

// Browser-only proof. It returns hashes/flags, never account or profile values.
export async function forwarderPageProof() {
  const authenticated = Array.from(document.querySelectorAll("a")).some(node =>
    node.getClientRects().length > 0 && /^(로그아웃|log\s*out)$/i.test((node.textContent ?? "").trim()));
  const values: string[] = [];
  for (const row of document.querySelectorAll("tr")) {
    const label = (row.querySelector("th,td")?.textContent ?? "").replace(/[\s*:]/g, "");
    if (!/^(아이디|회원아이디|회원ID|ID)$/i.test(label)) continue;
    const cell = row.querySelectorAll("th,td")[1];
    const field = cell?.querySelector("input");
    const value = field?.value ?? cell?.textContent?.trim();
    if (value) values.push(value);
  }
  // The supported provider uses these member-ID controls; login forms alone
  // are never evidence because profilePage/authenticated must also be true.
  for (const node of document.querySelectorAll<HTMLInputElement>("#sMemId,input[name='sMemId']")) {
    if (node.value) values.push(node.value);
  }
  const identityHashes = await Promise.all(values.slice(0, 8).map(async value => {
    const bytes = new TextEncoder().encode(value.normalize("NFKC").trim());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  }));
  return { origin: location.origin, profilePage: location.pathname.toLowerCase() === "/front/member/mem_w2.asp",
    authenticated, identityHashes };
}

export function forwarderAsideHelper(input: {
  attemptId: string; sessionId: string; loginUrl: string; credentialsPath: string;
  receiptPath: string; identityHash: string; submitSource: string; supportsSource: string;
}) {
  const configuration = JSON.stringify({ attemptId: input.attemptId, sessionId: input.sessionId,
    loginUrl: input.loginUrl, credentialsPath: input.credentialsPath, receiptPath: input.receiptPath,
    identityHash: input.identityHash });
  return `(async () => {
    const configuration=${configuration};
    const nextOrigin="https://www.next1688.com";
    const badRequest=()=>new Error("origin_changed");
    const unprocessable=()=>new Error("login_controls_changed");
    const supportsForwarderLogin=${input.supportsSource};
    const submitNextForwarderLogin=${input.submitSource};
    const proof=${forwarderPageProof.toString()};
    const admission=${forwarderLoginAdmission.toString()};
    const result={attemptId:configuration.attemptId,sessionId:configuration.sessionId,
      status:"blocked",errorCode:"verification_unconfirmed",tabId:null,submitted:false};
    let page;
    try {
      // Only this trusted helper reads the transient secret; no raw value is returned.
      const credentials=JSON.parse(await fs.readFile(configuration.credentialsPath,"utf8"));
      if(typeof credentials.loginId!=="string"||typeof credentials.password!=="string"||!credentials.loginId||!credentials.password)
        throw new Error("credentials_unavailable");
      page=await openTab(configuration.loginUrl);
      result.tabId=page.targetId;
      if(new URL(page.url()).origin!==nextOrigin)throw new Error("origin_changed");
      const logout=page.locator("a").filter({hasText:/^\\s*(로그아웃|log\\s*out)\\s*$/i});
      if(await logout.count()>0&&await logout.first().isVisible()){
        // Testing the selected saved credentials must not reuse another account's cookie.
        await logout.first().click();
        await page.waitForLoadState("domcontentloaded",15000);
        await page.goto(configuration.loginUrl,{waitUntil:"domcontentloaded"});
      }
      if((await page.evaluate(proof)).authenticated)throw new Error("existing_session_unconfirmed");
      await submitNextForwarderLogin(page,configuration.loginUrl,credentials);
      result.submitted=true;
      let authenticated=false;
      for(let i=0;i<60;i++){
        if(new URL(page.url()).origin!==nextOrigin)throw new Error("origin_changed");
        const response=await page.evaluate(admission);
        if(response==="rejected")throw new Error("login_failed");
        if(response==="blocked")throw new Error("verification_unconfirmed");
        authenticated=(await page.evaluate(proof)).authenticated;
        if(authenticated)break;
        await sleep(500);
      }
      if(!authenticated)throw new Error("login_failed");
      const profile=await page.evaluate(()=>Array.from(document.querySelectorAll("a"))
        .find(a=>(a.textContent||"").replace(/\\s/g,"")==="회원정보수정")?.href??null);
      if(!profile||new URL(profile).origin!==nextOrigin||new URL(profile).pathname.toLowerCase()!=="/front/member/mem_w2.asp")
        throw new Error("account_identity_unconfirmed");
      await page.goto(profile,{waitUntil:"domcontentloaded"});
      const evidence=await page.evaluate(proof);
      if(evidence.origin!==nextOrigin||!evidence.profilePage||!evidence.authenticated||!evidence.identityHashes.includes(configuration.identityHash))
        throw new Error("account_identity_unconfirmed");
      result.status="verified";result.errorCode=null;
    } catch(error) {
      const allowed=["origin_changed","login_controls_changed","credentials_unavailable","existing_session_unconfirmed","login_failed","account_identity_unconfirmed"];
      const code=error&&allowed.includes(error.message)?error.message:"verification_unconfirmed";
      result.status=code==="login_failed"?"failed":"blocked";result.errorCode=code;
    }
    await fs.writeFile(configuration.receiptPath,JSON.stringify(result));
    // Preserve the new result tab for the operator. Do not print snapshots/profile values.
    return result;
  })()`;
}
