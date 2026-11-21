// The default ListWidget scroll direction is vertical. Its first layout pass
// collapses disabled children, unlike Flow, which retains them by default.
export function collectionWidget(name,args,widget) {
  if(name==="Grid" && !args.length)return widget("Grid");
  if(name==="Flow" && args.length===1 && ["GuiAxis.X","GuiAxis.Y"].includes(args[0]?.ref))
    return {...widget(args[0].ref==="GuiAxis.X"?"row":"column"),wRel:1,hRel:1};
  if(name==="ListWidget" && args.length===0)
    return {...widget("column"),list:true,collapseDisabled:true};
  if(name==="ScrollingTextWidget" && args.length===1)
    return {...widget("TextWidget"),scrollingText:true,text:args[0]};
}

// Grid.createGridOfWidthHeight calls its mapper in row-major order and permits null cells.
export function fillGrid(grid,columns,rows,mapper) {
  if(!Number.isInteger(columns) || !Number.isInteger(rows) || columns<0 || rows<0 ||
    Math.max(columns,rows)>4096 || columns*rows>4096 || typeof mapper!=="function")
    throw Error("Invalid MUI Grid dimensions or mapper.");
  grid.columns=columns;grid.rows=rows;grid.cells=[];grid.children=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const child=mapper(x,y,y*columns+x);
    if(child!=null && child.type!=="widget")throw Error("Grid mapper must return a widget or null.");
    grid.cells.push(child);if(child!=null)grid.children.push(child);
  }
}

export function gridMetrics(grid,measure,isEnabled) {
  if(!grid.cells || grid.padding.some(Boolean))throw Error("Grid requires a populated matrix and default padding.");
  const widths=Array(grid.columns).fill(5),heights=Array(grid.rows).fill(5);
  const children=[];
  for(const [index,child] of grid.cells.entries()){
    if(!child)continue;
    const col=index%grid.columns,row=Math.trunc(index/grid.columns);
    const enabled=grid.collapseDisabled?isEnabled(child):undefined;
    const [w,h]=measure(child,enabled!==false);
    const [l,t,r,b]=child.margin;
    // minElementMargin defaults to zero and is applied only on interior edges.
    const left=col===0?l:Math.max(0,l),top=row===0?t:Math.max(0,t);
    const right=col===grid.columns-1 && col!==0?r:Math.max(0,r);
    const bottom=row===grid.rows-1 && row!==0?b:Math.max(0,b);
    if(enabled!==false){widths[col]=Math.max(widths[col],left+w+right);heights[row]=Math.max(heights[row],top+h+bottom);}
    children.push({child,col,row,w,h,left,top,right,bottom,enabled});
  }
  const positions=sizes=>{let sum=0;return sizes.map(size=>{const start=sum;sum+=size;return start;});};
  const xs=positions(widths),ys=positions(heights);
  return {width:widths.reduce((a,b)=>a+b,0),height:heights.reduce((a,b)=>a+b,0),
    children:children.map(({child,col,row,w,h,left,top,right,bottom,enabled})=>({child,enabled,box:[
      Math.trunc(xs[col]+left+(widths[col]-left-right-w)*0.5),
      Math.trunc(ys[row]+top+(heights[row]-top-bottom-h)*0.5),w,h]}))};
}

// An enabled-child listener that only invalidates layout has already been
// honored by the full source layout pass performed after every state change.
// A listener with any additional side effect requires separate support.
export function resizeOnlyListener(listener) {
  if(!listener || listener[0]?.length!==2 || listener[1]?.[0]!=="BLOCK")return false;
  const [params,body]=listener,statements=body[2];
  const calls=statements.map(s=>s[0]==="EXPRESSION_STATEMENT" && s[2][0]==="METHOD_INVOCATION"?s[2]:null);
  if(!calls.length || calls.some(c=>!c || c[2][0]!=="MEMBER_SELECT" || c[2][2][0]!=="IDENTIFIER"))return false;
  const first=calls[0];
  if(first[2][2][2]!=="super" || first[2][3]!=="onChildChangeEnabled" || first[3].length!==2 ||
     !first[3].every((arg,i)=>arg[0]==="IDENTIFIER" && arg[2]===params[i]))return false;
  return calls.slice(1).every(c=>c[2][3]==="scheduleResize" && c[3].length===0);
}

// SimpleFlow.layout divides remaining padded space equally with Java integer
// division and forces START whenever any child expands.
export function expandFlow(children,axis,available,gap) {
  const expanded=children.filter(({child})=>child.expanded);
  if(!expanded.length)return false;
  const used=children.reduce((sum,{child,wh})=>
    sum+(child.expanded?0:wh[axis])+child.margin[axis]+child.margin[axis+2],gap*(children.length-1));
  if(available>0){
    const each=Math.trunc((available-used)/expanded.length);
    if(each<0)throw Error("Expanded flow children exceed the available space.");
    for(const item of expanded)item.wh[axis]=each;
  }
  return true;
}
