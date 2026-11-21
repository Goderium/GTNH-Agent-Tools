
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const core = globalThis.TooltipCore;
  const demos = {
    item: ["§9星核部件","§7可用于强化主机","§8长按 [§7G§8] 打开指南","@shift §b已展开部件参数","@advanced §8example:star_core","§9§oTwist Space Technology"],
    multiblock: ["§f多方块控制器","§7测试型矿物处理设备","§7并行处理：§e32§r","@normal §8按住 Shift 查看结构","@shift §b结构尺寸：9 × 7 × 5","@shift §7维护仓：§f1 个","@shift §7电力仓：§f1 个或更多","§9§oGregTech"],
    nei: ["§f富集矿物处理§h","§7需求：§e512 EU/t","§7耗时：§e4.80 s","§7产物概率：§e80%","@alt §7按 R 查看配方，按 U 查看用途"],
    mui1: ["§f流体槽位","§7点击清除锁定流体","@shift §7当前锁定：§b蒸汽"],
    mui2: ["流体缓存设置","§7切换后将应用到下一批配方。","@shift §e仅显示当前页的可用槽位。"],
    waila: ["§d无线模式","§b当前EU消耗§r: §61,048,576§r EU"],
    "machine-scanner": ["已载入样板","电路板; 处理器; 晶体管; 电感; ","二极管; "],
    scanner: ["§f便携式扫描仪","§9方块扫描数据结果：","@section 机器信息","已载入样板","电路板; 处理器; "],
    chat: ["§b──────── 机器信息 ────────","§f进度：§a120 §f/ §e240 §ft","§f能量消耗：§6128 §fEU/t","§f机器§a活跃"],
    text: ["§a绿色正文 §c红色正文 §6金色正文","§b§l水色粗体 §r§d§o淡紫斜体","@style rainbow Twist Space Technology"],
    guide: ["§f激光陨星采矿场","§7查看设备结构与采矿周期"],
    vanilla: ["§f物品名称","§7第一行说明","§7第二行说明"]
  };
  const hints = {
    item:"粘贴物品描述、addInformation 或事件处理后的有序文本。",
    multiblock:"按实际 Tooltip Builder 输出顺序粘贴说明，勾选 Shift 预览结构行。",
    nei:"适用于配方说明、输入 / 输出物品、面板和书签。分页提示可通过导入的语言键覆盖。",
    mui1:"预览 Widget Tooltip 的文本与换行，可按控件设置调整阴影。",
    mui2:"预览 RichTooltip 的文本行。自定义图标、主题及绘制结果用实机对照。",
    waila:"粘贴 Waila 的头、正文和尾部。支持制表符列与可选 16 × 16 图标。",
    "machine-scanner":"按主机 getInfoData 或 getExtraInfoData 的顺序绘制纯文本。",
    scanner:"粘贴便携式扫描仪物品的完整提示，或直接导入 BridgeNH 的 Tooltip JSON。",
    chat:"粘贴三录仪发出的已解析聊天行，可为当前聊天宽度指定换行值。",
    text:"使用同一套游戏字形和格式码预览普通彩色文字。",
    guide:"预览 GuideNH 悬停文本的排版草稿。实际 Markdown 组件用截图对照。",
    vanilla:"粘贴传入 GuiScreen 悬停方法的完整文本。"
  };
  const settingIds = ["surface","skin","font-mode","scale","width","height","x","y","wrap","title-gap","shadow","paginate",
    "amp","animate","shift","ctrl","alt","advanced","theme-colors","screen"];
  const fonts = {active:null};
  let language = new Map(), screenshot = null, icon = null, textColor;
  let page = 1, frame = 0, version = 0, queued = false, current = null, timer;

  function value(id) { return $(id).type === "checkbox" ? $(id).checked : $(id).value; }
  function number(id, min, max, fallback) {
    const n = $(id).valueAsNumber ?? Number(value(id));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
  }
  function set(id, v) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return;
    const field = $(id);
    if (field.type === "checkbox") { if (typeof v === "boolean") field.checked = v; }
    else field.value = String(v);
  }
  function notify(message) {
    $("notice").textContent = message;
    $("notice").hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { $("notice").hidden = true; },4500);
  }
  function readLang(text, table) {
    for (const raw of text.replace(/^\uFEFF/,"").split(/\r?\n/)) {
      const split = raw.indexOf("=");
      if (split < 1 || /^[#!]/.test(raw.trimStart())) continue;
      table.set(raw.slice(0,split).trim(), raw.slice(split+1));
    }
  }
  function translate(key, args, missing) {
    const source = language.get(key);
    if (source === undefined) { missing.add(key); return key; }
    let i=0;
    return source.replace(/%%|%(?:(\d+)\$)?(?:[\d.]*[dfs])/g, (all,index) => all === "%%" ? "%" : args[index ? +index-1 : i++] ?? all);
  }
  function resolveLines(opts) {
    const missing = new Set();
    const flags = {shift:value("shift"),ctrl:value("ctrl"),alt:value("alt"),advanced:value("advanced")};
    flags.normal = !(flags.shift || flags.ctrl || flags.alt);
    const source = value("content");
    if (source.length > 64000) throw new Error("内容超出 64,000 字符，请缩短后预览。");
    const input = source.split("\n");
    if (input.at(-1) === "") input.pop();
    const lines = [];
    for (let text of input) {
      const conditional = /^@(shift|ctrl|alt|advanced|normal) (.*)$/i.exec(text);
      if (conditional) {
        if (!flags[conditional[1].toLowerCase()]) continue;
        text = conditional[2];
      }
      if (text.startsWith("@lang ")) {
        const [key,...args]=text.slice(6).split("|").map(s=>s.trim());
        text = translate(key,args,missing);
      }
      if (text.startsWith("@section ") && opts.profile === "chat") text = "§b──────── " + text.slice(9) + " ────────";
      lines.push(...text.split(/\r?\n/));
    }
    return {lines, missing:[...missing]};
  }
  function options() {
    const profile = value("surface") || "item";
    const width = number("width",40,1920,427), height = number("height",40,1080,240);
    const theme = value("theme-colors").trim();
    const colors = theme ? theme.split(/[\s,]+/).map(n=>n.replace(/^#|^0x/i,"")) : null;
    if (colors && (colors.length !== 4 || colors.some(c=>!/^[0-9a-f]{8}$/i.test(c)))) {
      throw new Error("配色请填写四个 8 位 ARGB 值。");
    }
    return {
      profile,width,height,
      x:number("x",0,width-1,160), y:number("y",0,height-1,124),
      hudX:number("x",0,100,100), hudY:number("y",0,100,0),
      scale:+value("scale") || 2,
      wrap:number("wrap",0,1920,0), screen:value("screen"),
      fontMode:value("font-mode"), skin:value("skin"), amp:value("amp"), page, frame,time:frame*100,
      advanced:value("advanced"),modifiers:{shift:value("shift"),ctrl:value("ctrl"),alt:value("alt")},
      pageText:language.has("nei.inventory.tooltip.page")
        ? "§o" + translate("nei.inventory.tooltip.page",["{page}","{pages}","Z"],new Set())
        : "§o页码: {page} / {pages} [按 Z 进入下一页]",
      titleGap:value("title-gap") === "" ? undefined : +value("title-gap"),
      shadow:value("shadow") === "" ? undefined : value("shadow") === "true",
      paginate:value("paginate"),
      colors:colors?.map(c=>parseInt(c,16)),textColor:profile==="waila" ? textColor : undefined
    };
  }
  function requestRender() {
    version++;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render(version).catch(e => {
        $("advisory").textContent = e.message;
        current = null;
        $("save-png").disabled = true;
      });
    });
  }
  async function render(ticket) {
    const opts = options();
    const {lines,missing} = resolveLines(opts);
    let font = fonts.active;
    if (opts.fontMode === "modern" && !font?.modern?.size) font = null;
    if (font) await font.ensurePages(lines.concat([opts.pageText]));
    if (ticket !== version) return;
    const layout = core.plan(lines,font,opts);
    const assets = {font, icon, fallback:[]};
    const box = core.bounds(layout,opts,icon);
    current = {opts,layout,assets,box,lines};
    $("preview").hidden = !lines.length;
    $("empty").hidden = !!lines.length;
    if (lines.length) core.raster($("preview"),layout,box,opts,assets);
    $("save-png").disabled = !lines.length;
    $("metrics").textContent = lines.length
      ? layout.width + " × " + layout.height + " GUI px · " + layout.rows.length + " 行 · " + opts.scale + "×" : "";
    $("pagination").hidden = layout.pageCount < 2;
    $("page-info").textContent = layout.page + " / " + layout.pageCount;
    $("prev").disabled = layout.page <= 1;
    $("next").disabled = layout.page >= layout.pageCount;
    const messages = [];
    if (!font) messages.push(opts.fontMode === "modern" && fonts.active
      ? "还需导入 Angelica JAR 才能使用现代字形。" : "当前使用浏览器草稿字体。");
    if (layout.missing.length) messages.push("游戏字体缺字：" + layout.missing.slice(0,12).join(" "));
    if (missing.length) messages.push("缺少翻译键：" + missing.slice(0,4).join("、"));
    if (box.bx < 0 || box.by < 0 || box.bx+box.w > opts.width || box.by+box.h > opts.height) messages.push("预览框超出视口。");
    $("advisory").textContent = messages.join(" ");
    renderReference();
  }
  async function loadFonts(files) {
    const sorted=[...files].sort((a,b)=>Number(!a.name.includes("1.7.10-client"))-Number(!b.name.includes("1.7.10-client")));
    fonts.active = await TooltipAssets.load(sorted);
    if (!fonts.active.modern?.size && value("font-mode")==="modern") set("font-mode","legacy");
    $("font-status").textContent=fonts.active.modern?.size ? "游戏字体 · Angelica 与 1.7.10" : "游戏字体 · Minecraft 1.7.10";
  }
  function readFontSettings(text) {
    const keys = {fontAAMode:["aaMode",0,2],fontAAStrength:["aaStrength",1,24],fontBrightness:["brightness",0,1],
      fontShadowOffset:["shadowOffset",0,2],fontShadowOffsetUC:["unicodeShadow",0,2],
      shadowCopies:["shadowCopies",1,4],boldCopies:["boldCopies",1,4],glyphSpacing:["glyphSpacing",-2,4]};
    const config={};
    for (const [name,[key,min,max]] of Object.entries(keys)) {
      const found=new RegExp("^\\s*[IS]:"+name+"=([^\\r\\n]+)","m").exec(text);
      const n = found ? Number(found[1].trim()) : NaN;
      if (Number.isFinite(n)) config[key]=Math.max(min,Math.min(max,n));
    }
    return config;
  }
  function itemMetadata(request,missing) {
    const item = request.item;
    if (!item || typeof item!=="object") return null;
    let displayName=item.displayName;
    if (!displayName && typeof item.nameKey==="string") displayName=translate(item.nameKey,[],missing);
    if (typeof displayName!=="string" || !displayName || /[\r\n]/.test(displayName)) {
      throw new Error("item 需要有效的 displayName 或 nameKey。");
    }
    if (item.creditDivider!=null && typeof item.creditDivider!=="boolean") throw new Error("creditDivider 需要布尔值。");
    if (item.numericId!=null && (!Number.isSafeInteger(item.numericId)||item.numericId<0)) throw new Error("numericId 需要非负整数。");
    if (item.keys!=null && (!Array.isArray(item.keys)||item.keys.some(key=>!["shift","ctrl","alt"].includes(key)))) {
      throw new Error("item.keys 只接收 shift、ctrl、alt。");
    }
    const credits = item.credits;
    if (credits!=null && (!Array.isArray(credits)||credits.length>48||
      credits.some(c=>!c || typeof c.text!=="string" || c.text.length>1024))) throw new Error("item.credits 需要带 text 的条目数组。");
    return {...item,displayName,credits:credits?.map(credit=>{
      if (!credit.formatKey) return credit;
      const format=translate(credit.formatKey,["\u0001"],missing).split("\u0001");
      return format.length===2 ? {...credit,prefix:format[0],suffix:format[1]} : credit;
    })};
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function saveCanvas(canvas,name) {
    canvas.toBlob(blob=>{if (blob) download(blob,name);},"image/png");
  }
  function wrapFile(id, handler) {
    $(id).addEventListener("change", async event => {
      const files = [...event.target.files];
      event.target.value = "";
      if (!files.length) return;
      try { await handler(files); }
      catch(e) { notify(e.message); }
    });
  }
  function selectSurface() {
    const isHud = value("surface") === "waila";
    const x = $("x"), y = $("y");
    if (String(x.max) !== (isHud ? "100" : "1919")) {
      x.max = isHud ? 100 : 1919; y.max = isHud ? 100 : 1079;
      set("x",isHud ? 100 : 160); set("y",isHud ? 100 : 124);
    }
    $("source-help").textContent = hints[value("surface")] || hints.item;
  }
  async function loadScreenshot(file) {
    if (file.size > 40 * 1024**2) throw new Error("截图文件不能超过 40 MiB。");
    const image = await createImageBitmap(file,{colorSpaceConversion:"none"});
    if (image.width>8192 || image.height>8192 || image.width*image.height>16000000) {
      image.close();
      throw new Error("截图像素超出范围。");
    }
    return image;
  }
  function setCrop(x,y,w,h) {
    set("crop-x",x); set("crop-y",y); set("crop-w",w); set("crop-h",h);
    renderReference();
  }
  function renderReference() {
    if (!screenshot) return;
    const x = number("crop-x",0,screenshot.width-1,0);
    const y = number("crop-y",0,screenshot.height-1,0);
    const w = number("crop-w",1,screenshot.width-x,1);
    const h = number("crop-h",1,screenshot.height-y,1);
    const raw = $("reference"), cmp = $("comparison"), diff = $("diff");
    for (const canvas of [raw,cmp,diff]) {canvas.width=w; canvas.height=h;}
    const rawCtx = raw.getContext("2d",{willReadFrequently:true});
    rawCtx.drawImage(screenshot,x,y,w,h,0,0,w,h);
    const cmpCtx = cmp.getContext("2d",{willReadFrequently:true});
    if (current?.lines.length) {
      const full = document.createElement("canvas");
      core.raster(full,current.layout,current.box,{...current.opts,screen:true},current.assets);
      cmpCtx.drawImage(full,-x,-y);
    }
    $("difference").hidden = !value("diff-enabled");
    if (!value("diff-enabled")) return;
    const a=rawCtx.getImageData(0,0,w,h), b=cmpCtx.getImageData(0,0,w,h);
    const out = diff.getContext("2d").createImageData(w,h);
    let hits=0, compared=0, totalError=0;
    for (let p=0;p<a.data.length;p+=4) {
      if (a.data[p+3]!==255 || b.data[p+3]!==255) continue;
      compared++;
      const delta = Math.max(Math.abs(a.data[p]-b.data[p]),Math.abs(a.data[p+1]-b.data[p+1]),Math.abs(a.data[p+2]-b.data[p+2]));
      totalError += delta;
      if (delta) hits++;
      out.data.set([delta ? 245 : 27, delta ? 68 : 70, delta ? 77 : 38, delta ? Math.min(255,85+delta) : 255],p);
    }
    diff.getContext("2d").putImageData(out,0,0);
    $("diff-label").textContent = compared
      ? "不透明像素差分 · " + hits.toLocaleString() + " / " + compared.toLocaleString() + " 不同 · 平均最大通道差 " + (totalError/compared).toFixed(2)
      : "没有重合的不透明像素";
  }
  function loadProject(data) {
    if (data?.schema === "gtnh-tooltip-workbench/1" && typeof data.content === "string") {
      const stored = {...data.settings};
      for (const [id,v] of Object.entries(stored)) if (settingIds.includes(id)) set(id,v);
      selectSurface();
      set("x",stored.x); set("y",stored.y);
      set("content",data.content);
      textColor = Number.isInteger(data.textColor) ? data.textColor : undefined;
      language = new Map(Array.isArray(data.language) ? data.language.filter(p=>Array.isArray(p) && typeof p[0]==="string" && typeof p[1]==="string") : []);
      $("lang-status").textContent = language.size ? "已载入 " + language.size + " 条翻译" : "";
      page=1;
      requestRender();
      return;
    }
    const body = data?.data ?? data;
    let lines=Array.isArray(body) ? body : body?.tooltip ?? body?.lines ?? body?.entries ?? body?.data?.tooltip ?? body?.data?.lines ?? body?.data?.entries;
    if (Array.isArray(lines)) lines = lines.map(l=>typeof l==="string" ? l : l?.text ?? l?.value);
    if (!Array.isArray(lines) || !lines.every(l=>typeof l==="string")) throw new Error("JSON 需要字符串行数组或 BridgeNH 的 tooltip / lines 字段。");
    if (body.tooltipTruncated || body.complete === false || body.hasMore || body.data?.hasMore) {
      notify("导入的回执包含分页或截断标记，请补全其余行。");
    }
    set("content",lines.join("\n"));
    page=1;
    requestRender();
  }

  const swatches = ["000000","0000AA","00AA00","00AAAA","AA0000","AA00AA","FFAA00","AAAAAA",
    "555555","5555FF","55FF55","55FFFF","FF5555","FF55FF","FFFF55","FFFFFF"];
  for (let n=0;n<swatches.length;n++) {
    const code=n.toString(16), button=document.createElement("button");
    button.textContent=code;
    button.dataset.insert="§"+code;
    button.style.setProperty("--swatch","#"+swatches[n]);
    button.style.setProperty("--ink",[0,1,2,3,4,5,8,9].includes(n) ? "white" : "#121611");
    button.title="插入 §"+code;
    $("colors").append(button);
  }
  document.querySelectorAll("[data-insert]").forEach(button=>button.addEventListener("click",()=>{
    const box=$("content");
    box.setRangeText(button.dataset.insert,box.selectionStart,box.selectionEnd,"end");
    box.focus();
    page=1;
    requestRender();
  }));
  for (const id of settingIds.concat(["content"])) $(id).addEventListener("input",()=>{
    if (id==="surface") {selectSurface();textColor=undefined;set("theme-colors","");}
    page=1;
    requestRender();
  });
  $("load-demo").onclick = () => {set("content",(demos[value("surface")] ?? demos.item).join("\n"));page=1;requestRender();};
  $("reset-theme").onclick = () => {textColor=undefined;set("theme-colors","");requestRender();};
  $("prev").onclick=()=>{page=Math.max(1,(current?.layout.page??1)-1);requestRender();};
  $("next").onclick=()=>{page=Math.min(current?.layout.pageCount??1,(current?.layout.page??1)+1);requestRender();};
  $("copy-text").onclick=async()=>{
    try {await navigator.clipboard.writeText(resolveLines(options()).lines.join("\n"));notify("已复制渲染文本");}
    catch {notify("当前浏览器未开放剪贴板权限。");}
  };
  $("save-png").onclick=()=>saveCanvas($("preview"),"gtnh-"+value("surface")+".png");
  $("save-reference").onclick=()=>saveCanvas($("reference"),"gtnh-client-crop.png");
  $("save-project").onclick=()=>{
    const settings=Object.fromEntries(settingIds.map(id=>[id,value(id)]));
    const data={schema:"gtnh-tooltip-workbench/1",content:value("content"),settings,textColor,language:[...language]};
    download(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),"gtnh-tooltip-draft.json");
  };
  wrapFile("font-file",async files=>{
    $("font-status").textContent="正在读取字体资源…";
    try {
      await loadFonts(files);
      requestRender();
    } catch(e) {
      $("font-status").textContent=fonts.active ? "沿用已导入的字体" : "草稿字体 · 导入客户端 JAR 以使用游戏字形";
      throw e;
    }
  });
  wrapFile("lang-file",async files=>{
    const next=new Map(language);
    for (const file of files) {
      if (file.size>4*1024**2) throw new Error("单份 .lang 不能超过 4 MiB。");
      readLang(await file.text(),next);
    }
    language=next;
    $("lang-status").textContent="已载入 "+language.size+" 条翻译";
    requestRender();
  });
  wrapFile("tip-file",async ([file])=>{
    if (file.size>8*1024**2) throw new Error("导入文件不能超过 8 MiB。");
    const text=await file.text();
    if (/\.json$/i.test(file.name)) loadProject(JSON.parse(text));
    else {set("content",text);page=1;requestRender();}
  });
  async function applyWailaConfig(file) {
    if(file.size>2*1024**2) throw new Error("Waila 配置文件太大。");
    const cfg=await file.text();
    const get=(key, fallback)=> +(new RegExp("^\\s*I:waila\\.cfg\\."+key+"=(\\d+)","m").exec(cfg)?.[1]??fallback);
    set("surface","waila");selectSurface();
    set("x",get("posx",10000)/100);set("y",get("posy",0)/100);
    const alpha=Math.floor(get("alpha",80)*255/100), bg=get("bgcolor",3357055);
    set("theme-colors",[bg,bg,get("gradient1",4409791),get("gradient2",4409791)].map(rgb=>((alpha*16777216)+(rgb&0xffffff)).toString(16).padStart(8,"0")).join(" "));
    textColor=get("fontcolor",10526880);
    if (get("scale",100)!==100) notify("此 Waila.cfg 使用额外 HUD 缩放，截图对照可核实最终大小。");
  }
  wrapFile("waila-file", async ([file])=>{await applyWailaConfig(file);requestRender();});
  wrapFile("icon-file",async ([file])=>{
    const bitmap=await loadScreenshot(file);
    icon?.close();icon=bitmap;
    $("remove-icon").hidden=false;
    requestRender();
  });
  $("remove-icon").onclick=()=>{icon?.close();icon=null;$("remove-icon").hidden=true;requestRender();};
  wrapFile("ref-file",async ([file])=>{
    const bitmap=await loadScreenshot(file);
    screenshot?.close();screenshot=bitmap;
    $("reference-controls").hidden=false;
    $("clear-reference").hidden=false;
    setCrop(0,0,bitmap.width,bitmap.height);
  });
  $("clear-reference").onclick=()=>{
    screenshot?.close();screenshot=null;
    $("reference-controls").hidden=true;$("clear-reference").hidden=true;
  };
  $("crop-preview").onclick=()=>{
    if (!current || !screenshot) return;
    const {box,opts}=current;
    const l=Math.max(0,Math.floor(box.bx*opts.scale)),t=Math.max(0,Math.floor(box.by*opts.scale));
    const r=Math.min(screenshot.width,Math.ceil((box.bx+box.w)*opts.scale));
    const b=Math.min(screenshot.height,Math.ceil((box.by+box.h)*opts.scale));
    if (l>=r || t>=b) {notify("预览框未落在已导入的截图内。");return;}
    setCrop(l,t,r-l,b-t);
  };
  $("crop-full").onclick=()=>{if(screenshot)setCrop(0,0,screenshot.width,screenshot.height);};
  for(const id of ["crop-x","crop-y","crop-w","crop-h","diff-enabled"]) $(id).addEventListener("change",renderReference);
  setInterval(()=>{
    if(value("animate") && /(?:§|&)k|^@style /im.test(value("content"))) {frame=(frame+1)%10000;requestRender();}
  },100);
  function toPng(canvas) {
    return canvas.toDataURL("image/png").split(",",2)[1];
  }
  function validatedCrop(input,image) {
    const crop=input ?? {x:0,y:0,width:image.width,height:image.height};
    const {x,y,width,height}=crop;
    if (![x,y,width,height].every(Number.isInteger) || x<0 || y<0 || width<1 || height<1 || x+width>image.width || y+height>image.height) {
      throw new Error("裁切必须为截图范围内的整数像素坐标。");
    }
    return {x,y,width,height};
  }
  function cropFrame(image,crop) {
    const canvas=document.createElement("canvas");
    canvas.width=crop.width;canvas.height=crop.height;
    canvas.getContext("2d",{willReadFrequently:true}).drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
    return canvas;
  }
  function comparePixels(a,b) {
    if(a.width!==b.width || a.height!==b.height) throw new Error("比较图像尺寸不一致。");
    const raster = canvas => canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
    const left=raster(a),right=raster(b);
    let changed=0,maxChannelDelta=0;
    for(let p=0;p<left.length;p+=4) {
      const delta=Math.max(Math.abs(left[p]-right[p]),Math.abs(left[p+1]-right[p+1]),
        Math.abs(left[p+2]-right[p+2]),Math.abs(left[p+3]-right[p+3]));
      if(delta) changed++;
      maxChannelDelta=Math.max(delta,maxChannelDelta);
    }
    return {checkedPixels:a.width*a.height,differentPixels:changed,maxChannelDelta,exact:changed===0};
  }
  globalThis.GTNHTooltipWorkbench=Object.freeze({
    async run(request, files={}) {
      if (!request || typeof request!=="object") throw new Error("缺少 Agent 请求。");
      if(["mui2-render","mui2-measure","mui2-font","mui2-bundle"].includes(request.source)) {
        if(files.fonts?.length) await loadFonts(files.fonts);
        const font=fonts.active,mode=request.fontMode??"modern";
        const opts={...options(),fontMode:mode,amp:false,frame:Math.floor((request.timeMs??0)/100),time:request.timeMs??0};
        if(files.fontConfig) opts.fontSettings=readFontSettings(await files.fontConfig.text());
        if(request.source==="mui2-bundle") {
          let bytes=0;
          const archives=[];
          for(const file of files.resources??[]) {
            const zip=(await TooltipAssets.archive(file)).textureZip(request.textures);
            if(zip.size===22)continue;
            bytes+=zip.size;
            if(bytes>64*1024**2)throw Error("Adjustable HTML exceeds 64 MiB of texture resources. Supply a ZIP containing the panel textures.");
            archives.push(await new Promise((resolve,reject)=>{
              const reader=new FileReader();reader.onload=()=>resolve(reader.result);
              reader.onerror=()=>reject(reader.error);reader.readAsDataURL(zip);
            }));
          }
          if(font)await font.ensurePages(request.texts);
          return {archives,font:font?MuiDisplay.pack(font,request.texts,opts):null,opts};
        }
        const texts=request.source==="mui2-font"?request.texts:request.source==="mui2-measure"?[request.text]:request.scene.ops.filter(op=>op.type==="text").map(op=>op.text);
        if(texts.length) {
          if(!font || mode==="modern" && !font.modern?.size) throw Error("MUI2 text requires the selected game bitmap font.");
          await font.ensurePages(texts);
        }
        if(request.source==="mui2-measure") return MuiText.measure(request.text,request.maxWidth,request.options,font,opts);
        if(request.source==="mui2-font") return MuiDisplay.pack(font,texts,opts);
        const canvas=await renderMui(request.scene,request.scale,files,op=>MuiText.draw(op,request.scale,font,opts));
        let comparison=null;
        if(files.reference && request.compare!==false) {
          const image=await loadScreenshot(files.reference);
          try {comparison=comparePixels(canvas,cropFrame(image,validatedCrop(request.crop,image)));} finally {image.close();}
        }
        return {source:"mui2",png:await toPng(canvas),comparison};
      }
      if (request.source==="game-frame") {
        if (!files.reference) throw new Error("原帧模式需要游戏截图。");
        const img=await loadScreenshot(files.reference);
        try {
          const crop=validatedCrop(request.crop,img);
          const canvas=cropFrame(img,crop);
          const roundtrip=await createImageBitmap(await new Promise(resolve=>canvas.toBlob(resolve,"image/png")));
          try {
            return {source:"game-frame",crop,comparison:comparePixels(canvas,cropFrame(roundtrip,validatedCrop(null,roundtrip))),png:await toPng(canvas)};
          } finally { roundtrip.close(); }
        } finally { img.close(); }
      }
      if (request.source!=="editable") throw new Error("source 必须为 editable 或 game-frame。");
      if (!Array.isArray(request.lines) || !request.lines.every(line=>typeof line==="string")) throw new Error("lines 必须为字符串行数组。");
      const profile=request.profile || "item";
      if (!Object.hasOwn(core.profiles,profile)) throw new Error("未知场景："+profile);
      if (files.wailaConfig && profile==="waila") await applyWailaConfig(files.wailaConfig);
      for (const [id,v] of Object.entries(request.settings ?? {})) if (settingIds.includes(id)) set(id,v);
      set("surface",profile);selectSurface();
      for (const id of ["x","y"]) if (request.settings?.[id]!==undefined) set(id,request.settings[id]);
      set("content",request.lines.join("\n"));
      if (files.fonts?.length) await loadFonts(files.fonts);
      if (files.language?.length) for (const file of files.language) readLang(await file.text(),language);
      const opts=options();
      opts.page=Number.isInteger(request.page) && request.page>0 ? request.page : 1;
      if (Number.isSafeInteger(request.timeMs) && request.timeMs>=0) {
        opts.time=request.timeMs;
        opts.frame=Math.floor(request.timeMs/100);
      }
      if (files.fontConfig) {
        if (files.fontConfig.size>1048576) throw new Error("客户端字体配置不应超过 1 MiB。");
        opts.fontSettings=readFontSettings(await files.fontConfig.text());
      }
      if (files.reference) opts.screen=true;
      const positioned=Array.isArray(request.draws);
      if (positioned) {
        const {width,height}=request.drawRegion ?? {};
        if (profile!=="text" || request.draws.length!==request.lines.length ||
          !Number.isInteger(width) || width<1 || width>1920 || !Number.isInteger(height) || height<1 || height>1080 ||
          request.draws.some(draw=>!draw || !Number.isFinite(draw.x) || !Number.isFinite(draw.y) ||
            !Number.isInteger(draw.color) || typeof draw.shadow!=="boolean")) {
          throw new Error("NEI 文字位置或画布尺寸无效。");
        }
        Object.assign(opts,{width,height,screen:true,amp:false});
      }
      if(request.machineText) opts.amp=false;
      const {lines,missing}=positioned || request.machineText ? {lines:request.lines,missing:[]} : resolveLines(opts);
      const unresolved=new Set(missing);
      const item=positioned || request.machineText ? null : itemMetadata(request,unresolved);
      const displayLines=item ? core.itemLines(lines,item,opts) : lines;
      const font=opts.fontMode==="modern" && !fonts.active?.modern?.size ? null : fonts.active;
      if (font) await font.ensurePages(displayLines.concat([opts.pageText]));
      if (request.strict && !font) throw new Error("strict 需要游戏位图字体。");
      const layout=positioned ? core.planPositions(displayLines,request.draws,font,opts) : core.plan(displayLines,font,opts);
      if (request.strict && (layout.missing.length || unresolved.size)) throw new Error("strict 模式下存在未解析字形或翻译键。");
      const assets={font,icon:null,fallback:[]};
      const canvas=document.createElement("canvas");
      try {
        if (files.icon) assets.icon=await loadScreenshot(files.icon);
        const box=positioned ? {x:0,y:0,bx:0,by:0,w:opts.width,h:opts.height} : core.bounds(layout,opts,assets.icon);
        core.raster(canvas,layout,box,opts,assets);
        let cropped=canvas, comparison=null;
        if (files.reference) {
          const reference=await loadScreenshot(files.reference);
          try {
            if (canvas.width!==reference.width || canvas.height!==reference.height) throw new Error("实机截图尺寸与逻辑视口和 GUI 缩放不一致。");
            const crop=validatedCrop(request.crop,reference);
            cropped=cropFrame(canvas,crop);
            comparison=comparePixels(cropped,cropFrame(reference,crop));
          } finally { reference.close(); }
        }
        return {source:"editable",profile,renderer:layout.kind,bitmapFont:!!font,missingGlyphs:layout.missing,
          missingKeys:[...unresolved],renderedLines:displayLines,box,page:layout.page,totalPages:layout.pageCount,
          rows:layout.rows.map(({y,width,height,source})=>({y,width,height,source})),comparison,png:await toPng(cropped)};
      } finally { assets.icon?.close(); }
    }
  });
  $("load-demo").click();
  selectSurface();
})();
