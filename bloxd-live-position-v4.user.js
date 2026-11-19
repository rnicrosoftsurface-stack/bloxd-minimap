// ==UserScript==
// @name         Bloxd Live Position Bridge v4 PIXEL ONLY
// @namespace    bloxd-minimap-safe
// @version      4.0.0
// @description  Liest die sichtbaren XYZ-Pixel ohne Canvas-Hook, dazu kleines Live-Menue.
// @match        https://bloxd.io/*
// @match        https://bloxd.dev/*
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(() => {
    "use strict";

    const W = window;
    const MAP_URL = "https://rnicrosoftsurface-stack.github.io/bloxd-minimap/live.html";
    const MAP_ORIGIN = "https://rnicrosoftsurface-stack.github.io";
    const PANEL_ID = "bloxd-live-position-bridge-v4";


    let pos=null,lastPos=0,lastAck=0,mapTab=null;
    let panel=null,statusEl=null,coordsEl=null,inner=null,toggleBtn=null;
    let lastReadError="";
    function accept(x,y,z){
        pos={x,y,z};lastPos=performance.now();
    }

    // Character samples trained only on the user's 253 x 17 pixel coordinate PNG.
    // Digits 6 and 7 use provisional shapes and require additional validation.
    const TEMPLATES = {"0":[[8,[126,255,455,455,387,387,387,387,455,455,510,252]],[9,[124,254,462,454,455,391,391,455,454,462,254,124]],[9,[124,254,231,455,455,455,455,455,455,231,254,124]]],"1":[[6,[63,511,511,31,31,31,31,31,31,31,31,31]]],"2":[[9,[124,254,143,7,14,14,28,120,240,224,511,511]]],"3":[[8,[252,510,7,7,30,252,254,7,7,7,510,508]],[8,[254,254,7,7,30,252,254,7,7,7,511,508]]],"4":[[9,[14,30,62,62,126,238,238,462,511,511,14,14]],[9,[14,30,30,62,126,126,238,462,511,511,14,14]]],"5":[[8,[510,510,448,448,448,508,510,31,7,30,510,508]],[8,[255,255,224,192,192,254,255,7,7,7,511,508]]],"6":[[8,[510,510,448,448,448,254,511,455,387,455,511,254]]],"7":[[9,[511,511,14,14,28,28,56,56,112,112,224,224]]],"8":[[8,[254,511,455,455,455,254,511,455,387,455,511,254]],[9,[124,254,231,199,238,124,254,455,455,455,254,124]]],"9":[[8,[254,511,455,455,451,455,511,255,7,7,510,508]],[9,[124,254,462,454,455,463,511,254,14,14,252,248]]],".":[[3,[0,0,0,0,0,0,0,0,0,0,511,511]]],"-":[[5,[0,0,0,0,0,0,0,511,511,0,0,0]]]};

    function readCoordinatesFromPixels(){
        const canvas=document.querySelector("canvas.CoordinateCanvas");
        if(!canvas){lastReadError="CoordinateCanvas fehlt";return null;}
        let img;
        try{img=canvas.getContext("2d")?.getImageData(0,0,canvas.width,canvas.height);}
        catch(_){lastReadError="Pixel nicht lesbar";return null;}
        if(!img || img.width!==253 || img.height!==17){
            lastReadError="Andere Canvas-Groesse";return null;
        }
        const w=img.width, d=img.data, col=new Array(w).fill(false);
        for(let x=0;x<w;x++){
            for(let y=1;y<13;y++){
                const i=(y*w+x)*4;
                if(d[i+3]>100&&d[i]>175&&d[i+1]>175&&d[i+2]>175){
                    col[x]=true;break;
                }
            }
        }
        const pieces=[];
        for(let x=0;x<w;){
            if(!col[x]){x++;continue;}
            let end=x;
            while(end+1<w&&col[end+1])end++;
            const width=end-x+1;
            const parts=width>12?Math.max(2,Math.round(width/9)):1;
            for(let k=0;k<parts;k++){
                let l=x+Math.round(width*k/parts),r=x+Math.round(width*(k+1)/parts)-1;
                while(l<=r&&!col[l])l++;
                while(r>=l&&!col[r])r--;
                if(l<=r)pieces.push([l,r]);
            }
            x=end+1;
        }
        const groups=[];
        for(const p of pieces){
            if(!groups.length||p[0]-groups[groups.length-1].at(-1)[1]>12)groups.push([p]);
            else groups.at(-1).push(p);
        }
        if(groups.length!==3){lastReadError="XYZ-Gruppen nicht erkannt";return null;}
        function matchGlyph(l,r){
            const bits=[],len=r-l+1;
            for(let y=1;y<13;y++){
                let row=0;
                for(let u=0;u<9;u++){
                    const x=l+Math.min(len-1,Math.floor((u+.5)*len/9));
                    const i=(y*w+x)*4;
                    row=(row<<1)+(d[i+3]>100&&d[i]>175?1:0);
                }
                bits.push(row);
            }
            let best="?",score=Infinity;
            for(const [symbol,patterns] of Object.entries(TEMPLATES)){
                for(const [size,template] of patterns){
                    let error=1.5*Math.abs(len-size);
                    for(let i=0;i<12;i++){
                        let mask=bits[i]^template[i];
                        while(mask){mask&=mask-1;error++;}
                    }
                    if(error<score){score=error;best=symbol;}
                }
            }
            return score<=17?best:"?";
        }
        const raw=groups.map(g=>g.map(([l,r])=>matchGlyph(l,r)).join(""));
        if(raw.some(v=>v.includes("?")||!/^-?\d+(?:\.\d+)?$/.test(v))){
            lastReadError="Ziffer nicht sicher erkannt";return null;
        }
        const [x,y,z]=raw.map(Number);
        if(![x,y,z].every(Number.isFinite)||Math.abs(y)>2048||Math.abs(x)>1e9||Math.abs(z)>1e9){
            lastReadError="XYZ ungueltig";return null;
        }
        lastReadError="";
        return {x,y,z};
    }

    function getSeed() {
        return new URL(W.location.href).searchParams.get("lobby") || "1234";
    }

    function openMap() {
        const u = new URL(MAP_URL);
        u.searchParams.set("v", "4");
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
            : (lastReadError || "Warte auf Koordinatenanzeige");
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
        title.textContent = "LIVE MAP v4";
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
        const next=readCoordinatesFromPixels();
        if(next)accept(next.x,next.y,next.z);
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

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createUI, { once: true });
    } else {
        createUI();
    }
})();