// Tooltip placement and bitmap geometry use the same logical GUI coordinates as the source widgets.
import "./renderer.js";

export const chromaticBounds = globalThis.TooltipCore.chromaticBounds;

export function placeMuiTooltip(mode, tip, view, pointer, chromatic) {
  const {x, y} = pointer;
  if (mode === "chromatic") {
    const box = chromatic(tip.width, tip.height, {width:view.width, height:view.height, x, y});
    return {x:box.bx, y:box.by, width:tip.width, height:tip.height};
  }
  // RichTooltip.determineTooltipArea, NEXT_TO_MOUSE.
  const initialWidth = Math.min(tip.initialWidth, view.width - 14);
  let left = Math.max(8, x + 12);
  if (left + initialWidth + 8 > view.width && view.width - x < x) left = Math.max(8, x - 12 - initialWidth);
  const top = Math.max(8, Math.min(y - 12, view.height - 8 - (tip.height - 8)));
  return {x:left - 4, y:top - 4, width:tip.width, height:tip.height};
}

export function tooltipWidthAt(initialWidth, viewportWidth, x) {
  if (x + 12 + Math.min(viewportWidth - 14, initialWidth) + 8 <= viewportWidth) return viewportWidth;
  return Math.max(1, (viewportWidth - x < x ? x : viewportWidth - x) - 20);
}

export function tooltipScene(metric, mode) {
  const compat = mode === "chromatic";
  const lineHeight = 10;
  const contentWidth = Math.max(0, Math.trunc(metric.width) - (compat ? 0 : 1));
  const lines = metric.lines.map(line => {
    if (!compat || /^\s*§[0-9a-f]/i.test(line.text)) return line;
    return {...line, text:"§f" + line.text};
  });
  const titleGap = compat && lines.length > 1 && lines[0].text.startsWith("§f") && !lines[1].text.startsWith("§f") ? 2 : 0;
  const contentHeight = lines.length * lineHeight - (compat ? 2 : 1) + titleGap;
  const width = contentWidth + 8, height = contentHeight + 8;
  const ops = [];
  const background = 0xf0100010, accent = 0x505000ff, end = 0x5028007f;
  function rect(x, y, w, h, top, bottom = top) {
    ops.push({type:"rect", box:[x,y,w,h], colors:[top,top,bottom,bottom]});
  }
  rect(1,0,width-2,1,background);
  rect(1,height-1,width-2,1,background);
  rect(1,1,width-2,height-2,background);
  rect(0,1,1,height-2,background);
  rect(width-1,1,1,height-2,background);
  rect(1,2,1,height-4,accent,end);
  rect(width-2,2,1,height-4,accent,end);
  rect(1,1,width-2,1,accent);
  rect(1,height-2,width-2,1,end);
  for (const [i,line] of lines.entries()) {
    // The extra pixel of transparent margin retains the glyph's shadow.
    ops.push({type:"text", text:line.text, lines:[line], align:"TopLeft", color:0xffffffff,
      shadow:compat, box:[4,4+i*lineHeight+(i ? titleGap : 0),Math.max(1,Math.ceil(line.width)+1),10]});
  }
  return {width,height,ops};
}

export function screenScene(panel, viewport, tooltip, position) {
  const translate = (op, dx, dy) => {
    const [x,y,w,h] = op.box;
    const clip=op.clip?[op.clip[0]+dx,op.clip[1]+dy,...op.clip.slice(2)]:undefined;
    return {...op, box:[x+dx,y+dy,w,h],clip};
  };
  const ops = panel.ops.map(op => translate(op,viewport.x,viewport.y));
  if (tooltip) ops.push(...tooltip.ops.map(op => translate(op,position.x,position.y)));
  return {width:viewport.width, height:viewport.height, ops};
}
