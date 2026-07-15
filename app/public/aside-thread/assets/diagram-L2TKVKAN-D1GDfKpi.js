!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="019f4f14-68e9-7df1-af75-2500f088549b")}catch(e){}}();import{f as S}from"./message-BO5xjo0L.js";import{r as c}from"./chunk-PTVI3W5X-BKx4cIxN.js";import{T as O}from"./chunk-FO5PYUIK-DTIJHvqi.js";import{E as k,J as R,Q as E,S as w,Y as I,b as F,k as _,l as D,m as P,o as z,x as G}from"./chunk-CHAKFXHA-Cqsoqu8n.js";import{t as B}from"./chunk-6ZKBGPIT-COq2kL0I.js";import{M as W}from"./chunk-IIWGMRJM-BgHCqkwv.js";import"./chunk-IPM4HZQ6-CZNKC7eU.js";import{i as f}from"./chunk-MMGVDTGO-CfiKquUZ.js";var x={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},C={axes:[],curves:[],options:x},g=structuredClone(C),H=P.radar,j=c(()=>f({...H,...w().radar}),"getConfig"),b=c(()=>g.axes,"getAxes"),V=c(()=>g.curves,"getCurves"),Y=c(()=>g.options,"getOptions"),J=c(a=>{g.axes=a.map(t=>({name:t.name,label:t.label??t.name}))},"setAxes"),N=c(a=>{g.curves=a.map(t=>({name:t.name,label:t.label??t.name,entries:Q(t.entries)}))},"setCurves"),Q=c(a=>{if(a[0].axis==null)return a.map(e=>e.value);const t=b();if(t.length===0)throw new Error("Axes must be populated before curves for reference entries");return t.map(e=>{const r=a.find(s=>s.axis?.$refText===e.name);if(r===void 0)throw new Error("Missing entry for axis "+e.label);return r.value})},"computeCurveEntries"),h={getAxes:b,getCurves:V,getOptions:Y,setAxes:J,setCurves:N,setOptions:c(a=>{const t=a.reduce((e,r)=>(e[r.name]=r,e),{});g.options={showLegend:t.showLegend?.value??x.showLegend,ticks:t.ticks?.value??x.ticks,max:t.max?.value??x.max,min:t.min?.value??x.min,graticule:t.graticule?.value??x.graticule}},"setOptions"),getConfig:j,clear:c(()=>{z(),g=structuredClone(C)},"clear"),setAccTitle:I,getAccTitle:G,setDiagramTitle:E,getDiagramTitle:k,getAccDescription:F,setAccDescription:R},U=c(a=>{B(a,h);const{axes:t,curves:e,options:r}=a;h.setAxes(t),h.setCurves(e),h.setOptions(r)},"populate"),X={parse:c(async a=>{const t=await W("radar",a);O.debug(t),U(t)},"parse")},Z=c((a,t,e,r)=>{const s=r.db,i=s.getAxes(),l=s.getCurves(),n=s.getOptions(),o=s.getConfig(),d=s.getDiagramTitle(),u=q(S(t),o),p=n.max??Math.max(...l.map($=>Math.max(...$.entries))),m=n.min,v=Math.min(o.width,o.height)/2;K(u,i,v,n.ticks,n.graticule),tt(u,i,v,o),A(u,i,l,m,p,n.graticule,o),T(u,l,n.showLegend,o),u.append("text").attr("class","radarTitle").text(d).attr("x",0).attr("y",-o.height/2-o.marginTop)},"draw"),q=c((a,t)=>{const e=t.width+t.marginLeft+t.marginRight,r=t.height+t.marginTop+t.marginBottom,s={x:t.marginLeft+t.width/2,y:t.marginTop+t.height/2};return D(a,r,e,t.useMaxWidth??!0),a.attr("viewBox",`0 0 ${e} ${r}`).attr("overflow","visible"),a.append("g").attr("transform",`translate(${s.x}, ${s.y})`)},"drawFrame"),K=c((a,t,e,r,s)=>{if(s==="circle")for(let i=0;i<r;i++){const l=e*(i+1)/r;a.append("circle").attr("r",l).attr("class","radarGraticule")}else if(s==="polygon"){const i=t.length;for(let l=0;l<r;l++){const n=e*(l+1)/r,o=t.map((d,u)=>{const p=2*u*Math.PI/i-Math.PI/2;return`${n*Math.cos(p)},${n*Math.sin(p)}`}).join(" ");a.append("polygon").attr("points",o).attr("class","radarGraticule")}}},"drawGraticule"),tt=c((a,t,e,r)=>{const s=t.length;for(let i=0;i<s;i++){const l=t[i].label,n=2*i*Math.PI/s-Math.PI/2,o=Math.cos(n),d=Math.sin(n);a.append("line").attr("x1",0).attr("y1",0).attr("x2",e*r.axisScaleFactor*o).attr("y2",e*r.axisScaleFactor*d).attr("class","radarAxisLine");const u=o>.01?"start":o<-.01?"end":"middle",p=d>.01?"hanging":d<-.01?"auto":"central",m=4;a.append("text").text(l).attr("x",e*r.axisLabelFactor*o+m*o).attr("y",e*r.axisLabelFactor*d+m*d).attr("text-anchor",u).attr("dominant-baseline",p).attr("class","radarAxisLabel")}},"drawAxes");function A(a,t,e,r,s,i,l){const n=t.length,o=Math.min(l.width,l.height)/2;e.forEach((d,u)=>{if(d.entries.length!==n)return;const p=d.entries.map((m,v)=>{const $=2*Math.PI*v/n-Math.PI/2,y=M(m,r,s,o);return{x:y*Math.cos($),y:y*Math.sin($)}});i==="circle"?a.append("path").attr("d",L(p,l.curveTension)).attr("class",`radarCurve-${u}`):i==="polygon"&&a.append("polygon").attr("points",p.map(m=>`${m.x},${m.y}`).join(" ")).attr("class",`radarCurve-${u}`)})}c(A,"drawCurves");function M(a,t,e,r){return r*(Math.min(Math.max(a,t),e)-t)/(e-t)}c(M,"relativeRadius");function L(a,t){const e=a.length;let r=`M${a[0].x},${a[0].y}`;for(let s=0;s<e;s++){const i=a[(s-1+e)%e],l=a[s],n=a[(s+1)%e],o=a[(s+2)%e],d={x:l.x+(n.x-i.x)*t,y:l.y+(n.y-i.y)*t},u={x:n.x-(o.x-l.x)*t,y:n.y-(o.y-l.y)*t};r+=` C${d.x},${d.y} ${u.x},${u.y} ${n.x},${n.y}`}return`${r} Z`}c(L,"closedRoundCurve");function T(a,t,e,r){if(!e)return;const s=(r.width/2+r.marginRight)*3/4,i=-(r.height/2+r.marginTop)*3/4,l=20;t.forEach((n,o)=>{const d=a.append("g").attr("transform",`translate(${s}, ${i+o*l})`);d.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${o}`),d.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(n.label)})}c(T,"drawLegend");var et={draw:Z},at=c((a,t)=>{let e="";for(let r=0;r<a.THEME_COLOR_LIMIT;r++){const s=a[`cScale${r}`];e+=`
		.radarCurve-${r} {
			color: ${s};
			fill: ${s};
			fill-opacity: ${t.curveOpacity};
			stroke: ${s};
			stroke-width: ${t.curveStrokeWidth};
		}
		.radarLegendBox-${r} {
			fill: ${s};
			fill-opacity: ${t.curveOpacity};
			stroke: ${s};
		}
		`}return e},"genIndexStyles"),rt=c(a=>{const t=f(_(),w().themeVariables);return{themeVariables:t,radarOptions:f(t.radar,a)}},"buildRadarStyleOptions"),pt={parser:X,db:h,renderer:et,styles:c(({radar:a}={})=>{const{themeVariables:t,radarOptions:e}=rt(a);return`
	.radarTitle {
		font-size: ${t.fontSize};
		color: ${t.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${e.axisColor};
		stroke-width: ${e.axisStrokeWidth};
	}
	.radarAxisLabel {
		font-size: ${e.axisLabelFontSize}px;
		color: ${e.axisColor};
	}
	.radarGraticule {
		fill: ${e.graticuleColor};
		fill-opacity: ${e.graticuleOpacity};
		stroke: ${e.graticuleColor};
		stroke-width: ${e.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${e.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${at(t,e)}
	`},"styles")};export{pt as diagram};

//# chunkId=019f4f14-68e9-7df1-af75-2500f088549b