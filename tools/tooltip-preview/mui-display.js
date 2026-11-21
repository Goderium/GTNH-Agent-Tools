"use strict";
// A standalone preview stores only the glyph atlases and metrics needed by its hover text.
globalThis.MuiDisplay = (() => {
  function pack(font, texts, opts) {
    const glyphs = {}, atlases = [], indexes = new Map();
    let characters = texts.join("");
    if (characters.includes("§k")) characters += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (const ch of new Set(characters)) {
      const shape = TooltipCore.describe(ch, font, opts.fontMode);
      if (!shape.image) continue;
      if (!indexes.has(shape.image)) {
        const canvas = document.createElement("canvas");
        canvas.width = shape.image.width;
        canvas.height = shape.image.height;
        indexes.set(shape.image, atlases.length);
        atlases.push(canvas);
      }
      const page = indexes.get(shape.image);
      // Preserve the source atlas coordinates, including adjoining texels for filtered sampling.
      const x=Math.floor(shape.sx)-1,y=Math.floor(shape.sy)-1;
      atlases[page].getContext("2d").putImageData(shape.image,0,0,x,y,
        Math.ceil(shape.sx+shape.sw)-x+1,Math.ceil(shape.sy+shape.sh)-y+1);
      if (shape.unicode) glyphs[ch] = {page, size:font.sizes[ch.codePointAt(0)]};
      else {
        const {image, ...metrics} = shape;
        glyphs[ch] = {page, metrics};
      }
    }
    return {glyphs, atlases:atlases.map(canvas=>canvas.toDataURL()), opts};
  }

  async function bitmap(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  async function unpack(data) {
    const atlases = await Promise.all(data.atlases.map(async url => {
      const img = await bitmap(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img,0,0);
      return ctx.getImageData(0,0,img.width,img.height);
    }));
    const font = {modern:new Map(), pages:new Map(), sizes:new Uint8Array(65536), asciiGlyphs:[]};
    for (const [ch,entry] of Object.entries(data.glyphs)) {
      const code = ch.codePointAt(0), image = atlases[entry.page];
      if (entry.size) {
        font.sizes[code] = entry.size;
        font.pages.set(code >> 8,image);
      } else {
        const shape = {...entry.metrics,image};
        font.modern.set(ch,shape);
        font.asciiGlyphs[TooltipCore.legacy.indexOf(ch)] = shape;
      }
    }
    return font;
  }

  return {pack,unpack,bitmap};
})();
