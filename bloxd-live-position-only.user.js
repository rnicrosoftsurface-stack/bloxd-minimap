// ==UserScript==
// @name         Bloxd Live Position Bridge v3
// @namespace    bloxd-minimap-safe
// @version      3.0.0
// @description  Live-Koordinaten + kleines ausblendbares Menue, ohne Radar oder Spielsteuerung.
// @match        https://bloxd.io/*
// @match        https://bloxd.dev/*
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(() => {
    "use strict";

    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const MAP_URL = "https://rnicrosoftsurface-stack.github.io/bloxd-minimap/live.html";
    const MAP_ORIGIN = "https://rnicrosoftsurface-stack.github.io";
    const PANEL_ID = "bloxd-live-position-bridge-v3";

    const NUM = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
    const TRIPLE = /([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/;
    const calls = new WeakMap();
    let pos = null;
    let lastPos = 0;
    let lastAck = 0;
    let mapTab = null;
    let panel = null;
    let statusEl = null;
    let coordsEl = null;
    let inner = null;
    let toggleBtn = null;
    let collapsed = false;

    function accept(x, y, z) {
        if (![x, y, z].every(Number.isFinite)) return;
        if (Math.abs(x) > 1e9 || Math.abs(z) > 1e9 || Math.abs(y) > 2048) return;
        pos = { x, y, z };
        lastPos = performance.now();
    }

    function inspectNumber(canvas, value, x, y, raw) {
        if (!canvas || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const now = performance.now();
        let a = calls.get(canvas);
        if (!a) { a = []; calls.set(canvas, a); }
        a.push({ value, x, y, raw, t: now });
        while (a.length && now - a[0].t > 120) a.shift();
        if (a.length > 16) a.splice(0, a.length - 16);

        let best = null;
        let highest = 7;
        for (let i = 0; i < a.length - 2; i++) {
            for (let j = i + 1; j < a.length - 1; j++) {
                for (let k = j + 1; k < a.length; k++) {
                    const t = [a[i], a[j], a[k]].sort((p, q) => p.x - q.x);
                    if (!(t[0].x < t[1].x && t[1].x < t[2].x)) continue;
                    if (t[2].x - t[0].x < 18) continue;
                    if (Math.max(...t.map(p => p.y)) - Math.min(...t.map(p => p.y)) > 10) continue;
                    if (Math.abs(t[1].value) > 2048) continue;

                    const score =
                        Math.log10(1 + Math.abs(t[0].value)) +
                        Math.log10(1 + Math.abs(t[2].value)) +
                        (Math.abs(t[1].value) < 512 ? 6 : 0) +
                        (Math.abs(t[0].value) > 256 || Math.abs(t[2].value) > 256 ? 3 : 0) +
                        (/coordinate/i.test(String(canvas.className || "")) ? 20 : 0);

                    if (score > highest) { highest = score; best = t; }
                }
            }
        }
        if (best) accept(best[0].value, best[1].value, best[2].value);
    }

    // Nur die gezeichneten Koordinaten der Spieloberflaeche beobachten.
    // Keine Spiel-Engine, Weltbloecke, Spielerlisten oder automatischen Eingaben.
    function installReader() {
        const proto = W.CanvasRenderingContext2D?.prototype;
        if (!proto || proto.__bloxdXYZBridgeV3) return;
        const original = proto.fillText;

        function observedText(text, x, y, width) {
            try {
                const raw = String(text).trim().replace(/,/g, ".");
                const t = raw.match(TRIPLE);
                if (t && (raw.includes(" ") || raw.includes("\t"))) {
                    accept(+t[1], +t[2], +t[3]);
                } else if (NUM.test(raw) && this.canvas) {
                    inspectNumber(this.canvas, Number(raw), Number(x), Number(y), raw);
                }
            } catch (_) {}
            return arguments.length >= 4
                ? original.call(this, text, x, y, width)
                : original.call(this, text, x, y);
        }

        Object.defineProperty(proto, "__bloxdXYZBridgeV3", {
            value: true, configurable: true
        });
        proto.fillText = observedText;

        W.addEventListener("pagehide", () => {
            if (proto.fillText === observedText) proto.fillText = original;
        }, { once: true });
    }

    function getSeed() {
        return new URL(W.location.href).searchParams.get("lobby") || "1234";
    }

    function openMap() {
        const u = new URL(MAP_URL);
        u.searchParams.set("v", "3");
        u.searchParams.set("seed", getSeed());
        u.searchParams.set("radius", "30");
        u.searchParams.set("y", "p");

        if (pos && performance.now() - lastPos < 5000) {
            u.searchParams.set("x", String(Math.floor(pos.x)));
            u.searchParams.set("z", String(Math.floor(pos.z)));
        }

        mapTab = W.open(u.href, "BloxdLiveMap");
        if (mapTab) mapTab.focus();
        else if (statusEl) statusEl.textContent = "POPUP BLOCKIERT";
        updateUI();
    }

    function updateUI() {
        if (!panel || !statusEl || !coordsEl) return;
        const current = pos && performance.now() - lastPos < 2200;
        const connected = current && mapTab && !mapTab.closed && Date.now() - lastAck < 3000;

        statusEl.textContent = connected
            ? "● LIVE VERBUNDEN"
            : current
                ? "● POSITION ERKANNT"
                : "● WARTE AUF XYZ";
        statusEl.style.color = connected ? "#53f3a1" : current ? "#ffd166" : "#a9bdd0";
        coordsEl.textContent = current
            ? "X " + pos.x.toFixed(2) + "  Y " + pos.y.toFixed(2) + "  Z " + pos.z.toFixed(2)
            : "Warte auf Koordinatenanzeige";
    }

    function setCollapsed(value) {
        collapsed = !!value;
        if (inner) inner.style.display = collapsed ? "none" : "block";
        if (toggleBtn) toggleBtn.textContent = collapsed ? "+" : "−";
    }

    function createUI() {
        if (!document.body || document.getElementById(PANEL_ID)) return;
        panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.style.cssText =
            "position:fixed;right:14px;bottom:16px;width:256px;" +
            "max-width:calc(100vw - 28px);z-index:2147483647;" +
            "background:rgba(8,19,29,.97);color:#eef6ff;" +
            "border:1px solid #345268;border-radius:11px;" +
            "box-shadow:0 10px 30px #0009;padding:10px;" +
            "font:12px Arial,sans-serif;user-select:none";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:7px";
        const title = document.createElement("strong");
        title.textContent = "LIVE MAP";
        title.style.cssText = "font:900 12px Arial;white-space:nowrap";
        statusEl = document.createElement("span");
        statusEl.style.cssText = "font:800 9px Consolas;flex:1;text-align:right";
        toggleBtn = document.createElement("button");
        toggleBtn.textContent = "−";
        toggleBtn.title = "Menue einklappen / ausklappen";
        toggleBtn.style.cssText =
            "width:23px;height:23px;border:1px solid #486074;border-radius:5px;" +
            "background:#142536;color:white;cursor:pointer;font-weight:900";
        toggleBtn.onclick = () => setCollapsed(!collapsed);
        header.append(title, statusEl, toggleBtn);

        inner = document.createElement("div");
        inner.style.marginTop = "9px";
        const btn = document.createElement("button");
        btn.textContent = "LIVE-KARTE ÖFFNEN";
        btn.style.cssText =
            "height:35px;width:100%;border:1px solid #26865e;border-radius:7px;" +
            "background:#176347;color:#fff;font:800 11px Arial;cursor:pointer";
        btn.onclick = openMap;
        coordsEl = document.createElement("div");
        coordsEl.style.cssText = "font:10px/1.5 Consolas;margin-top:8px;color:#afc8dc;overflow-wrap:anywhere";
        const note = document.createElement("div");
        note.textContent = "Alt+Shift+M: Karte öffnen  ·  Alt+Shift+L: Menü";
        note.style.cssText = "font:9px/1.5 Arial;margin-top:5px;color:#859cb0";
        inner.append(btn, coordsEl, note);
        panel.append(header, inner);
        document.body.appendChild(panel);
        updateUI();
    }

    W.addEventListener("message", event => {
        if (event.origin !== MAP_ORIGIN) return;
        if (event.source !== mapTab) return;
        if (event.data?.type === "BLOXD_POSITION_ACK_V1") {
            lastAck = Date.now();
            updateUI();
        }
    });

    W.addEventListener("keydown", event => {
        if (!event.altKey || !event.shiftKey || event.repeat) return;
        if (event.code === "KeyM") {
            event.preventDefault();
            openMap();
        } else if (event.code === "KeyL") {
            event.preventDefault();
            if (panel) panel.style.display = panel.style.display === "none" ? "block" : "none";
        }
    }, true);

    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Live-Karte öffnen", openMap);
        GM_registerMenuCommand("Live-Menü anzeigen", () => {
            if (panel) { panel.style.display = "block"; setCollapsed(false); }
        });
    }

    W.setInterval(() => {
        if (!pos || performance.now() - lastPos > 2000) { updateUI(); return; }
        if (mapTab && !mapTab.closed) {
            try {
                mapTab.postMessage({
                    type: "BLOXD_POSITION_V1",
                    x: pos.x, y: pos.y, z: pos.z, seed: getSeed()
                }, MAP_ORIGIN);
            } catch (_) {}
        }
        updateUI();
    }, 350);

    installReader();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createUI, { once: true });
    } else {
        createUI();
    }
})();