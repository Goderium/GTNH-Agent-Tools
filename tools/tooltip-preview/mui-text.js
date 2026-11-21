"use strict";
// MUI2 TextRenderer.measureLines/getStartX/getStartY, using the workbench's installed bitmap font.
globalThis.MuiText=(()=>{
  function measure(text,maxWidth,config,font,opts) {
    if(typeof text!=="string" || text.length>8192) throw Error("Invalid MUI2 text.");
    const scale=config?.scale??1;
    if(!Number.isFinite(scale)||scale<=0||scale>8)throw Error("Invalid MUI2 text scale.");
    const logicalLimit=Math.trunc(maxWidth/scale);
    const limit=config?.rich ? (logicalLimit>10?logicalLimit:Infinity) : (maxWidth>0?Math.max(10,logicalLimit):Infinity);
    const lines=[];
    for(const paragraph of text.split("\n")) {
      const glyphs=TooltipCore.prepare(paragraph,font,opts);
      if(glyphs.some(g=>g.shape.missing))throw Error("Missing MUI2 font glyph in "+paragraph);
      const raw=paragraph.match(/§g(?:§x(?:§[0-9a-f]){6}){2}|§x(?:§[0-9a-f]){6}|§[\s\S]|[\s\S]/giu)??[];
      const offsets=[],prefixes=[];
      let offset=0,format="";
      for(const token of raw) {
        if(token.startsWith("§")&&token.length>1) format+=token;
        else {offsets.push(offset);prefixes.push(format);}
        offset+=token.length;
      }
      const wrapped=TooltipCore.wrap(glyphs,limit);
      let start=0;
      for(const row of wrapped) {
        const first=row.length?glyphs.indexOf(row[0],start):0;
        const end=first+row.length;
        const content=first===0?paragraph.slice(0,offsets[end]??paragraph.length):
          prefixes[first]+paragraph.slice(offsets[first],offsets[end]??paragraph.length);
        lines.push({text:content,width:TooltipCore.measure(row)*scale});start=end;
      }
    }
    return {lines,width:Math.max(...lines.map(l=>l.width)),height:lines.length*9*scale};
  }
  function draw(op,guiScale,font,base) {
    const [, ,width,height]=op.box,scale=op.scale??1,maxWidth=op.maxWidth??width;
    const lines=op.lines??measure(op.text,maxWidth,{scale},font,base).lines;
    const align=(op.align??"CenterLeft").split(".").pop();
    const ax=align.includes("Left")?0:align.includes("Right")?1:0.5;
    const ay=align.includes("Top")?0:align.includes("Bottom")?1:0.5;
    const top=Math.round(height*ay)-Math.round((lines.length*9*scale-scale)*ay);
    const [originX,originY]=op.textPos??[0,0];
    const draws=lines.map((line,i)=>({
      x:Math.trunc(Math.fround((originX+Math.max(0,Math.round(maxWidth*ax)-Math.round(line.width*ax)))/scale)),
      y:Math.trunc(Math.fround((originY+top+i*Math.trunc(9*scale))/scale)),color:op.color??0xff404040,shadow:op.shadow??false
    }));
    const opts={...base,scale:guiScale*scale,width:width/scale,height:height/scale,screen:true,amp:false};
    const layout=TooltipCore.planPositions(lines.map(l=>l.text),draws,font,opts);
    if(layout.missing.length)throw Error("Missing MUI2 glyphs: "+layout.missing.join(""));
    const box={x:0,y:0,bx:0,by:0,w:opts.width,h:opts.height};
    if(opts.fontMode==="modern"){
      const settings={...TooltipCore.modernDefaults,...opts.fontSettings},strokes=[];
      const painter={
        quad(shape,x,y,rgb,italic){strokes.push({shape,x,y,rgb,italic});},
        rect(x,y,w,h,rgb){strokes.push({x,y,w,h,rgb});},
        done(){
          const alpha=(op.color??0xff404040)>>>24;
          return {strokes,settings,scale,alpha:alpha<4?1:alpha/255};
        }
      };
      return TooltipCore.raster(null,layout,box,opts,{font,icon:null,fallback:[],rawPixels:true,painter});
    }
    return TooltipCore.raster(document.createElement("canvas"),layout,box,opts,{font,icon:null,fallback:[],rawPixels:true});
  }
  return {measure,draw};
})();
