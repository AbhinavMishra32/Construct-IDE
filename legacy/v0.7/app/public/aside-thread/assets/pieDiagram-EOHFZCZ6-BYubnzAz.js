!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="019f4f14-6792-7473-8db3-6eb6c0a73ca4")}catch(e){}}();import{f as et}from"./message-BO5xjo0L.js";import{r as o}from"./chunk-PTVI3W5X-BKx4cIxN.js";import{M as at,N as rt,T as M,n as I}from"./chunk-FO5PYUIK-DTIJHvqi.js";import{C as it,E as nt,J as ot,Q as st,Y as lt,b as ct,l as dt,m as gt,o as pt,x as ht}from"./chunk-CHAKFXHA-Cqsoqu8n.js";import{t as ft}from"./chunk-6ZKBGPIT-COq2kL0I.js";import{M as ut}from"./chunk-IIWGMRJM-BgHCqkwv.js";import"./chunk-IPM4HZQ6-CZNKC7eU.js";import{h as mt,i as St}from"./chunk-MMGVDTGO-CfiKquUZ.js";var B=gt.pie,z={sections:new Map,showData:!1,config:B},w=z.sections,E=z.showData,xt=structuredClone(B),U={getConfig:o(()=>structuredClone(xt),"getConfig"),clear:o(()=>{w=new Map,E=z.showData,pt()},"clear"),setDiagramTitle:st,getDiagramTitle:nt,setAccTitle:lt,getAccTitle:ht,setAccDescription:ot,getAccDescription:ct,addSection:o(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);w.has(t)||(w.set(t,a),M.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),getSections:o(()=>w,"getSections"),setShowData:o(t=>{E=t},"setShowData"),getShowData:o(()=>E,"getShowData")},vt=o((t,a)=>{ft(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),wt={parse:o(async t=>{const a=await ut("pie",t);M.debug(a),vt(a,U)},"parse")},Ct=o(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),$t=o(t=>{const a=[...t.values()].reduce((s,c)=>s+c,0),L=[...t.entries()].map(([s,c])=>({label:s,value:c})).filter(s=>s.value/a*100>=1);return rt().value(s=>s.value).sort(null)(L)},"createPieArcs"),Mt={parser:wt,db:U,renderer:{draw:o((t,a,L,s)=>{M.debug(`rendering pie chart
`+t);const c=s.db,W=it(),d=St(c.getConfig(),W.pie),J=40,m=18,F=4,C=450,$=C,D=et(a),S=D.append("g");S.attr("transform","translate(225,225)");const{themeVariables:i}=W;let[H]=mt(i.pieOuterStrokeWidth);H??=2;const Q=d.legendPosition,O=d.textPosition,V=d.donutHole>0&&d.donutHole<=.9?d.donutHole:0,p=Math.min($,C)/2-J,X=I().innerRadius(V*p).outerRadius(p),Y=I().innerRadius(p*O).outerRadius(p*O),f=S.append("g");f.append("circle").attr("cx",0).attr("cy",0).attr("r",p+H/2).attr("class","pieOuterCircle");const x=c.getSections(),Z=$t(x),j=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let y=0;x.forEach(e=>{y+=e});const P=Z.filter(e=>(e.data.value/y*100).toFixed(0)!=="0"),T=at(j).domain([...x.keys()]);f.selectAll("mySlices").data(P).enter().append("path").attr("d",X).attr("fill",e=>T(e.data.label)).attr("class",e=>{let r="pieCircle";return d.highlightSlice==="hover"?r+=" highlightedOnHover":d.highlightSlice===e.data.label&&(r+=" highlighted"),r}),f.selectAll("mySlices").data(P).enter().append("text").text(e=>(e.data.value/y*100).toFixed(0)+"%").attr("transform",e=>"translate("+Y.centroid(e)+")").style("text-anchor","middle").attr("class","slice");const q=S.append("text").text(c.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),u=[...x.entries()].map(([e,r])=>({label:e,value:r})),g=S.selectAll(".legend").data(u).enter().append("g").attr("class","legend");g.append("rect").attr("width",m).attr("height",m).style("fill",e=>T(e.label)).style("stroke",e=>T(e.label)),g.append("text").attr("x",22).attr("y",m-F).text(e=>c.getShowData()?`${e.label} [${e.value}]`:e.label);const h=Math.max(...g.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0));let v=C,b=490;const n=22,A=u.length*n;switch(Q){case"center":g.attr("transform",(e,r)=>{const l=n*u.length/2,_=-h/2-22,k=r*n-l;return"translate("+_+","+k+")"});break;case"top":v+=A,g.attr("transform",(e,r)=>{const l=p;return`translate(${-h/2-22}, ${r*n-l})`}),f.attr("transform",()=>`translate(0, ${A+n})`);break;case"bottom":v+=A,g.attr("transform",(e,r)=>{const l=-185-n,_=-h/2-22,k=r*n-l;return"translate("+_+","+k+")"});break;case"left":b+=22+h,g.attr("transform",(e,r)=>{const l=n*u.length/2;return"translate(-207,"+(r*n-l)+")"}),f.attr("transform",()=>`translate(${h+m+F}, 0)`);break;default:b+=22+h,g.attr("transform",(e,r)=>{const l=n*u.length/2;return"translate(216,"+(r*n-l)+")"});break}const R=q.node()?.getBoundingClientRect().width??0,K=$/2-R/2,tt=$/2+R/2,G=Math.min(0,K),N=Math.max(b,tt)-G;D.attr("viewBox",`${G} 0 ${N} ${v}`),dt(D,v,N,d.useMaxWidth)},"draw")},styles:Ct};export{Mt as diagram};

//# chunkId=019f4f14-6792-7473-8db3-6eb6c0a73ca4