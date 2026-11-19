// ==UserScript==
// @name         Bloxd Live Position Bridge v4.3 Smooth
// @namespace    bloxd-minimap-safe
// @version      4.3.0
// @description  Fluessige Live-XYZ-Karte mit Pixel-OCR ohne fillText-Hook
// @match        https://bloxd.io/*
// @match        https://bloxd.dev/*
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(() => {
  "use strict";

  const MAP = "https://rnicrosoftsurface-stack.github.io/bloxd-minimap/live.html";
  const ORIGIN = "https://rnicrosoftsurface-stack.github.io";
  const T = {
    "1": [[6,[63,511,511,31,31,31,31,31,31,31,31,31]],[4,[31,511,31,31,31,31,31,31,31,31,31,31]],[5,[28,508,28,28,12,12,12,12,12,12,12,12]]],
    "0": [[8,[126,255,455,455,387,387,387,387,455,455,510,252]],[9,[124,254,462,454,455,391,391,455,454,462,254,124]],[9,[124,254,231,455,455,455,455,455,455,231,254,124]],[9,[60,126,198,195,387,387,387,387,195,198,254,60]],[9,[60,126,198,199,387,387,387,387,455,198,254,124]],[7,[62,238,455,455,455,455,455,455,455,455,254,56]],[7,[62,239,455,455,455,455,455,455,199,199,254,56]]],
    "3": [[8,[252,510,7,7,30,252,254,7,7,7,510,508]],[8,[254,254,7,7,30,252,254,7,7,7,511,508]],[6,[508,28,7,7,28,248,28,7,7,7,508,504]]],
    "8": [[8,[254,511,455,455,455,254,511,455,387,455,511,254]],[9,[124,254,231,199,238,124,254,455,455,455,254,124]],[6,[252,455,455,455,455,252,455,451,451,451,511,60]]],
    "9": [[8,[254,511,455,455,451,455,511,255,7,7,510,508]],[9,[124,254,462,454,455,463,511,254,14,14,252,248]],[9,[124,254,454,391,391,455,127,7,6,14,252,248]],[8,[124,510,387,387,387,387,255,3,3,6,508,248]]],
    ".": [[3,[0,0,0,0,0,0,0,0,0,0,511,511]],[2,[0,0,0,0,0,0,0,0,0,0,511,511]],[2,[0,0,0,0,0,0,0,0,0,0,511,480]]],
    "-": [[5,[0,0,0,0,0,0,0,511,511,0,0,0]],[5,[0,0,0,0,0,0,511,124,0,0,0,0]],[5,[0,0,0,0,0,0,511,127,0,0,0,0]]],
    "2": [[9,[124,254,143,7,14,14,28,120,240,224,511,511]],[8,[252,510,262,2,6,6,60,224,192,384,511,511]]],
    "5": [[8,[510,510,448,448,448,508,510,31,7,30,510,508]],[8,[255,255,224,192,192,254,255,7,7,7,511,508]]],
    "4": [[9,[14,30,62,62,126,238,238,462,511,511,14,14]],[10,[28,28,28,60,124,124,252,476,511,511,28,28]],[10,[12,28,28,28,60,108,204,511,255,12,12,12]],[10,[28,28,28,60,60,108,396,511,511,12,12,12]],[10,[28,28,28,60,44,108,396,511,511,12,12,12]],[7,[14,30,30,30,62,238,462,511,511,511,14,6]]],
    "6": [[9,[62,126,224,192,384,508,455,387,387,198,254,60]]],
    "7": [[7,[511,15,14,14,14,24,24,16,48,48,48,32]]]
  };

  let last = null;
  let seen = 0;
  let ack = 0;
  let tab = null;
  let root, status, coords, body, toggle;
  let error = "Warte auf Koordinaten";
  let lastSent = null;
  let lastSentAt = 0;

  function readXYZ() {
    const c = document.querySelector("canvas.CoordinateCanvas");

    if (!c) {
      error = "Koordinaten-Canvas fehlt";
      return null;
    }

    let img;
    try {
      img = c.getContext("2d")?.getImageData(0, 0, c.width, c.height);
    } catch (_) {
      error = "Pixel nicht lesbar";
      return null;
    }

    if (!img || img.width < 40 || img.width > 1600 ||
        img.height < 12 || img.height > 150) {
      error = "Unbekannte Canvas-Groesse";
      return null;
    }

    const {width:w, height:h, data:d} = img;
    const bright = (x, y) => {
      const i = (y * w + x) * 4;
      return d[i+3] > 100 && d[i] > 175 &&
             d[i+1] > 175 && d[i+2] > 175;
    };

    const rows = [];
    for (let y=0; y<h; y++) {
      let count=0;
      for (let x=0; x<w; x++) if (bright(x,y)) count++;
      if (count>=2) rows.push(y);
    }

    if (!rows.length) {
      error = "Keine Schriftpixel";
      return null;
    }

    const y0 = rows[0];
    const ink = rows.at(-1) - y0 + 1;

    if (ink < 8 || ink > 40) {
      error = "Schriftgroesse nicht erkannt";
      return null;
    }

    const cols = Array(w).fill(false);
    for (let x=0; x<w; x++) {
      for (let y=y0; y<y0+ink; y++) {
        if (bright(x,y)) {
          cols[x] = true;
          break;
        }
      }
    }

    const pieces = [];
    for (let x=0; x<w;) {
      if (!cols[x]) {
        x++;
        continue;
      }

      let end=x;
      while (end+1<w && cols[end+1]) end++;

      const width=end-x+1;
      const parts=width>12 ? Math.max(2,Math.round(width/9)) : 1;

      for (let k=0; k<parts; k++) {
        let l=x+Math.round(width*k/parts);
        let r=x+Math.round(width*(k+1)/parts)-1;
        while (l<=r && !cols[l]) l++;
        while (r>=l && !cols[r]) r--;
        if (l<=r) pieces.push([l,r]);
      }

      x=end+1;
    }

    const groups=[];
    for (const p of pieces) {
      if (!groups.length || p[0]-groups.at(-1).at(-1)[1]>12) {
        groups.push([p]);
      } else {
        groups.at(-1).push(p);
      }
    }

    if (groups.length!==3) {
      error = "XYZ-Gruppen nicht erkannt";
      return null;
    }

    function letter(l,r) {
      const len=r-l+1;
      const bits=[];

      for (let v=0; v<12; v++) {
        const y=y0+Math.min(ink-1,Math.floor((v+0.5)*ink/12));
        let row=0;
        for (let u=0; u<9; u++) {
          const x=l+Math.min(len-1,Math.floor((u+0.5)*len/9));
          row=(row<<1)+Number(bright(x,y));
        }
        bits.push(row);
      }

      let result="?",best=Infinity;
      for (const [symbol,variants] of Object.entries(T)) {
        for (const [width,pattern] of variants) {
          let distance=1.5*Math.abs(len-width);
          for (let i=0;i<12;i++) {
            let mask=bits[i]^pattern[i];
            while (mask) {
              mask&=mask-1;
              distance++;
            }
          }
          if (distance<best) {
            best=distance;
            result=symbol;
          }
        }
      }
      return best<=17 ? result : "?";
    }

    const values=groups.map(g=>
      g.map(([l,r])=>letter(l,r)).join("")
    );

    if (values.some(s=>!/^-?\d+\.\d{2}$/.test(s))) {
      error = "Ziffer nicht sicher erkannt";
      return null;
    }

    const [x,y,z]=values.map(Number);
    if (![x,y,z].every(Number.isFinite) ||
        Math.abs(y)>2048 || Math.abs(x)>1e9 || Math.abs(z)>1e9) {
      error = "XYZ unplausibel";
      return null;
    }

    error="";
    return {x,y,z};
  }

  const seed=()=>new URL(location.href).searchParams.get("lobby")||"1234";

  function openMap() {
    const url=new URL(MAP);
    url.searchParams.set("seed",seed());
    url.searchParams.set("radius","30");
    url.searchParams.set("y","p");
    url.searchParams.set("v","6");

    if (last && performance.now()-seen<3000) {
      url.searchParams.set("x",String(Math.floor(last.x)));
      url.searchParams.set("z",String(Math.floor(last.z)));
    }

    tab=window.open(url.href,"BloxdLiveMap");
    if (tab) tab.focus();
    else error="Pop-up blockiert";
  }

  function refresh() {
    if (!root) return;
    const fresh=!!last && performance.now()-seen<2000;
    const connected=fresh && tab && !tab.closed && Date.now()-ack<3000;
    const newStatus=connected ? "● LIVE VERBUNDEN" :
      fresh ? "● POSITION ERKANNT" : "● WARTE AUF XYZ";

    if (status.textContent!==newStatus) status.textContent=newStatus;
    status.style.color=connected?"#5af0a2":fresh?"#ffcc66":"#b6c5d6";

    const nextText=fresh ?
      "X "+last.x.toFixed(2)+" Y "+last.y.toFixed(2)+" Z "+last.z.toFixed(2) :
      error;
    if (coords.textContent!==nextText) coords.textContent=nextText;
  }

  function makeMenu() {
    if (!document.body || document.getElementById("bloxd-map-v43")) return;
    root=document.createElement("div");
    root.id="bloxd-map-v43";
    root.style.cssText=
      "position:fixed;bottom:16px;right:14px;width:266px;" +
      "z-index:2147483647;background:#091823f5;" +
      "border:1px solid #456079;border-radius:10px;" +
      "color:white;padding:10px;font:12px Arial;" +
      "box-shadow:0 6px 24px #0009";

    const head=document.createElement("div");
    head.style.cssText=
      "display:flex;justify-content:space-between;align-items:center;gap:6px";

    const name=document.createElement("b");
    name.textContent="LIVE MAP v4.3";
    status=document.createElement("span");
    status.style.cssText="font:9px Consolas;white-space:nowrap";

    toggle=document.createElement("button");
    toggle.textContent="−";
    toggle.style.cssText=
      "cursor:pointer;background:#172a3b;color:white;" +
      "border:1px solid #50667d;border-radius:5px";

    head.append(name,status,toggle);
    body=document.createElement("div");

    const button=document.createElement("button");
    button.textContent="LIVE-KARTE ÖFFNEN";
    button.style.cssText=
      "cursor:pointer;background:#166949;color:white;" +
      "border:1px solid #339069;border-radius:6px;" +
      "margin-top:9px;width:100%;padding:10px;font-weight:bold";
    button.onclick=openMap;

    coords=document.createElement("div");
    coords.style.cssText=
      "font:10px/1.5 Consolas;color:#b5ccdd;margin-top:8px";

    body.append(button,coords);
    toggle.onclick=()=>{
      body.hidden=!body.hidden;
      toggle.textContent=body.hidden?"+":"−";
    };

    root.append(head,body);
    document.body.appendChild(root);
    refresh();
  }

  window.addEventListener("message",e=>{
    if (e.origin!==ORIGIN || e.source!==tab ||
        e.data?.type!=="BLOXD_POSITION_ACK_V1") return;
    ack=Date.now();
    refresh();
  });

  window.addEventListener("keydown",e=>{
    if (!e.altKey || !e.shiftKey || e.repeat) return;
    if (e.code==="KeyM") {
      e.preventDefault();
      openMap();
    }
    if (e.code==="KeyL" && root) {
      e.preventDefault();
      root.hidden=!root.hidden;
    }
  },true);

  if (typeof GM_registerMenuCommand==="function") {
    GM_registerMenuCommand("Live-Karte öffnen",openMap);
    GM_registerMenuCommand("Live-Menü anzeigen",()=>{
      if (root) root.hidden=false;
    });
  }

  // 120 ms statt 350 ms: ca. 8 neue Positionsmessungen pro Sekunde.
  setInterval(()=>{
    const next=readXYZ();
    if (next) {
      last=next;
      seen=performance.now();
    }

    const now=performance.now();
    if (last && now-seen<2000 && tab && !tab.closed) {
      const changed=!lastSent ||
        Math.abs(last.x-lastSent.x)>=0.01 ||
        Math.abs(last.y-lastSent.y)>=0.01 ||
        Math.abs(last.z-lastSent.z)>=0.01;

      // Nicht staendig dieselbe Position schicken.
      if (changed || now-lastSentAt>=600) {
        try {
          tab.postMessage({
            type:"BLOXD_POSITION_V1",
            x:last.x, y:last.y, z:last.z, seed:seed()
          },ORIGIN);
          lastSent={...last};
          lastSentAt=now;
        } catch (_) {}
      }
    }
    refresh();
  },120);

  if (document.readyState==="loading") {
    document.addEventListener("DOMContentLoaded",makeMenu,{once:true});
  } else {
    makeMenu();
  }
})();