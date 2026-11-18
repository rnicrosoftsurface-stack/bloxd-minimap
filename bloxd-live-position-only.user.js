// ==UserScript==
// @name         Bloxd Live Position ONLY v2
// @namespace    bloxd-minimap-safe
// @version      2.0.0
// @description  Nur sichtbare XYZ-Koordinaten zur externen Minimap uebertragen; kein Radar, kein Mining, keine Steuerung.
// @match        https://bloxd.io/*
// @match        https://bloxd.dev/*
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(() => {
    "use strict";

    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const MAP = "https://rnicrosoftsurface-stack.github.io/bloxd-minimap/live.html";
    const ORIGIN = "https://rnicrosoftsurface-stack.github.io";
    const numPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
    const triplePattern = /^\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*$/;

    let position = null;
    let lastPosition = 0;
    let mapWindow = null;
    const calls = new WeakMap();

    function accept(x, y, z) {
        if (![x, y, z].every(Number.isFinite)) return;
        if (Math.abs(y) > 2048 || Math.abs(x) > 1e9 || Math.abs(z) > 1e9) return;
        position = { x, y, z };
        lastPosition = performance.now();
    }

    function readNumber(ctx, raw, px, py) {
        if (!Number.isFinite(px) || !Number.isFinite(py)) return;
        let a = calls.get(ctx.canvas);
        if (!a) {
            a = [];
            calls.set(ctx.canvas, a);
        }
        const now = performance.now();
        a.push({ value: Number(raw), raw, x: px, y: py, t: now });
        while (a.length && now - a[0].t > 120) a.shift();
        if (a.length > 12) a.splice(0, a.length - 12);
        if (a.length < 3) return;

        let best = null, bestScore = -Infinity;
        for (let i = 0; i < a.length - 2; i++) {
            for (let j = i + 1; j < a.length - 1; j++) {
                for (let k = j + 1; k < a.length; k++) {
                    const t = [a[i], a[j], a[k]].sort((p, q) => p.x - q.x);
                    if (t[2].x - t[0].x < 18) continue;
                    if (Math.max(...t.map(p => p.y)) - Math.min(...t.map(p => p.y)) > 10) continue;
                    if (!(t[0].x < t[1].x && t[1].x < t[2].x)) continue;
                    if (Math.abs(t[1].value) > 2048) continue;

                    const score =
                        Math.log10(1 + Math.abs(t[0].value)) +
                        Math.log10(1 + Math.abs(t[2].value)) +
                        (Math.abs(t[1].value) <= 512 ? 6 : 0) +
                        (Math.abs(t[0].value) > 256 || Math.abs(t[2].value) > 256 ? 3 : 0) +
                        (/coordinate/i.test(String(ctx.canvas.className || "")) ? 20 : 0);
                    if (score > bestScore) {
                        best = t;
                        bestScore = score;
                    }
                }
            }
        }
        if (best && bestScore > 7) {
            accept(best[0].value, best[1].value, best[2].value);
        }
    }

    // Nur die bereits sichtbare Koordinaten-Anzeige lesen.
    // Kein Zugriff auf Bloxd-Engine, Weltbloecke, Spielerlisten oder Eingaben.
    function installCoordinateReader() {
        const proto = W.CanvasRenderingContext2D?.prototype;
        if (!proto || proto.__bloxdPositionOnlyV2) return;
        const original = proto.fillText;

        function observedFillText(text, x, y, maxWidth) {
            try {
                const raw = String(text).trim();
                const match = triplePattern.exec(raw);
                if (match) {
                    accept(Number(match[1]), Number(match[2]), Number(match[3]));
                } else if (numPattern.test(raw) && this.canvas) {
                    readNumber(this, raw, Number(x), Number(y));
                }
            } catch (_) {}

            return arguments.length >= 4
                ? original.call(this, text, x, y, maxWidth)
                : original.call(this, text, x, y);
        }

        Object.defineProperty(proto, "__bloxdPositionOnlyV2", {
            value: true, configurable: true
        });
        proto.fillText = observedFillText;

        W.addEventListener("pagehide", () => {
            if (proto.fillText === observedFillText) proto.fillText = original;
        }, { once: true });
    }

    function seed() {
        const lobby = new URL(W.location.href).searchParams.get("lobby") || "1234";
        return lobby;
    }

    function openMap() {
        const u = new URL(MAP);
        u.searchParams.set("seed", seed());
        u.searchParams.set("radius", "30");
        u.searchParams.set("y", "p");
        if (position) {
            u.searchParams.set("x", String(Math.floor(position.x)));
            u.searchParams.set("z", String(Math.floor(position.z)));
        }
        mapWindow = W.open(u.href, "BloxdLiveMap");
        if (mapWindow) mapWindow.focus();
        else console.warn("Live-Minimap: Pop-up in Firefox erlauben.");
    }

    GM_registerMenuCommand("Live-Minimap öffnen", openMap);

    W.addEventListener("keydown", e => {
        if (e.altKey && e.shiftKey && e.code === "KeyM" && !e.repeat) {
            e.preventDefault();
            openMap();
        }
    }, true);

    W.setInterval(() => {
        if (!position || performance.now() - lastPosition > 2000) return;
        if (!mapWindow || mapWindow.closed) return;

        try {
            mapWindow.postMessage({
                type: "BLOXD_POSITION_V1",
                ...position,
                seed: seed()
            }, ORIGIN);
        } catch (_) {}
    }, 350);

    installCoordinateReader();
})();