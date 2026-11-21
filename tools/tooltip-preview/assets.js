
"use strict";
globalThis.TooltipAssets = (() => {
  const decoder = new TextDecoder("utf-8", {fatal:true});
  const root = "assets/minecraft/";
  const ascii = root + "textures/font/ascii.png";
  const sizes = root + "font/glyph_sizes.bin";
  const modern = "assets/angelica/font/modern.json";
  const maxAsset = 4194304;

  async function archive(file) {
    if (file.size < 22 || file.size > 1024 ** 3) throw new Error("JAR / ZIP 大小不受支持。");
    const tailStart = Math.max(0, file.size - 65557);
    const tail = new DataView(await file.slice(tailStart).arrayBuffer());
    let end = tail.byteLength - 22;
    while (end >= 0 &&
      (tail.getUint32(end,true) !== 0x06054b50 || end + 22 + tail.getUint16(end+20,true) !== tail.byteLength)) end--;
    if (end < 0 || tail.getUint16(end+4,true) || tail.getUint16(end+6,true)) {
      throw new Error("无法读取 ZIP 中央目录。");
    }
    const count = tail.getUint16(end+10,true);
    const size = tail.getUint32(end+12,true), offset = tail.getUint32(end+16,true);
    if (size > 32*1024**2 || offset+size > file.size || count === 65535) {
      throw new Error("ZIP64 或超大中央目录不受支持。");
    }
    const directory = new DataView(await file.slice(offset,offset+size).arrayBuffer());
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > size || directory.getUint32(p,true) !== 0x02014b50) throw new Error("ZIP 目录已损坏。");
      const nameLength = directory.getUint16(p+28,true);
      const next = p + 46 + nameLength + directory.getUint16(p+30,true) + directory.getUint16(p+32,true);
      if (next > size) throw new Error("ZIP 条目越界。");
      const nameBytes = new Uint8Array(directory.buffer,p+46,nameLength);
      // Minecraft resource locations are ASCII. Skip unrelated byte sequences.
      if (nameBytes.every(b => b < 128)) {
        const name = decoder.decode(nameBytes);
        entries.set(name, {
          flags:directory.getUint16(p+8,true), method:directory.getUint16(p+10,true),
          compressed:directory.getUint32(p+20,true), length:directory.getUint32(p+24,true),
          offset:directory.getUint32(p+42,true)
        });
      }
      p = next;
    }
    return {
      has(name) { return entries.has(name); },
      async get(name) {
        const entry = entries.get(name);
        if (!entry) return null;
        if (entry.flags & 1 || entry.length > maxAsset || entry.compressed > maxAsset) throw new Error("字体条目无法读取：" + name);
        const local = new DataView(await file.slice(entry.offset,entry.offset+30).arrayBuffer());
        if (local.byteLength !== 30 || local.getUint32(0,true) !== 0x04034b50) throw new Error("ZIP 条目已损坏：" + name);
        const dataOffset = entry.offset + 30 + local.getUint16(26,true) + local.getUint16(28,true);
        if (dataOffset+entry.compressed > offset) throw new Error("ZIP 数据越界：" + name);
        const segment = file.slice(dataOffset,dataOffset+entry.compressed);
        if (entry.method === 0 && segment.size === entry.length) return new Uint8Array(await segment.arrayBuffer());
        if (entry.method !== 8) throw new Error("ZIP 压缩方式不受支持：" + name);
        const reader = segment.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        const result = new Uint8Array(entry.length);
        let used = 0;
        for (;;) {
          const {done,value} = await reader.read();
          if (done) break;
          if (used+value.length > result.length) {
            await reader.cancel();
            throw new Error("ZIP 解压长度超出目录值：" + name);
          }
          result.set(value,used);
          used += value.length;
        }
        if (used !== result.length) throw new Error("ZIP 解压长度不正确：" + name);
        return result;
      }
    };
  }
  async function png(bytes) {
    if (!bytes || bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80) throw new Error("缺少 PNG 字体图集。");
    const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const width = header.getUint32(16), height = header.getUint32(20);
    if (!width || !height || width > 2048 || height > 2048) throw new Error("字体图集尺寸不受支持。");
    const bitmap = await createImageBitmap(new Blob([bytes],{type:"image/png"}),{colorSpaceConversion:"none"});
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0);
    bitmap.close();
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  }
  function inkWidth(image,x,y,w,h) {
    for (let col = w-1; col >= 0; col--) {
      for (let row = 0; row < h; row++) {
        if (image.data[((y+row)*image.width+x+col)*4+3]) return col+1;
      }
    }
    return 0;
  }
  function legacyGlyphs(image) {
    const tileW = image.width/16, tileH = image.height/16;
    if (!Number.isInteger(tileW) || !Number.isInteger(tileH)) throw new Error("ASCII 字体必须有 16 × 16 个字形。");
    return Array.from({length:256},(_, n) => {
      const sx=(n&15)*tileW, sy=(n>>4)*tileH;
      const width=Math.round(inkWidth(image,sx,sy,tileW,tileH)*8/tileW)+1;
      return {image,sx,sy,sw:(width-1.01)*tileW/8,sh:tileH*7.99/8,
        w:width-1.01,h:7.99,width,metric:width,offsetY:0};
    });
  }
  async function modernGlyphs(get) {
    const definition = await get(modern);
    if (!definition) return null;
    const glyphs = new Map();
    const providers = JSON.parse(decoder.decode(definition)).providers;
    if (!Array.isArray(providers)) throw new Error("Angelica 字体定义缺少 providers。");
    for (const provider of providers.slice(0,16)) {
      if (provider.type !== "bitmap" || typeof provider.file !== "string" || !Array.isArray(provider.chars)) continue;
      const [namespace,path] = provider.file.split(":");
      const image = await png(await get("assets/angelica/textures/"+path) ||
        await get("assets/"+namespace+"/textures/"+path));
      if (!provider.chars.every(row=>typeof row==="string")) throw new Error("Angelica 字形定义必须是字符串。");
      const rows = provider.chars.map(row=>[...row]);
      const cols = rows[0]?.length;
      if (!cols || !rows.length || image.width%cols || image.height%rows.length || !rows.every(row=>row.length===cols)) {
        throw new Error("Angelica 字体图集与字形定义不匹配。");
      }
      const tw = image.width/cols, th = image.height/rows.length;
      const height = Number(provider.height ?? 8), ascent = Number(provider.ascent ?? 7);
      if (!(height>0 && height<=32 && ascent>=-16 && ascent<=height)) throw new Error("Angelica 字体度量不受支持。");
      const factor = height/th;
      rows.forEach((row, y) => row.forEach((ch, x) => {
        if (ch === "\0" || ch === " " || glyphs.has(ch)) return;
        const sw = inkWidth(image,x*tw,y*th,tw,th);
        if (!sw) return;
        const width = Math.round(sw*factor)+1;
        glyphs.set(ch,{image,sx:x*tw,sy:y*th,sw:tw,sh:th,w:tw*factor,h:height,
          width,metric:width,offsetY:7-ascent});
      }));
    }
    return glyphs;
  }

  async function load(files) {
    const archives = [];
    for (const file of files) archives.push(await archive(file));
    const get = async path => {
      for (let i = archives.length-1; i >= 0; i--) if (archives[i].has(path)) return archives[i].get(path);
      return null;
    };
    const glyphSizes = await get(sizes);
    if (!glyphSizes || glyphSizes.length !== 65536) throw new Error("请选择含 glyph_sizes.bin 的 Minecraft 1.7.10 客户端 JAR。");
    const result = {
      names:[...files].map(f=>f.name),
      asciiGlyphs:legacyGlyphs(await png(await get(ascii))),
      sizes:glyphSizes,
      modern:await modernGlyphs(get),
      pages:new Map(),
      failed:new Set()
    };
    result.ensurePages = async function (strings) {
      const needed = new Set();
      for (const s of strings) for (let i=0; i<s.length;i++) {
        const code=s.charCodeAt(i);
        if (result.sizes[code]) needed.add(code>>8);
      }
      await Promise.all([...needed].map(async n => {
        if (result.pages.has(n) || result.failed.has(n)) return;
        const key = n.toString(16).padStart(2,"0");
        const file = await get(root+"textures/font/unicode_page_"+key+".png");
        if (!file) { result.failed.add(n); return; }
        const image = await png(file);
        if (image.width!==256 || image.height!==256) throw new Error("Unicode 图集须为 256 × 256 像素。");
        result.pages.set(n,image);
      }));
    };
    return result;
  }
  return {load};
})();
