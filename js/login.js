(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let session = null;
  let cryptoKey = null;
  let timer = null;
  let refreshing = false;

  function fromB64(value) {
    const normal = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(normal + "=".repeat((4 - normal.length % 4) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  function toB64(bytes) {
    let raw = "";
    bytes.forEach(byte => { raw += String.fromCharCode(byte); });
    return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeAccess(value) {
    let candidate = String(value || "").trim();
    if (candidate.includes("#")) {
      const fragment = candidate.slice(candidate.indexOf("#") + 1);
      candidate = new URLSearchParams(fragment).get("remote") || "";
    } else if (candidate.startsWith("remote=")) {
      candidate = candidate.slice(7);
    }
    const data = JSON.parse(decoder.decode(fromB64(candidate)));
    const relay = new URL(data.r);
    const localHttp = relay.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(relay.hostname);
    if (data.v !== 1 || (relay.protocol !== "https:" && !localHttp) || relay.username || relay.password ||
        !/^[A-Za-z0-9_-]{20,64}$/.test(data.c) ||
        !/^[A-Za-z0-9_-]{40,64}$/.test(data.t) || fromB64(data.k).length !== 32) {
      throw new Error("That secure link is invalid.");
    }
    if (Number(data.e) <= Date.now() / 1000) throw new Error("That secure link has expired. Rotate it in the desktop app.");
    data.r = relay.href.replace(/\/$/, "");
    return { encoded: candidate, data };
  }

  function endpoint(action) {
    return `${session.r}/v1/sessions/${session.c}/${action}`;
  }

  async function relay(action, options) {
    const response = await fetch(endpoint(action), Object.assign({
      cache: "no-store",
      headers: {
        "Authorization": "Bearer " + session.t,
        "Content-Type": "application/json",
        "X-Axiom-Role": "browser"
      }
    }, options || {}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Relay request failed (${response.status}).`);
    return data;
  }

  function aad(kind) {
    return encoder.encode(`axiomstrat:${session.c}:${kind}`);
  }

  async function decrypt(envelope, kind) {
    const plain = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: fromB64(envelope.nonce), additionalData: aad(kind)
    }, cryptoKey, fromB64(envelope.ciphertext));
    return JSON.parse(decoder.decode(plain));
  }

  async function encrypt(payload, kind) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({
      name: "AES-GCM", iv: nonce, additionalData: aad(kind)
    }, cryptoKey, encoder.encode(JSON.stringify(payload)));
    return { nonce: toB64(nonce), ciphertext: toB64(new Uint8Array(encrypted)), sent_at: Math.floor(Date.now() / 1000) };
  }

  function money(value) {
    return (Number(value) || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = String(value == null ? "" : value);
    return node.innerHTML;
  }

  function render(state) {
    $("k-equity").textContent = money(state.equity);
    $("k-pnl").textContent = money(state.daily_pnl);
    $("k-pnl").className = "kpi-v " + (Number(state.daily_pnl) >= 0 ? "up" : "down");
    $("k-active").textContent = Number(state.active) || 0;
    $("k-trades").textContent = Number(state.trades_today) || 0;
    const deployments = Array.isArray(state.deployments) ? state.deployments : [];
    $("deployments").innerHTML = deployments.map(item => `
      <article class="remote-deployment">
        <div><strong>${escapeHtml(item.symbol || "—")}</strong><span>${escapeHtml(item.strategy || "No strategy")}</span></div>
        <div><b>${escapeHtml(item.timeframe || "—")}</b><span>magic ${escapeHtml(item.magic || "—")}</span></div>
        <div><em class="state ${item.state === "running" ? "live" : ""}">${escapeHtml(item.state || "idle")}</em><span>${money(item.daily_pnl)}</span></div>
      </article>`).join("") || '<p class="empty">No deployments are configured in the desktop app.</p>';
    $("connection").textContent = state.connected ? "Desktop online · bots active" : "Desktop online";
    $("last-update").textContent = "Updated " + new Date().toLocaleTimeString();
  }

  async function refresh() {
    if (!session || refreshing) return;
    refreshing = true;
    try {
      const response = await relay("state");
      if (response.pending) {
        $("connection").textContent = "Waiting for desktop state…";
      } else {
        render(await decrypt(response.envelope, "state"));
      }
    } catch (error) {
      $("connection").textContent = "Connection interrupted · retrying";
      $("last-update").textContent = error.message;
    } finally {
      refreshing = false;
    }
  }

  async function connect(encoded) {
    const parsed = decodeAccess(encoded);
    session = parsed.data;
    cryptoKey = await crypto.subtle.importKey("raw", fromB64(session.k), "AES-GCM", false, ["encrypt", "decrypt"]);
    sessionStorage.setItem("axiom-remote", parsed.encoded);
    history.replaceState({}, "", location.pathname + location.search);
    $("step-pair").classList.add("hidden");
    $("step-dashboard").classList.remove("hidden");
    await refresh();
    clearInterval(timer);
    timer = setInterval(refresh, 3000);
  }

  async function sendCommand(command, confirmation) {
    $("command-status").textContent = "Sending encrypted command…";
    try {
      const envelope = await encrypt({
        command, confirmation: confirmation || null,
        command_id: crypto.randomUUID(), at: Math.floor(Date.now() / 1000)
      }, "command");
      await relay("commands", { method: "POST", body: JSON.stringify({ envelope }) });
      $("command-status").textContent = "Command accepted. The desktop will apply it within a few seconds.";
      setTimeout(refresh, 3500);
    } catch (error) {
      $("command-status").textContent = error.message;
    }
  }

  function disconnect() {
    clearInterval(timer);
    timer = null; session = null; cryptoKey = null;
    sessionStorage.removeItem("axiom-remote");
    $("step-dashboard").classList.add("hidden");
    $("step-pair").classList.remove("hidden");
    $("remote-key").value = "";
  }

  $("btn-connect").addEventListener("click", async () => {
    $("pair-error").textContent = "";
    try { await connect($("remote-key").value); }
    catch (error) { $("pair-error").textContent = error.message || "Could not open that secure link."; }
  });
  $("remote-key").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("btn-connect").click(); }
  });
  $("btn-refresh").addEventListener("click", refresh);
  $("btn-disconnect").addEventListener("click", disconnect);
  $("btn-start").addEventListener("click", () => sendCommand("start"));
  $("btn-stop").addEventListener("click", () => sendCommand("stop"));
  $("btn-kill").addEventListener("click", () => {
    const answer = prompt("Emergency flatten stops every bot and closes AxiomStrat-owned positions. Type KILL to continue:");
    if (answer === "KILL") sendCommand("kill", "KILL");
  });

  const fragment = new URLSearchParams(location.hash.slice(1)).get("remote");
  const saved = sessionStorage.getItem("axiom-remote");
  if (fragment || saved) {
    connect(fragment || saved).catch(error => {
      disconnect();
      $("pair-error").textContent = error.message || "Could not connect to the desktop.";
    });
  }
})();
