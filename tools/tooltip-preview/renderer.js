
"use strict";
globalThis.TooltipCore = (() => {
  const legacy = "ÀÁÂÈÊËÍÓÔÕÚßãõğİıŒœŞşŴŵžȇ\0\0\0\0\0\0\0 !" +
    "\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_" + String.fromCharCode(96) +
    "abcdefghijklmnopqrstuvwxyz{|}~\0ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»" +
    "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
    "αβΓπΣσμτΦΘΩδ∞∅∈∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\0";
  const codes = "0123456789abcdef";
  const profiles = {
    item: {render:"nei", gap:2, shadow:true},
    multiblock: {render:"nei", gap:2, shadow:true},
    nei: {render:"nei", gap:0, shadow:true},
    mui1: {render:"mui1", gap:2, shadow:true, wrap:true},
    mui2: {render:"mui2", gap:0, shadow:false, wrap:true},
    waila: {render:"waila", gap:0, shadow:true},
    guide: {render:"vanilla", gap:2, shadow:true, wrap:true},
    scanner: {render:"nei", gap:2, shadow:true},
    "machine-scanner": {render:"text", gap:0, shadow:true},
    chat: {render:"chat", gap:0, shadow:true, wrap:true},
    text: {render:"text", gap:0, shadow:true, wrap:true},
    vanilla: {render:"vanilla", gap:2, shadow:true}
  };
  const palette = Array.from({length:32}, (_, n) => {
    const extra = (n >> 3 & 1) * 85;
    let red = (n >> 2 & 1) * 170 + extra;
    if (n === 6) red += 85;
    const rgb = [red, (n >> 1 & 1) * 170 + extra, (n & 1) * 170 + extra];
    return n < 16 ? rgb : rgb.map(c => c >> 2);
  });
  const argb = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255, n >>> 24 & 255];
  const modernDefaults = {aaMode:2,aaStrength:6,brightness:0.6,shadowOffset:1,unicodeShadow:0.5,
    shadowCopies:1,boldCopies:2,glyphSpacing:0};
  const samples = [null,[[2,6],[6,-2],[-2,-6],[-6,2]],
    [[1,1],[-1,-3],[-3,2],[4,-1],[-5,-2],[2,5],[5,3],[3,-5],
      [-2,6],[0,-7],[-4,-6],[-6,4],[-8,0],[7,-4],[6,7],[-7,-8]]];
  const format = (text, amp) => {
    if (!amp) return text;
    return text.replace(/&#([0-9a-f]{6})|&([0-9a-fklmnor])|&&/gi,
      (_, hex, code) => hex ? "§x§" + hex.split("").join("§") : code ? "§" + code : "&");
  };
  const hexPairs = "(?:§[0-9a-f]){6}";
  const hexAt = new RegExp("^" + hexPairs, "i");
  const gradientAt = new RegExp("^§x(" + hexPairs + ")§x(" + hexPairs + ")", "i");
  const rgbNumber = pairs => parseInt(pairs.replaceAll("§", ""), 16);
  const applyBaseColor = (line, color) => /^§(?:[0-9a-f]|x|g|q)/i.test(line) ? line : "§" + color + line;
  function parse(text, amp = false, extended = false) {
    text = format(text, amp);
    const result = [];
    let style = {};
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "§" || i === text.length - 1) {
        const character=String.fromCodePoint(text.codePointAt(i));
        result.push({character, ...style});
        i+=character.length-1;
        continue;
      }
      const code = text[++i].toLowerCase();
      const hex = code === "x" && hexAt.exec(text.slice(i + 1));
      const gradient = extended && code === "g" && gradientAt.exec(text.slice(i + 1));
      if (hex) {
        const {color, effect, ...decorations} = style;
        style = {...(extended ? decorations : {}), hex:rgbNumber(hex[0])};
        i += 12;
      } else if (gradient) {
        style = {...style, effect:{from:argb(rgbNumber(gradient[1])), to:argb(rgbNumber(gradient[2]))}};
        i += gradient[0].length;
      } else if (extended && code === "q") {
        style = {...style, effect:{rainbow:true}};
      } else if (code === "r") {
        style = {};
      } else if (codes.includes(code)) {
        style = {color:codes.indexOf(code)};
      } else if ("klmno".includes(code)) {
        style = {...style, [code]:true};
      } else if (!extended && code !== "h") {
        style = {color:15};
      }
    }
    for (let i=0; i<result.length;) {
      const effect=result[i].effect;
      if (!effect) { i++; continue; }
      let end=i, count=0;
      while (end<result.length && result[end].effect===effect) {
        if (!/\s/.test(result[end].character)) count++;
        end++;
      }
      for (let j=i,index=0; j<end; j++) {
        if (/\s/.test(result[j].character)) continue;
        const ratio = index / Math.max(1,count-1);
        const rgb = effect.rainbow ? rainbowColor(index) :
          effect.from.slice(0,3).map((v,k)=>Math.trunc(v+(effect.to[k]-v)*ratio));
        result[j].effectColor=rgb;
        index++;
      }
      i=end;
    }
    return result;
  }
  function rainbowColor(index) {
    const h = (index%24)/4;
    const n = Math.floor(h);
    const low = Math.floor(255*(1-(h-n)));
    const high = 255-low;
    return [[255,high,0],[low,255,0],[0,255,high],[0,low,255],[high,0,255],[255,0,low]][n];
  }
  function styledText(style,text,time=0) {
    let index=0;
    if (style==="rainbow") {
      let phase=Math.floor(time/200);
      return text.split("").map(c=>/\s/u.test(c) ? c : "§"+"c6eab9d"[(phase+index++)%7]+c).join("")+"§r";
    }
    if (style==="standard") return "§a"+text+"§r";
    if (style==="modularized") {
      const cycle=["8","8","1","1","9","3","b§n","b§n","f§n","f§n","b§n","b§n","3","9","1","1","8","8"];
      const offset=Math.floor(time/180)%cycle.length;
      return text.split("").map((c,i)=>"§"+cycle[(i+cycle.length-offset)%cycle.length]+c).join("")+"§r";
    }
    if (style==="dyson") {
      const pulse=[["9",150],["3",150],["b",150],["f",600],["b",150],["3",150],["9",200],["1",600]];
      const sweep=(text.replaceAll(" ","").length+2)*100;
      const pulseStart=sweep+600;
      const pulseEnd=pulseStart+pulse.reduce((sum,[,ms])=>sum+ms,0);
      const position=time%(pulseEnd+600);
      let color=null, offset=position-pulseStart;
      if (offset>=0 && position<pulseEnd) {
        for (const [code,duration] of pulse) {
          if (offset<duration) {color=code;break;}
          offset-=duration;
        }
      }
      const point=position<sweep ? Math.floor(position/100) : -1;
      return text.split("").map(c=>c===" " ? "§r " : "§"+(color ?? ["b","3","9"][point-index++] ?? "1")+c).join("")+"§r";
    }
    if (style==="infusion") {
      return text.split("").map((c,i)=>{
        if (c===" ") return "§r ";
        let value=BigInt(Math.floor(time/220))+0x713BF1A92C4D86E5n+BigInt(i)*0x9E3779B97F4A7C15n;
        value=BigInt.asUintN(64,value);
        value=BigInt.asUintN(64,(value^(value>>30n))*0xBF58476D1CE4E5B9n);
        value=BigInt.asUintN(64,(value^(value>>27n))*0x94D049BB133111EBn);
        const state=Number(((BigInt.asIntN(64,value^(value>>31n))%24n)+24n)%24n);
        const code=state<2 ? "§5§o§k" : state===2 ? "§0" : state===3 ? "§4§o"
          : state===4 ? "§8§m" : state<=7 ? "§d§o" : state<=11 ? "§5§o" : "§5";
        return code+c;
      }).join("")+"§r";
    }
    return text;
  }
  function rgbOf(glyph, base, shadow) {
    if (!glyph.effectColor && glyph.color !== undefined) return palette[glyph.color + (shadow ? 16 : 0)];
    const color = glyph.effectColor ?? (glyph.hex === undefined ? base : argb(glyph.hex));
    return shadow ? color.slice(0, 3).map(c => c >> 2) : color.slice(0, 3);
  }
  function describe(character, font, mode) {
    const value = character.codePointAt(0);
    if (character === " ") return {width:4, metric:4};
    if (value === 10 || value === 13 || value < 32) return {width:0, metric:0};
    if (!font) {
      const width = /[!.,:;iIl|']/.test(character) ? 3 : /[^\u0000-\u00ff]/.test(character) ? 8 : 6;
      return {width, metric:width, fallback:true};
    }
    const modern = mode === "modern" && font.modern?.get(character);
    if (modern) return modern;
    const index = legacy.indexOf(character);
    if (index >= 0 && mode !== "unicode" && mode !== "modern") return font.asciiGlyphs[index];
    const packed = font.sizes[value];
    if (!packed) return {width:0, metric:0, missing:character};
    const start = packed >> 4;
    const end = (packed & 15) + 1;
    if (end <= start) return {width:0, metric:0, missing:character};
    const image = font.pages.get(value >> 8);
    const width = (end - start) / 2 + 1;
    const metric = mode === "modern" ? width : (end > 8 ? 9 : Math.floor(width));
    return {
      width, metric, image, missing:image ? undefined : character,
      sx:(value & 15) * 16 + start, sy:(value >> 4 & 15) * 16,
      sw:end - start - (mode==="modern" ? 0.04 : 0.02), sh:15.98, w:(end - start - 0.02) / 2,
      h:mode==="modern" ? 8 : 7.99,
      offsetY:0, unicode:true
    };
  }
  function prepare(text, font, opts) {
    const modern = opts.fontMode === "modern";
    const spacing = modern ? opts.fontSettings?.glyphSpacing ?? 0 : 0;
    return parse(text, opts.amp, modern).map(glyph => {
      const shape = describe(glyph.character, font, opts.fontMode);
      const extra = shape.width > 0 ? spacing + (glyph.l ? 1 : 0) : 0;
      return {...glyph, shape, advance:shape.width + extra, metric:shape.metric + extra};
    });
  }
  const measure = line => Math.max(0, Math.ceil(line.reduce((w, glyph) => w + glyph.metric, 0)));
  function wrap(line, width) {
    const result = [];
    let start = 0;
    while (start < line.length) {
      let end = start, lastSpace = -1, length = 0;
      while (end < line.length) {
        const item = line[end];
        if (item.character === " ") lastSpace = end;
        length += item.metric;
        if (Math.ceil(length) > width && end > start) break;
        end++;
      }
      if (end === line.length) {
        result.push(line.slice(start));
        break;
      }
      const splitAt = lastSpace >= start && lastSpace > start ? lastSpace : end;
      result.push(line.slice(start, splitAt));
      start = splitAt + (line[splitAt]?.character === " " ? 1 : 0);
    }
    return result.length ? result : [[]];
  }
  function itemLines(body,item,opts) {
    const delimiter=item.titleStyleFrom;
    const start=delimiter && item.displayName.includes(delimiter)
      ? item.displayName.indexOf(delimiter)+delimiter.length : 0;
    const name = item.titleStyle ? item.displayName.slice(0,start) +
      styledText(item.titleStyle,item.displayName.slice(start),opts.time) : item.displayName;
    const rarity = item.rarity ?? "f";
    const title = applyBaseColor((item.customName ? "§o" : "") + name,rarity);
    const id = opts.advanced && Number.isInteger(item.numericId) ? " §8#" +
      String(item.numericId).padStart(4,"0") + (item.hasSubtypes ? "/"+(item.metadata ?? 0) : "") : "";
    const result = [opts.skin==="chromatic" ? "@title "+title+(id ? " | "+id : "") : title+id];
    if (opts.skin==="chromatic" && item.keys?.length) result.push("@keys "+["shift","ctrl","alt"].filter(k=>item.keys.includes(k)).join(" "));
    if (opts.skin==="chromatic" && body.length) result.push("@body");
    result.push(...body.map(line => line && !/^@(?:section|style|divider)\b/.test(line) ? applyBaseColor(line,"7") : line));
    if (item.credits?.length) {
      if (item.creditDivider) result.push("@divider §6");
      for (const credit of item.credits) result.push(applyBaseColor(credit.prefix ?? "","7") +
        styledText(credit.style,credit.text,opts.time) + applyBaseColor(credit.suffix ?? "","7"));
    }
    if (item.registryName && opts.advanced || item.modName) {
      if (opts.skin==="chromatic") result.push("@footer");
      if (opts.advanced && item.registryName) result.push("§8"+item.registryName);
      if (item.modName) result.push("§9§o"+item.modName);
    }
    return result;
  }
  function plan(texts, font, opts) {
    const profile = profiles[opts.profile] || profiles.item;
    const kind = opts.skin === "chromatic" && profile.render === "nei" ? "chromatic" : profile.render;
    const rowHeight = ["chat","mui1","mui2"].includes(kind) ? 9 : 10;
    const maxWidth = kind === "chromatic" ? Math.max(1,Math.min(opts.wrap || Infinity,opts.width-12)) :
      opts.wrap || (profile.wrap ? Math.max(8, opts.width - (kind === "chat" ? 10 : 20)) : 0);
    const missing = new Set();
    const columns = [];
    let segment = 0;
    let rows = texts.flatMap((text, source) => {
      if (kind === "chromatic" && /^@(body|footer|header)$/.test(text)) { segment++; return []; }
      const separator = kind !== "chat" && (/^@section (.+)$/.exec(text) ||
        /^(?:§r)?§b§m-+(?:§r)?\s+(?:§r)?§b(.+?)(?:§r)?\s+§b§m-+(?:§r)?$/i.exec(text));
      const titleId = kind === "chromatic" && /^@title (.*?)(?: \| (.*))?$/.exec(text);
      const keyboard = kind === "chromatic" && /^(?:@keys |(?:§.)*\[(?:alt|shift|ctrl)\]$)/i.test(text);
      const divider = kind === "chromatic" && (/^@divider(?: (.*))?$/.exec(text) ||
        /^((?:§.)*)-{3,}\s*$/.exec(text));
      if (separator) text = "§b" + separator[1];
      if (titleId) text = titleId[1];
      if (text.startsWith("@keys ")) text = text.slice(6).toLowerCase().split(/\s+/).map(key =>
        (opts.modifiers?.[key] ? "§6" : "§8")+"["+key+"]").join(" ");
      const effect = /^@style (standard|rainbow|modularized|dyson|infusion) (.*)$/.exec(text);
      if (effect) text = styledText(effect[1],effect[2],opts.time);
      const dividerColor = divider ? parse((divider[1] || "§7")+"-",false).at(-1)?.color ?? 7 : null;
      const paragraph = kind === "chromatic" && !divider && !titleId && !keyboard && /^\s*$/.test(text);
      if (divider) text = "";
      const cells = kind === "waila" ? text.split(/\t|§§a/i) : [text];
      const groups = cells.map(cell => {
        const alignment = /^§§([bc])/i.exec(cell);
        const line = prepare(alignment ? cell.slice(3) : cell, font, opts);
        for (const glyph of line) if (glyph.shape.missing) missing.add(glyph.shape.missing);
        return {line, align:alignment?.[1]?.toLowerCase()};
      });
      if (groups.length > 1) {
        groups.forEach(({line}, index) => { columns[index] = Math.max(columns[index] || 0, measure(line)); });
      }
      const row = {source, segment, keyboard, paragraph, divider:kind === "chromatic" && !!separator, dividerColor,
        gap:["nei","chromatic"].includes(kind) && text.endsWith("§h")};
      if (groups.length === 1 && maxWidth && !titleId && !keyboard && !separator && !divider) {
        return wrap(groups[0].line, maxWidth).map(line => ({...row,cells:[{line}]}));
      }
      if (titleId?.[2]) {
        const line=prepare(titleId[2],font,opts);
        for (const glyph of line) if (glyph.shape.missing) missing.add(glyph.shape.missing);
        groups.push({line,right:true});
      }
      return [{...row,cells:groups}];
    });
    let pageCount = 1, page = 1;
    const defaultGap = opts.titleGap ?? profile.gap;
    rows=rows.filter((row,i) => !row.paragraph ||
      rows[i-1]?.segment===row.segment && rows[i+1]?.segment===row.segment && !rows[i+1]?.paragraph);
    const lineHeight = row => kind === "chromatic" ? (row.paragraph ? 6 : row.keyboard ? 9 : row.divider || row.dividerColor!==null ? 10 : 8)
      : kind === "waila" && row.cells.every(c => c.line.length === 0) ? 0 : rowHeight;
    function rowGap(row,next) {
      if (!next) return 0;
      const gap = Math.max(row.gap ? 2 : 0, row.source === 0 && next.source !== 0 ? defaultGap : 0);
      if (kind !== "chromatic") return gap;
      const section = row.segment !== next.segment || next.keyboard ? 4 : 0;
      if (row.dividerColor!=null || next.dividerColor!=null || row.paragraph || next.paragraph) return section;
      return Math.max(gap,section,row.gap ? 4 : 2);
    }
    if (["nei","chromatic"].includes(kind) && opts.paginate && rows.length) {
      const pages = [];
      let buffer = [], height = 0;
      const fullHeight = rows.reduce((total,row,index)=>total+lineHeight(row)+rowGap(row,rows[index+1]),0);
      const available = kind === "chromatic" ? opts.height - (fullHeight<=opts.height-12 ? 12 : 24) : opts.height - 28;
      for (const row of rows) {
        const previous=buffer.at(-1);
        if (previous && height + rowGap(previous,row) + lineHeight(row) > available) {
          pages.push(buffer);
          buffer = [];
          height = 0;
        }
        if (buffer.length) height += rowGap(buffer.at(-1),row);
        buffer.push(row);
        height += lineHeight(row);
      }
      if (buffer.length) pages.push(buffer);
      pageCount = pages.length;
      page = Math.max(1, Math.min(opts.page || 1, pageCount));
      rows = pages[page - 1];
      if (pageCount > 1) {
        rows.at(-1).gap = true;
        const footer = (opts.pageText || "§o第 {page}/{pages} 页")
          .replaceAll("{page}", page).replaceAll("{pages}", pageCount);
        rows.push({cells:[{line:prepare(footer, font, opts)}], source:-1, segment:rows.at(-1).segment, gap:false,dividerColor:null});
      }
    }
    let y = 0, width = 0;
    rows.forEach((row, index) => {
      let x = 0;
      row.y = y;
      row.width = 0;
      row.cells.forEach(({line, align}, col) => {
        const actual = measure(line);
        const cellWidth = kind === "waila" && row.cells.length > 1 ? columns[col] : actual;
        const offset = align === "b" ? cellWidth - actual : align === "c" ? Math.floor((cellWidth - actual) / 2) : 0;
        row.cells[col].x = x + offset;
        row.width = x + cellWidth;
        x += cellWidth + (kind === "chromatic" ? 4 : 8);
      });
      width = Math.max(width, row.width);
      row.height = lineHeight(row);
      y += row.height + rowGap(row,rows[index+1]);
    });
    if (kind === "chromatic") {
      for (const row of rows) {
        const aligned = row.cells.find(c=>c.right);
        if (aligned) aligned.x = width - measure(aligned.line);
        if (row.divider) row.cells[0].x = Math.floor((width-row.width)/2);
      }
    }
    const height = Math.max(0, y - (["vanilla","nei"].includes(kind) ? 2 : kind === "mui1" ? 1 : 0));
    return {rows, width, height, kind, page, pageCount, shadow:opts.shadow ?? profile.shadow, missing:[...missing]};
  }
  function planPositions(texts, positions, font, opts) {
    const missing=new Set();
    const rows=texts.map((text,source)=>{
      const {x,y,color,shadow}=positions[source];
      const line=prepare(text,font,opts);
      for (const glyph of line) if (glyph.shape.missing) missing.add(glyph.shape.missing);
      return {source,y,color,shadow,width:measure(line),height:9,cells:[{x,line}]};
    });
    return {rows,kind:"text",width:opts.width,height:opts.height,page:1,pageCount:1,missing:[...missing]};
  }
  function roundedBox(paint, x, y, w, h, colors) {
    const [bg, bottom, border, borderEnd] = colors;
    paint.rect(x + 1, y, w - 1, 1, bg);
    paint.rect(x + 1, y + h, w - 1, 1, bottom);
    paint.rect(x + 1, y + 1, w - 1, h - 1, bg, bottom);
    paint.rect(x, y + 1, 1, h - 1, bg, bottom);
    paint.rect(x + w, y + 1, 1, h - 1, bg, bottom);
    paint.rect(x + 1, y + 2, 1, h - 3, border, borderEnd);
    paint.rect(x + w - 1, y + 2, 1, h - 3, border, borderEnd);
    paint.rect(x + 1, y + 1, w - 1, 1, border);
    paint.rect(x + 1, y + h - 1, w - 1, 1, borderEnd);
  }
  function chromaticBounds(w, h, opts) {
    const outerW=w+4, outerH=h+4, right=opts.x+6,left=opts.x-outerW-6;
    const below=opts.y+6,above=opts.y-outerH-6;
    const close=(value,max)=>Math.max(0,Math.min(max,value));
    let x,y;
    if (right+outerW<=opts.width || left>=0) {
      x=right+outerW<=opts.width ? right : left;
      y=close(opts.y-18,opts.height-outerH);
    } else if (below+outerH<=opts.height || above>=0) {
      x=close(opts.x-18,opts.width-outerW);
      y=below+outerH<=opts.height ? below : above;
    } else {
      x=close(opts.x<opts.width-opts.x ? right : left,opts.width-outerW);
      y=close(opts.y-18,opts.height-outerH);
    }
    const bx=x+2,by=y+2;
    return {x:bx+4,y:by+4,bx,by,w,h};
  }
  function bounds(layout, opts, icon) {
    const {kind, width, height} = layout;
    if (kind === "chromatic") return chromaticBounds(width+8,height+8,opts);
    if (kind === "text") return {x:2,y:2,bx:0,by:0,w:width+4,h:height+4};
    if (kind === "waila") {
      const w = width + (icon ? 29 : 13), h = Math.max(icon ? 24 : 0, height + 8);
      const bx = Math.trunc((opts.width - w - 1) * opts.hudX / 100);
      const by = Math.trunc((opts.height - h - 1) * opts.hudY / 100);
      return {x:bx + (icon ? 24 : 6), y:by + Math.floor((h - height) / 2) + 1, bx, by, w:w + 1, h:h + 1};
    }
    if (kind === "chat") {
      const y = Math.max(0, opts.height - 28 - height);
      return {x:2, y, bx:0, by:y - 1, w:Math.max(width + 4, opts.wrap || 0), h:height};
    }
    let x = opts.x + 12, y = opts.y - 12;
    if (kind === "vanilla") {
      if (x + width > opts.width) x -= 28 + width;
      if (y + height + 6 > opts.height) y = opts.height - height - 6;
    } else {
      if (x > opts.width - width - 8) x -= 24 + width;
      x = Math.max(8, x);
      y = kind === "mui1" ? y : Math.min(Math.max(8, y), Math.max(8, opts.height - height - 8));
    }
    return {x, y, bx:x - 4, by:y - 4, w:width + 8, h:height + 8};
  }
  function makePainter(context, scale, dx, dy, fontSettings,floatLayer) {
    const width = context.canvas.width, height = context.canvas.height;
    const image = floatLayer ? null : context.getImageData(0, 0, width, height);
    const pixels = floatLayer ? new Float32Array(width*height*4) : image.data;
    const start = (logical, shift) => Math.ceil((logical - shift) * scale - 0.5);
    const toX = p => (p + 0.5) / scale + dx;
    const toY = p => (p + 0.5) / scale + dy;
    function blend(index, r, g, b, alpha) {
      const source = alpha / 255, keep = pixels[index + 3] / 255 * (1 - source);
      const a = source + keep;
      if (!a) return;
      pixels[index] = (r * source + pixels[index] * keep) / a;
      pixels[index + 1] = (g * source + pixels[index + 1] * keep) / a;
      pixels[index + 2] = (b * source + pixels[index + 2] * keep) / a;
      pixels[index + 3] = a * 255;
    }
    return {
      rect(x, y, w, h, rgba, end = rgba) {
        for (let j = Math.max(0, start(y, dy)); j < Math.min(height, start(y+h, dy)); j++) {
          const t = (toY(j) - y) / h;
          const [r,g,b,a] = rgba.map((v, i) => v + (end[i]-v)*t);
          for (let i = Math.max(0, start(x, dx)); i < Math.min(width, start(x+w, dx)); i++) {
            blend((j * width + i) * 4, r,g,b,a);
          }
        }
      },
      quad(g, x, y, rgba, italic, cutoff = 25) {
        if (floatLayer && fontSettings && g.unicode) g = {...g, sx:g.sx + 0.01, sy:g.sy + 0.01};
        const source = g.image;
        y += g.offsetY || 0;
        if (!source || g.w<=0 || g.h<=0) return;
        const points=fontSettings && samples[fontSettings.aaMode];
        const strength=(fontSettings?.aaStrength ?? 0)/120;
        const margin=points ? (fontSettings.aaMode===1 ? 6 : 8)*strength+0.5 : 0;
        const fu=g.sw/g.w*strength/scale*(1+(italic ? 2/g.h : 0));
        const fv=g.sh/g.h*strength/scale;
        const userBrightness=fontSettings?.brightness ?? 0.5;
        const brightness=floatLayer ? 0.625*userBrightness+0.1875 : userBrightness;
        const sample = (u,v) => {
          if (u<g.sx || v<g.sy || u>=g.sx+g.sw || v>=g.sy+g.sh) return 0;
          return source.data[(Math.floor(v)*source.width+Math.floor(u))*4+3]/255;
        };
        for (let j = Math.max(0, start(y-margin, dy)); j < Math.min(height, start(y+g.h+margin, dy)); j++) {
          const v = (toY(j) - y) / g.h;
          const left = x + (italic ? 1-2*v : 0);
          const tv=g.sy+v*g.sh;
          for (let i = Math.max(0, start(left-margin, dx)); i < Math.min(width, start(left+g.w+margin, dx)); i++) {
            const tu=g.sx+(toX(i)-left)/g.w*g.sw;
            if (points) {
              let opacity=0;
              for (const [u,w] of points) opacity+=sample(tu+u*fu,tv+w*fv);
              opacity/=points.length;
              const alpha=255*(brightness*opacity)/(brightness*opacity+(1-brightness)*(1-opacity));
              if (alpha>cutoff) blend((j*width+i)*4,...rgba,alpha);
            } else {
              const p=(Math.floor(tv)*source.width+Math.floor(tu))*4;
              const alpha=source.data[p+3];
              if (alpha>cutoff) {
                if (fontSettings) blend((j*width+i)*4,...rgba,alpha);
                else blend((j*width+i)*4,source.data[p]*rgba[0]/255,source.data[p+1]*rgba[1]/255,source.data[p+2]*rgba[2]/255,alpha);
              }
            }
          }
        }
      },
      done() {
        if(floatLayer) {
          for(let i=0;i<pixels.length;i++)pixels[i]/=255;
          return {width,height,floatPixels:pixels};
        }
        context.putImageData(image,0,0);
      }
    };
  }
  function raster(canvas, layout, box, opts, assets) {
    const scale = opts.scale;
    const cropped = !opts.screen;
    const dx = cropped ? box.bx : 0, dy = cropped ? box.by : 0;
    const width = Math.ceil(Math.max(1, cropped ? box.w : opts.width) * scale);
    const height = Math.ceil(Math.max(1, cropped ? box.h : opts.height) * scale);
    if (width > 8192 || height > 8192 || width*height > 16000000) throw new Error("画布太大，请缩小视口、缩放或内容行数。");
    let ctx;
    if (!assets.painter) {
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext("2d", {willReadFrequently:true});
      ctx.imageSmoothingEnabled = false;
    }
    const fontSettings=opts.fontMode==="modern" ? {...modernDefaults,...opts.fontSettings} : null;
    const paint = assets.painter ?? makePainter(ctx, scale, dx, dy,fontSettings,assets.rawPixels);
    const {kind, width:textWidth, height:textHeight} = layout;
    const theme = opts.colors || (kind === "waila"
      ? [0xcc33397f,0xcc33397f,0xcc4349bf,0xcc4349bf]
      : [0xf0100010,0xf0100010,0x505000ff,0x5028007f]);
    if (kind === "chat") {
      for (const row of layout.rows) paint.rect(box.bx, box.by + row.y, box.w, 9, [0,0,0,127]);
    } else if (kind !== "text" && layout.rows.length) {
      if (kind === "waila") {
        roundedBox(paint, box.bx, box.by, box.w - 1, box.h - 1, theme.map(argb));
      } else {
        roundedBox(paint, box.bx, box.by, textWidth + 7, textHeight + 7, theme.map(argb));
      }
    }
    const defaultColor = opts.textColor !== undefined ? argb(opts.textColor) :
      kind === "waila" ? [160,160,160] : [255,255,255];
    for (const row of layout.rows) for (const cell of row.cells) {
      if (row.dividerColor!=null) {
        paint.rect(box.x,box.y+row.y+4.5,textWidth,1,[...palette[row.dividerColor],255]);
        continue;
      }
      if (row.divider) {
        const color=[85,255,255,255];
        const middle=box.y+row.y+4;
        const after=cell.x+row.width+4;
        paint.rect(box.x,middle,Math.max(0,cell.x-4),1,color);
        paint.rect(box.x+after,middle,Math.max(0,textWidth-after),1,color);
      }
      const base = row.color===undefined ? defaultColor : argb(row.color);
      const shadowEnabled = row.shadow ?? layout.shadow;
      const passes = shadowEnabled ? [true,false] : [false];
      const glyphs = cell.line.map((glyph,index) => {
        if (!glyph.k || glyph.character === " ") return glyph;
        const lookalikes = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
          .split("").filter(c => describe(c,assets.font,opts.fontMode).metric === glyph.shape.metric);
        if (!lookalikes.length) return glyph;
        const character = lookalikes[(opts.frame * 13 + index * 17) % lookalikes.length];
        return {...glyph, character, shape:describe(character,assets.font,opts.fontMode)};
      });
      if (fontSettings && assets.font) {
        let x=box.x+cell.x;
        const y=box.y+row.y;
        for (const glyph of glyphs) {
          const {shape,advance}=glyph;
          const shadow=fontSettings.shadowOffset*(shape.unicode ? fontSettings.unicodeShadow : 1);
          const rgb=rgbOf(glyph,base,false);
          if (shape.image) {
            if (shadowEnabled) {
              const shade=rgbOf(glyph,base,true);
              for (let n=1; n<=fontSettings.shadowCopies; n++) {
                const off=shadow*n/fontSettings.shadowCopies;
                paint.quad(shape,x+off,y+off,shade,glyph.o);
                if (glyph.l) paint.quad(shape,x+2*off,y+off,shade,glyph.o);
              }
            }
            paint.quad(shape,x,y,rgb,glyph.o);
            if (glyph.l) for (let n=1; n<=fontSettings.boldCopies; n++) {
              paint.quad(shape,x+shadow*n/fontSettings.boldCopies,y,rgb,glyph.o);
            }
          }
          if (advance>0 && (assets.rawPixels || glyph.character!==" ")) {
            // Angelica starts the decoration one pixel before the pen, and ends it at the advanced pen.
            const span=advance+(assets.rawPixels ? 1 : 0);
            if (glyph.m) paint.rect(x-1,y+3,span,1,[...rgb,255]);
            if (glyph.n) paint.rect(x-1,y+8,span,1,[...rgb,255]);
          }
          x+=advance;
        }
        continue;
      }
      for (const shadow of passes) {
        let x = box.x + cell.x;
        let y = box.y + row.y;
        if (shadow) { x++; y++; }
        for (const glyph of glyphs) {
          const shape = glyph.shape;
          const rgb = rgbOf(glyph, base, shadow);
          const bold = opts.fontMode === "unicode" ? 0.5 : 1;
          const unicodeOffset = shadow && shape.unicode && opts.fontMode !== "modern" ? bold : 0;
          if (shape.image) {
            paint.quad(shape, x-unicodeOffset, y-unicodeOffset, rgb, glyph.o);
            if (glyph.l) paint.quad(shape, x+bold-unicodeOffset, y-unicodeOffset, rgb, glyph.o);
          } else if (shape.fallback) {
            // Browser fallback is used only before importing the game's bitmap data.
            assets.fallback.push({glyph, x:x-dx, y:y-dy, rgb});
          }
          const advance = glyph.advance;
          if (glyph.m) paint.rect(x,y+3,advance,1,[...rgb,255]);
          if (glyph.n) paint.rect(x-1,y+8,advance+1,1,[...rgb,255]);
          x += advance;
        }
      }
    }
    if((assets.rawPixels||assets.painter) && !assets.fallback.length && kind==="text")return paint.done();
    paint.done();
    for (const {glyph, x, y, rgb} of assets.fallback) {
      ctx.fillStyle = "rgb(" + rgb.join(",") + ")";
      ctx.font = (glyph.o ? "italic " : "") + (glyph.l ? "bold " : "") + 8*scale + "px monospace";
      ctx.textBaseline = "top";
      ctx.fillText(glyph.character,x*scale,y*scale);
    }
    if (kind === "waila" && assets.icon) {
      ctx.drawImage(assets.icon,(box.bx+5-dx)*scale,(box.by+Math.floor((box.h-1)/2)-8-dy)*scale,16*scale,16*scale);
    }
  }
  return {legacy, profiles, argb, modernDefaults, samples, styledText, itemLines, parse, describe, prepare, measure, wrap, plan, planPositions, chromaticBounds, bounds, raster};
})();
