
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { writeNeiScene } from "./nei-scene.mjs";
import { renderMuiSource } from "./mui-preview.mjs";

const help = "node agent.mjs (--request request.json --out output | --batch batch.json) [--report result.json] [--browser chrome.exe] [--java java.exe] [--require-exact]";
const argNames = new Set(["--request","--batch","--out","--report","--browser","--java"]);
function getArgs(args) {
  const options={};
  if (args.length===1 && args[0]==="--help") return null;
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(key==="--require-exact") {options.exact=true;continue;}
    if(!argNames.has(key) || !args[i+1] || args[i+1].startsWith("--")) throw Error("Invalid argument: "+key);
    options[key.slice(2)]=args[++i];
  }
  if(options.batch ? options.request || options.out : !options.request || !options.out) throw Error(help);
  return options;
}

async function findBrowser(override) {
  if (override) {
    const exe=path.resolve(override);
    await access(exe);
    return exe;
  }
  const roots=[process.env.ProgramFiles,process.env["ProgramFiles(x86)"],process.env.LOCALAPPDATA].filter(Boolean);
  const candidates=roots.flatMap(root=>[
    path.join(root,"Google","Chrome","Application","chrome.exe"),
    path.join(root,"Microsoft","Edge","Application","msedge.exe")
  ]).concat(["/usr/bin/chromium","/usr/bin/google-chrome","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]);
  for(const exe of candidates) {
    try {await access(exe);return exe;} catch {}
  }
  throw Error("Chromium browser unavailable. Pass --browser with its executable path.");
}

async function attachedBrowser(exe,profile,nativeGraphics) {
  const child=spawn(exe,["--headless=new",...(nativeGraphics?[]:["--disable-gpu"]),"--disable-background-networking","--no-first-run",
    "--no-default-browser-check","--remote-debugging-port=0","--remote-debugging-address=127.0.0.1",
    "--user-data-dir="+profile,"about:blank"],{stdio:"ignore",windowsHide:true});
  try {
    await new Promise((resolve,reject)=>{
      child.once("spawn",resolve);
      child.once("error",reject);
    });
    const expires=Date.now()+15000;
    let port;
    while(Date.now()<expires && child.exitCode===null) {
      try {
        const active=await readFile(path.join(profile,"DevToolsActivePort"),"utf8");
        port=Number(active.split(/\r?\n/,1)[0]);
        if(Number.isInteger(port)&&port>0&&port<=65535) break;
      } catch {}
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    if(!port) throw Error("Headless Chromium did not start.");
    const response=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(5000)});
    const target=(await response.json()).find(t=>t.type==="page");
    if(!target) throw Error("No browser page available.");
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      socket.addEventListener("open",resolve,{once:true});
      socket.addEventListener("error",()=>reject(Error("DevTools connection failed.")),{once:true});
    });
    return {socket,child};
  } catch(e) {
    if(child.exitCode===null) child.kill();
    throw e;
  }
}
function connect(socket) {
  const pending=new Map();
  let index=0;
  socket.addEventListener("message",({data})=>{
    const msg=JSON.parse(data), item=pending.get(msg.id);
    if(!item) return;
    pending.delete(msg.id);
    clearTimeout(item.timer);
    if(msg.error) item.reject(Error(msg.error.message));
    else item.resolve(msg.result);
  });
  socket.addEventListener("close",()=>{
    for(const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error("DevTools connection closed."));
    }
    pending.clear();
  });
  return (method,params={})=>new Promise((resolve,reject)=>{
    const id=++index;
    const timer=setTimeout(()=>{
      pending.delete(id);
      reject(Error("DevTools timeout: "+method));
    },60000);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(call,expression) {
  const r=await call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const fileKeys=["fonts","language","resources","reference","icon","fontConfig","wailaConfig"];
const multipleFiles=key=>["fonts","language","resources"].includes(key);
async function findLanguage(source,java) {
  const locale=java.locale ?? "zh_CN";
  if(typeof locale!=="string" || !/^[a-zA-Z_]+$/.test(locale)) throw Error("Invalid locale.");
  if(java.namespace!==undefined && !/^[a-z0-9_.-]+$/.test(java.namespace)) throw Error("Invalid asset namespace.");
  let folder=path.dirname(source);
  while(path.basename(folder)!=="java" && path.dirname(folder)!==folder) folder=path.dirname(folder);
  if(path.basename(folder)!=="java") return [];
  const assets=path.join(folder,"..","resources","assets");
  let entries;
  try {entries=await readdir(assets,{withFileTypes:true});} catch(e) {if(e.code==="ENOENT") return [];throw e;}
  const found=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!entry.isDirectory() || java.namespace && java.namespace!==entry.name) continue;
    for(const lang of new Set(["en_US",locale])) {
      const file=path.join(assets,entry.name,"lang",lang+".lang");
      try {await access(file);found.push(file);} catch(e) {if(e.code!=="ENOENT") throw e;}
    }
  }
  return found;
}
function encodeMachineState(state) {
  if (!state || typeof state!=="object" || Array.isArray(state)) throw Error("Provide a machine state object.");
  const rows=[];
  for (const [group,entries] of Object.entries(state)) {
    if (!["fields","nbt","calls"].includes(group) || !entries || typeof entries!=="object" || Array.isArray(entries))
      throw Error("Expected fields, nbt or calls in machine state.");
    for (const [key,value] of Object.entries(entries)) {
      if (!/^[\w$.-]{1,128}$/.test(key)) throw Error("Invalid state key: "+key);
      function row(type,v) { rows.push([group,key,type,Buffer.from(String(v)).toString("base64")].join("\t")); }
      if (Array.isArray(value) && value.every(v=>typeof v==="string")) {
        row("list",""); for(const item of value) row("element",item);
      } else if (typeof value==="number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) {
        row(Number.isInteger(value) ? "long" : "double",value);
      } else if (value===null || ["string","boolean"].includes(typeof value)) row(value===null ? "null" : typeof value,value);
      else if (typeof value==="object" && Object.keys(value).length===1 && typeof value.long==="string" && /^-?\d+$/.test(value.long))
        row("long",value.long);
      else throw Error("Unsupported state value: "+key);
    }
  }
  return rows.join("\n");
}

async function fromSource(request,base,language,javaExecutable="java") {
  if(typeof request.java?.file!=="string" || !request.java.file) throw Error("Source mode requires java.file.");
  const source=path.resolve(base,request.java.file);
  const method=request.java.method ?? "auto";
  if(typeof method!=="string" || !/^[A-Za-z_$][\w$]*$/.test(method)) throw Error("Invalid Java method name.");
  const flags=["shift","ctrl","alt","advanced"].map(flag=>(request.settings?.[flag]===true ? "" : "!")+flag);
  if (request.java.gtFinisherStyle!==undefined) {
    if (![0,1,2,3].includes(request.java.gtFinisherStyle)) throw Error("gtFinisherStyle must be 0, 1, 2 or 3.");
    flags.push("gtFinisher="+request.java.gtFinisherStyle);
  }
  const machine=request.source==="machine";
  const translator=fileURLToPath(new URL(machine ? "MachineText.java" : "SourceTooltip.java",import.meta.url));
  const langFiles=language.length ? language : await findLanguage(source,request.java);
  const locale=request.java.locale ?? "zh_CN";
  if(typeof locale!=="string" || !/^[a-zA-Z_]+$/.test(locale)) throw Error("Invalid locale.");
  const input=machine ? encodeMachineState(request.state) : "";
  const command=promisify(execFile)(javaExecutable,["-Dfile.encoding=UTF-8",translator,source,method,...(machine ? [] : [flags.join(",")]),locale,...langFiles],
    {windowsHide:true,timeout:25000,maxBuffer:3000000,encoding:"utf8"});
  if(machine) {
    command.child.stdin.on("error",error=>{if(error.code!=="EPIPE") command.child.kill();});
    command.child.stdin.end(input);
  }
  const {stdout}=await command;
  const result=JSON.parse(stdout);
  const report={requestedMethod:method,methods:result.methods,unresolved:result.unresolved,lines:result.lines,languageFiles:langFiles,
    mode:machine ? "machine-state" : "static-source-extraction"};
  if(!machine && !result.lines.length) {
    throw Error("No static tooltip lines resolved. " + result.unresolved.slice(0,8).join("\n"));
  }
  if (request.java.requireComplete && result.unresolved.length) throw Error("Unresolved source entries: "+result.unresolved.join("\n"));
  const name=result.methods[0]?.split(":",1)[0];
  const surface={createTooltip:"multiblock",handleTooltip:"nei",handleItemTooltip:"nei",getWailaHead:"waila",getWailaBody:"waila",
    getWailaTail:"waila",getInfoData:"machine-scanner",getExtraInfoData:"machine-scanner"};
  const machineProfile=name==="getWailaBody" ? "waila" : "machine-scanner";
  const effective={...request,source:"editable",profile:machine ? machineProfile : request.profile ?? surface[name] ?? "item",lines:result.lines};
  if(machine) {
    effective.machineText=true;
    if(request.waila!==undefined) {
      const {head=[],tail=[]}=request.waila ?? {};
      if(machineProfile!=="waila" || ![head,tail].every(rows=>Array.isArray(rows) && rows.every(row=>typeof row==="string"))) {
        throw Error("Waila head and tail must be text rows for getWailaBody.");
      }
      effective.lines=[...head,...result.lines,...tail];
    }
  }
  delete effective.java;
  delete effective.state;
  return {request:effective,report,source};
}
async function fromBridge(request,base) {
  if(typeof request.capture!=="string" || !request.capture) throw Error("Bridge source requires capture JSON path.");
  const file=path.resolve(base,request.capture);
  const input=await readFile(file,"utf8");
  if(input.length>8000000) throw Error("Bridge capture JSON is too large.");
  const capture=JSON.parse(input.replace(/^\uFEFF/,""));
  const top=capture?.data ?? capture;
  const body=top?.data ?? top;
  if(request.source==="nei-frame") {
    const {drawIndices,drawRegion}=request;
    const {x,y,width,height}=drawRegion ?? {};
    if(![x,y,width,height].every(Number.isInteger) || width<1 || width>1920 || height<1 || height>1080) {
      throw Error("NEI frame requires drawRegion in logical font coordinates (width 1..1920, height 1..1080).");
    }
    if(!Array.isArray(drawIndices) || !drawIndices.length || drawIndices.length>512 ||
      drawIndices.some(i=>!Number.isInteger(i)||i<0) || new Set(drawIndices).size!==drawIndices.length) {
      throw Error("NEI frame requires unique drawIndices from one coordinate space.");
    }
    if(capture?.ok===false || body.target!=="rendered_text" || body.boundedFramePartial || body.droppedTextDraws || !Array.isArray(body.entries)) {
      throw Error("NEI frame requires complete native rendered_text observations.");
    }
    const selected=new Set(drawIndices);
    const entries=body.entries.filter(e=>selected.has(e.itemIndex));
    if(entries.length!==selected.size || entries.some(e=>typeof e.text!=="string" || e.textTruncated || e.previewTruncated ||
      !Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isInteger(e.color) || typeof e.dropShadow!=="boolean")) {
      throw Error("One or more requested NEI text draws are unavailable or truncated.");
    }
    request.source="editable";
    request.profile="text";
    request.lines=entries.map(e=>e.text);
    request.draws=entries.map(e=>({x:e.x-x,y:e.y-y,color:e.color,shadow:e.dropShadow}));
    request.drawRegion={width,height};
    delete request.capture;
    return {file,drawFrameId:body.frameId,drawIndices:entries.map(e=>e.itemIndex)};
  }
  if(capture?.ok===false || top.tooltipTruncated || top.hasMore || top.data?.tooltipTruncated) {
    throw Error("Bridge result is partial or contains an error. Aggregate its pages before importing.");
  }
  const observed=body?.chromaticTooltipRender ?? body?.capture;
  const scale=Number(request.settings?.scale ?? 2);
  const rect=observed?.rectangle;
  if(!request.crop && rect && scale>0 && Number.isInteger(scale)) {
    request.crop=Object.fromEntries(["x","y","width","height"].map(k=>[k,rect[k]*scale]));
  }
  if(request.source==="bridge") {
    const entries=Array.isArray(body) ? body : body?.tooltip ?? body?.lines ?? body?.entries;
    if(!Array.isArray(entries) || !entries.length || entries.some(l=>typeof l!=="string" &&
      (typeof l?.text!=="string" || l.textTruncated || l.previewTruncated))) throw Error("Bridge capture has no complete text rows.");
    if(entries.some((row,i)=>Number.isInteger(row?.lineIndex) && row.lineIndex!==i)) throw Error("Bridge capture line indices are incomplete or out of order.");
    request.lines=entries.map(l=>typeof l==="string" ? l : l.text);
    request.source="editable";
    if(Number.isInteger(body?.mouseX) && request.settings?.x===undefined) request.settings={...request.settings,x:body.mouseX};
    if(Number.isInteger(body?.mouseY) && request.settings?.y===undefined) request.settings={...request.settings,y:body.mouseY};
  }
  delete request.capture;
  return {file,observedRectangle:rect ?? null};
}
async function readRequest(file) {
  const input=await readFile(file,"utf8");
  if(input.length>8000000) throw Error("Request JSON is too large.");
  return JSON.parse(input.replace(/^\uFEFF/,""));
}
const pathKey=file=>process.platform==="win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
const serialize=data=>JSON.stringify(data,null,2)+"\n";

async function run(options,session) {
  const requestPath=path.resolve(options.request), base=path.dirname(requestPath);
  let request=options.input ?? await readRequest(requestPath);
  if(request.source==="nei-layout") return exportNeiLayout(request,requestPath,options);
  const files={};
  for(const key of fileKeys) {
    const v=request.files?.[key];
    if(v===undefined) continue;
    const array=Array.isArray(v) ? v : [v];
    if(array.length>24 || !array.every(item=>typeof item==="string" && item.length>0)) throw Error("Invalid file path list: "+key);
    if(!multipleFiles(key) && array.length!==1) throw Error("Expected exactly one file: "+key);
    files[key]=array.map(file=>path.resolve(base,file));
  }
  delete request.files;
  let fromJava;
  const machine=request.source==="machine";
  if (request.source==="java" || machine) {
    fromJava=await fromSource(request,base,files.language ?? [],options.java);
    request=fromJava.request;
    if (!files.language && fromJava.report.languageFiles.length) files.language=fromJava.report.languageFiles;
  }
  const bridge=request.source==="bridge" || request.source==="nei-frame" || request.source==="game-frame" && request.capture
    ? await fromBridge(request,base) : null;
  const output=path.resolve(options.out), report=options.report ? path.resolve(options.report) : null;
  const inputs=new Set([requestPath,...Object.values(files).flat()].map(pathKey));
  if(fromJava) inputs.add(pathKey(fromJava.source));
  if(bridge) inputs.add(pathKey(bridge.file));
  if(inputs.has(pathKey(output)) || (report && (inputs.has(pathKey(report)) || pathKey(output)===pathKey(report)))) {
    throw Error("Output and report paths must be distinct from the input files.");
  }
  if(request.source==="mui2") {
    session.nativeGraphics=true;
    const language=files.language??(typeof request.java?.file==="string"?await findLanguage(path.resolve(base,request.java.file),request.java):[]);
    return renderMuiSource(request,base,files,options,session,language);
  }
  if(request.source==="nei-scene") {
    if(files.reference || files.icon) throw Error("NEI manual scenes use textures in their layout and content.");
    // Keep resource order: later font packs and language files override earlier ones.
    const resources=[];
    for(const [key,paths] of Object.entries(files)) {
      for(const file of paths) {
        const {size,mtimeNs,ctimeNs}=await stat(file,{bigint:true});
        resources.push([key,pathKey(file),String(size),String(mtimeNs),String(ctimeNs)]);
      }
    }
    return writeNeiScene(request,requestPath,options,task=>session.render(files,task),session.quantityCache,resources);
  }
  return session.render(files,async render=>{
    const result=await render(request);
    const {png,...metadata}=result;
    const html=machine && path.extname(output).toLowerCase()===".html";
    if(html) {
      const data=JSON.stringify({profile:metadata.profile,lines:metadata.renderedLines,methods:fromJava.report.methods}).replaceAll("<","\\u003c");
      await writeFile(output,'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GTNH 机器预览</title>'+
        '<style>body{background:#191b1e}img{image-rendering:pixelated}</style><img alt="机器报告" src="data:image/png;base64,'+
        png+'"><script type="application/json" id="machine-report">'+data+'</script></html>\n');
    } else await writeFile(output,Buffer.from(png,"base64"));
    return {...metadata,source:machine ? "machine" : metadata.source,extraction:fromJava?.report,observedRectangle:bridge?.observedRectangle,
      drawFrameId:bridge?.drawFrameId,drawIndices:bridge?.drawIndices,[html ? "htmlPath" : "pngPath"]:output};
  });
}

async function exportNeiLayout(request,requestPath,options) {
  const {recipeMap,field,frontend,gridHelper,uiDefaults}=request.java ?? {};
  const sources=[recipeMap,frontend,gridHelper,uiDefaults];
  if(sources.some(file=>typeof file!=="string" || !file) || typeof field!=="string" || !/^[\w$]+$/.test(field)) {
    throw Error("NEI layout requires java.recipeMap, field, frontend, gridHelper and uiDefaults.");
  }
  const paths=sources.map(file=>path.resolve(path.dirname(requestPath),file));
  const output=path.resolve(options.out);
  const normalize=p=>process.platform==="win32" ? p.toLowerCase() : p;
  if(path.extname(output).toLowerCase()!==".json" || options.report || options.exact ||
    [requestPath,...paths].some(file=>normalize(file)===normalize(output))) {
    throw Error("NEI layout needs a distinct .json output.");
  }
  const parser=fileURLToPath(new URL("SourceNeiLayout.java",import.meta.url));
  const {stdout}=await promisify(execFile)(options.java ?? "java",["-Dfile.encoding=UTF-8",parser,paths[0],field,...paths.slice(1)],
    {windowsHide:true,timeout:25000,maxBuffer:1000000,encoding:"utf8"});
  const layout=JSON.parse(stdout);
  await writeFile(output,serialize(layout),"utf8");
  return layout;
}

async function withWorkbench(options,work) {
  let browser,call,temp,profile;
  let pageNumber=0;
  const session={quantityCache:new Map(),browserLaunches:0,render};
  async function render(files,task) {
    if(!browser) {
      const exe=await findBrowser(options.browser);
      temp=await realpath(tmpdir());
      profile=await mkdtemp(path.join(temp,"gtnh-tip-"));
      browser=await attachedBrowser(exe,profile,session.nativeGraphics);
      session.browserLaunches++;
      call=connect(browser.socket);
    }
    // Each top-level request starts with the same UI and font state as a standalone run.
    const page=new URL("index.html",import.meta.url);
    page.searchParams.set("request",String(++pageNumber));
    await call("Page.navigate",{url:page.href});
    const expires=Date.now()+12000;
    let ready=false;
    while(Date.now()<expires) {
      try {ready=await evaluate(call,"location.href==="+JSON.stringify(page.href)+" && typeof GTNHTooltipWorkbench === 'object'");} catch {}
      if(ready) break;
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    if(!ready) throw Error("Workbench HTML failed to load.");
    await call("DOM.enable");
    for(const [key,paths] of Object.entries(files)) {
      await evaluate(call,"(() => {const e=document.createElement('input'); e.type='file'; e.multiple=true; e.id="+JSON.stringify("agent-"+key)+"; document.body.append(e);})()");
      const doc=await call("DOM.getDocument");
      const element=await call("DOM.querySelector",{nodeId:doc.root.nodeId,selector:"#agent-"+key});
      await call("DOM.setFileInputFiles",{nodeId:element.nodeId,files:paths});
    }
    function fileArguments(keys) {return keys.map(key=>{
      const expr="document.getElementById("+JSON.stringify("agent-"+key)+").files";
      return key+":"+(multipleFiles(key) ? "Array.from("+expr+")" : expr+"[0]");
    }).join(",");}
    let selected=Object.keys(files);
    return task(async request=>{
      const rendered=await evaluate(call,"GTNHTooltipWorkbench.run("+JSON.stringify(request)+",{"+fileArguments(selected)+"})");
      selected=selected.filter(key=>key!=="fonts" && key!=="language");
      return rendered;
    });
  }
  try {
    return await work(session);
  } finally {
    if(browser) {
      try {await call("Browser.close");} catch {}
      browser.socket.close();
      if(browser.child.exitCode===null) browser.child.kill();
    }
    try {
      const resolved=profile && await realpath(profile);
      if(resolved && path.dirname(resolved)===temp && /^gtnh-tip-[\w-]+$/.test(path.basename(resolved))) {
        await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:150});
      }
    } catch(e) {
      process.stderr.write("Temporary browser profile retained: "+profile+" ("+e.code+")\n");
    }
  }
}

async function runJob(options,session) {
  const result=await run(options,session);
  if(options.report) await writeFile(options.report,serialize(result),"utf8");
  return {result,exitCode:options.exact && !result.comparison?.exact ? 2 : 0};
}

// Check the whole manifest before writing. A previous output can feed a later request.
async function checkBatchInputs(entries,destinations) {
  for(const [index,job] of entries.entries()) {
    const base=path.dirname(job.request);
    const request=job.input=await readRequest(job.request);
    function input(file,root=base) {
      if(typeof file!=="string" || !file) return;
      const resolved=path.resolve(root,file);
      const writer=destinations.get(pathKey(resolved));
      if(writer && (!writer.output || writer.index>=index)) throw Error("Batch destination conflicts with input: "+resolved);
      return resolved;
    }
    for(const file of Object.values(request.files ?? {}).flat()) input(file);
    input(request.capture);
    for(const key of ["file","recipeMap","frontend","gridHelper","uiDefaults"]) input(request.java?.[key]);
    if(request.source==="mui2") for(const file of request.java?.sources??[]) input(file);
    if(["java","machine","mui2"].includes(request.source) && request.java?.file && !request.files?.language) {
      for(const file of await findLanguage(path.resolve(base,request.java.file),request.java)) input(file);
    }
    if(request.source!=="nei-scene") continue;
    for(const scene of request.scenes ?? []) {
      input(scene.layout);
      for(const file of Object.values(scene.textures ?? {})) input(file);
      const contentFile=input(scene.content);
      // Material textures are relative to the manual content document.
      const content=contentFile ? await readRequest(contentFile) : scene.content;
      const root=contentFile ? path.dirname(contentFile) : base;
      for(const slot of Object.values(content?.slots ?? {})) input(slot?.icon,root);
    }
  }
}

async function runBatch(options,session) {
  const manifest=path.resolve(options.batch),base=path.dirname(manifest);
  const {jobs}=await readRequest(manifest);
  if(!Array.isArray(jobs) || !jobs.length) throw Error("Batch requires a non-empty jobs array.");
  function resolve(file) {
    if(typeof file!=="string" || !file.trim()) throw Error("Batch paths must be non-empty strings.");
    return path.resolve(base,file);
  }
  const entries=jobs.map(job=>{
    if(!job || Object.keys(job).some(k=>!["request","out","report","requireExact"].includes(k)) ||
      (job.requireExact!==undefined && typeof job.requireExact!=="boolean")) throw Error("Invalid batch job.");
    return {request:resolve(job.request),out:resolve(job.out),report:job.report===undefined ? undefined : resolve(job.report),
      exact:options.exact || job.requireExact,java:options.java};
  });
  const inputs=new Set([manifest,...entries.map(job=>job.request)].map(pathKey));
  const destinations=new Map();
  function reserve(file,index,output) {
    if(!file) return;
    const key=pathKey(file);
    if(inputs.has(key) || destinations.has(key)) throw Error("Conflicting batch output or report path: "+file);
    destinations.set(key,{index,output});
  }
  reserve(options.report,-1,false);
  for(const [index,job] of entries.entries()) {
    reserve(job.out,index,true);
    reserve(job.report,index,false);
  }
  await checkBatchInputs(entries,destinations);
  session.nativeGraphics=entries.some(job=>job.input.source==="mui2");
  const completed=[];
  let exitCode=0;
  for(const job of entries) {
    const {request,out,report}=job;
    try {
      const executed=await runJob(job,session);
      completed.push({request,out,report,exitCode:executed.exitCode,quantityLabels:executed.result.quantityLabels});
      if(executed.exitCode!==0) exitCode=executed.exitCode;
    } catch(error) {
      completed.push({request,out,report,exitCode:1,error:error.message});
      exitCode=1;
      break;
    }
  }
  const result={source:"batch",exitCode,browserLaunches:session.browserLaunches,skipped:entries.length-completed.length,jobs:completed};
  if(options.report) await writeFile(options.report,serialize(result),"utf8");
  return {result,exitCode};
}

try {
  const options=getArgs(process.argv.slice(2));
  if(options) {
    const {result,exitCode}=await withWorkbench(options,session=>options.batch ? runBatch(options,session) : runJob(options,session));
    process.stdout.write(serialize(result));
    process.exitCode=exitCode;
  }
  else console.log(help);
} catch(e) {
  process.stderr.write(e.message+"\n");
  process.exitCode=1;
}
