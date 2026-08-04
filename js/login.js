(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let session = null;
  let cryptoKey = null;
  let timer = null;
  let refreshing = false;
  let lastPositions = [];

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
    $("deployments").innerHTML = deployments.map(item => {
      const st = String(item.state || "stopped");
      const scan = item.last_bar ? `<span>Last bar: ${escapeHtml(item.last_bar)}</span>` : "";
      const news = item.news_state && item.news_state !== "off"
        ? `<span>News guard: ${escapeHtml(item.news_state)}${Number(item.news_blocks) ? " · " + Number(item.news_blocks) + " blocked" : ""}</span>` : "";
      return `
      <article class="remote-deployment">
        <div><strong>${escapeHtml(item.symbol || "—")}</strong><span>${escapeHtml(item.strategy || "No strategy")}</span></div>
        <div><b>${escapeHtml(item.timeframe || "—")}</b><span>magic ${escapeHtml(item.magic || "—")}${Number(item.trades_today) ? " · " + Number(item.trades_today) + " trades today" : ""}</span></div>
        <div><em class="state ${st === "running" ? "live" : st === "error" ? "err" : ""}">${st === "running" ? "scanning" : escapeHtml(st)}</em><span>${money(item.daily_pnl)}</span></div>
        ${scan || news ? `<div class="remote-extra">${scan}${news}</div>` : ""}
      </article>`;
    }).join("") || '<p class="empty">No deployments are configured in the desktop app.</p>';
    const positions = Array.isArray(state.open_positions) ? state.open_positions : [];
    lastPositions = positions;
    $("open-positions").innerHTML = positions.map((pos, i) => {
      const side = String(pos.side || "").replace(/Side\.?/, "").toUpperCase();
      const isBuy = side.startsWith("BUY");
      return `
      <article class="remote-position" data-index="${i}">
        <div class="rp-head">
          <strong>${escapeHtml(pos.deployment || pos.symbol || "—")}</strong>
          <em class="rp-side ${isBuy ? "buy" : "sell"}">${escapeHtml(side)}</em>
          <span>${escapeHtml(pos.strategy || "—")} · ${escapeHtml(pos.timeframe || "—")} · magic ${escapeHtml(pos.magic || "—")}</span>
        </div>
        <div class="rp-grid">
          <span><b>Vol</b>${formatPrice(pos.volume)}</span>
          <span><b>Entry</b>${formatPrice(pos.entry)}</span>
          <span><b>Current</b>${formatPrice(pos.current)}</span>
          <span><b>SL</b>${formatPrice(pos.sl)}</span>
          <span><b>TP</b>${formatPrice(pos.tp)}</span>
          <span><b>Ticket</b>#${escapeHtml(pos.ticket || "—")}</span>
        </div>
        <div class="rp-foot">
          ${formatPnl(pos.pnl)}
          <button class="btn ghost small" data-modify>Modify SL/TP</button>
          <button class="btn danger small" data-close>Close</button>
        </div>
      </article>`;
    }).join("") || '<p class="empty">No open positions right now.</p>';
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

  async function sendCommand(command, confirmation, target) {
    $("command-status").textContent = "Sending encrypted command…";
    try {
      const payload = {
        command, confirmation: confirmation || null,
        command_id: crypto.randomUUID(), at: Math.floor(Date.now() / 1000)
      };
      if (target) {
        Object.assign(payload, {
          symbol: target.symbol || null,
          magic: target.magic != null ? Number(target.magic) : null,
          ticket: target.ticket != null ? Number(target.ticket) : null,
          sl: target.sl != null ? Number(target.sl) : null,
          tp: target.tp != null ? Number(target.tp) : null
        });
      }
      const envelope = await encrypt(payload, "command");
      await relay("commands", { method: "POST", body: JSON.stringify({ envelope }) });
      $("command-status").textContent = "Command accepted. The desktop will apply it within a few seconds.";
      setTimeout(refresh, 1500);
    } catch (error) {
      $("command-status").textContent = error.message;
    }
  }

  function formatPrice(value) {
    if (value == null || value === "") return "—";
    const n = Number(value);
    if (!isFinite(n)) return "—";
    return String(parseFloat(n.toFixed(6)));
  }

  function formatPnl(value) {
    const n = Number(value) || 0;
    const sign = n >= 0 ? "pos" : "neg";
    return `<b class="pnl ${sign}">${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>`;
  }

  async function modifyPosition(position) {
    const current = Number(position.tp) || "";
    const slText = prompt(
      `Set new Stop Loss for ${position.symbol} #${position.ticket}\n` +
      `Current SL: ${formatPrice(position.sl)}   Current TP: ${formatPrice(position.tp)}\n` +
      `Enter price, or leave blank to keep. Set 0 to clear.`);
    if (slText === null) return;
    const tpText = prompt(
      `Set new Take Profit for ${position.symbol} #${position.ticket}\n` +
      `Current SL: ${formatPrice(position.sl)}   Current TP: ${formatPrice(position.tp)}\n` +
      `Enter price, or leave blank to keep. Set 0 to clear.`);
    if (tpText === null) return;
    const target = {
      symbol: position.symbol, magic: position.magic, ticket: position.ticket,
      sl: null, tp: null
    };
    if (slText.trim() !== "") {
      const sl = parseFloat(slText);
      if (!isFinite(sl)) { $("command-status").textContent = "Invalid SL price."; return; }
      target.sl = sl;
    }
    if (tpText.trim() !== "") {
      const tp = parseFloat(tpText);
      if (!isFinite(tp)) { $("command-status").textContent = "Invalid TP price."; return; }
      target.tp = tp;
    }
    if (target.sl === null && target.tp === null) return;
    await sendCommand("modify_position", null, target);
  }

  async function closePosition(position) {
    const answer = prompt(
      `Close ${position.symbol} #${position.ticket} at market? Type CLOSE to confirm.`);
    if (answer === "CLOSE") {
      await sendCommand("close_position", null, {
        symbol: position.symbol, magic: position.magic, ticket: position.ticket
      });
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

  $("open-positions").addEventListener("click", event => {
    const card = event.target.closest(".remote-position");
    if (!card) return;
    const index = Number(card.dataset.index);
    const pos = lastPositions[index];
    if (!pos) return;
    if (event.target.closest("[data-modify]")) modifyPosition(pos);
    else if (event.target.closest("[data-close]")) closePosition(pos);
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
