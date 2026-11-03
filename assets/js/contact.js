// お問い合わせフォーム（データの誤り・ご要望）
// 送信先は専用 Worker（sakamichia-contact）。?page= があれば対象URLの初期値にする。
const CT_ENDPOINT = "https://sakamichia-contact.pnlg11vs18ge.workers.dev/submit";
(function () {
  const form = document.getElementById("ctForm");
  if (!form) return;
  const type = document.getElementById("ctType"),
    page = document.getElementById("ctPage"),
    msg = document.getElementById("ctMsg"),
    contact = document.getElementById("ctContact"),
    hp = document.getElementById("ctHp"),
    err = document.getElementById("ctErr"),
    send = document.getElementById("ctSend"),
    count = document.getElementById("ctCount"),
    done = document.getElementById("ctDone");
  const fromParam = new URLSearchParams(location.search).get("page");
  if (fromParam) page.value = fromParam;
  const syncCount = () => { count.textContent = String(msg.value.length); };
  msg.addEventListener("input", syncCount);
  syncCount();
  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    err.hidden = true;
    const text = msg.value.trim();
    if (!text) {
      err.textContent = "内容を入力してください。";
      err.hidden = false;
      msg.focus();
      return;
    }
    sending = true;
    send.disabled = true;
    send.textContent = "送信中…";
    try {
      const r = await fetch(CT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type.value, message: text, pageUrl: page.value.trim(), contact: contact.value.trim(), hp: hp.value }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data || !data.ok) throw new Error("bad response");
      form.hidden = true;
      done.hidden = false;
      done.scrollIntoView({ block: "center" });
    } catch (ex) {
      err.textContent = "送信できませんでした。時間をおいて、もう一度お試しください。";
      err.hidden = false;
      sending = false;
      send.disabled = false;
      send.textContent = "送信する";
    }
  });
})();
