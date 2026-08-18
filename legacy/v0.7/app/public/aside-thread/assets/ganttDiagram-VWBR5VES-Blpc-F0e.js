!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="019f4f14-6718-7f31-a94e-be89ca225acc")}catch(e){}}();import{i as at,r as o,t as Ct}from"./chunk-PTVI3W5X-BKx4cIxN.js";import{$ as de,D as Bt,E as fe,F as Gt,G as qt,H as Xt,I as bt,J as Ut,K as Zt,O as he,P as ee,Q as me,S as ke,T as rt,U as Qt,V as ye,W as ge,X as pe,Y as ve,Z as Te,i as xe,q as be,r as we,y as _e}from"./chunk-FO5PYUIK-DTIJHvqi.js";import{C as dt,E as De,J as Se,Q as Ce,Y as Me,b as Ee,c as Ie,l as $e,o as Ye,x as Le}from"./chunk-CHAKFXHA-Cqsoqu8n.js";import{t as Ae}from"./chunk-IPM4HZQ6-CZNKC7eU.js";import{v as Fe}from"./chunk-MMGVDTGO-CfiKquUZ.js";var Oe=Ct({"../../node_modules/.pnpm/dayjs@1.11.20/node_modules/dayjs/plugin/isoWeek.js"(t,s){"use strict";(function(i,e){typeof t=="object"&&typeof s<"u"?s.exports=e():typeof define=="function"&&define.amd?define(e):(i=typeof globalThis<"u"?globalThis:i||self).dayjs_plugin_isoWeek=e()})(t,(function(){"use strict";var i="day";return function(e,r,h){var v=o(function(I){return I.add(4-I.isoWeekday(),i)},"a"),_=r.prototype;_.isoWeekYear=function(){return v(this).year()},_.isoWeek=function(I){if(!this.$utils().u(I))return this.add(7*(I-this.isoWeek()),i);var S,V,F,N,H=v(this),P=(S=this.isoWeekYear(),V=this.$u,F=(V?h.utc:h)().year(S).startOf("year"),N=4-F.isoWeekday(),F.isoWeekday()>4&&(N+=7),F.add(N,i));return H.diff(P,"week")+1},_.isoWeekday=function(I){return this.$utils().u(I)?this.day()||7:this.day(this.day()%7?I:I-7)};var W=_.startOf;_.startOf=function(I,S){var V=this.$utils(),F=!!V.u(S)||S;return V.p(I)==="isoweek"?F?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):W.bind(this)(I,S)}}}))}}),We=Ct({"../../node_modules/.pnpm/dayjs@1.11.20/node_modules/dayjs/plugin/customParseFormat.js"(t,s){"use strict";(function(i,e){typeof t=="object"&&typeof s<"u"?s.exports=e():typeof define=="function"&&define.amd?define(e):(i=typeof globalThis<"u"?globalThis:i||self).dayjs_plugin_customParseFormat=e()})(t,(function(){"use strict";var i={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},e=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,r=/\d/,h=/\d\d/,v=/\d\d?/,_=/\d*[^-_:/,()\s\d]+/,W={},I=o(function(g){return(g=+g)+(g>68?1900:2e3)},"a"),S=o(function(g){return function(C){this[g]=+C}},"f"),V=[/[+-]\d\d:?(\d\d)?|Z/,function(g){(this.zone||(this.zone={})).offset=(function(C){if(!C||C==="Z")return 0;var O=C.match(/([+-]|\d\d)/g),A=60*O[1]+(+O[2]||0);return A===0?0:O[0]==="+"?-A:A})(g)}],F=o(function(g){var C=W[g];return C&&(C.indexOf?C:C.s.concat(C.f))},"u"),N=o(function(g,C){var O,A=W.meridiem;if(A){for(var B=1;B<=24;B+=1)if(g.indexOf(A(B,0,C))>-1){O=B>12;break}}else O=g===(C?"pm":"PM");return O},"d"),H={A:[_,function(g){this.afternoon=N(g,!1)}],a:[_,function(g){this.afternoon=N(g,!0)}],Q:[r,function(g){this.month=3*(g-1)+1}],S:[r,function(g){this.milliseconds=100*+g}],SS:[h,function(g){this.milliseconds=10*+g}],SSS:[/\d{3}/,function(g){this.milliseconds=+g}],s:[v,S("seconds")],ss:[v,S("seconds")],m:[v,S("minutes")],mm:[v,S("minutes")],H:[v,S("hours")],h:[v,S("hours")],HH:[v,S("hours")],hh:[v,S("hours")],D:[v,S("day")],DD:[h,S("day")],Do:[_,function(g){var C=W.ordinal,O=g.match(/\d+/);if(this.day=O[0],C)for(var A=1;A<=31;A+=1)C(A).replace(/\[|\]/g,"")===g&&(this.day=A)}],w:[v,S("week")],ww:[h,S("week")],M:[v,S("month")],MM:[h,S("month")],MMM:[_,function(g){var C=F("months"),O=(F("monthsShort")||C.map((function(A){return A.slice(0,3)}))).indexOf(g)+1;if(O<1)throw new Error;this.month=O%12||O}],MMMM:[_,function(g){var C=F("months").indexOf(g)+1;if(C<1)throw new Error;this.month=C%12||C}],Y:[/[+-]?\d+/,S("year")],YY:[h,function(g){this.year=I(g)}],YYYY:[/\d{4}/,S("year")],Z:V,ZZ:V};function P(g){for(var C=g,O=W&&W.formats,A=(g=C.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,(function(y,p,a){var l=a&&a.toUpperCase();return p||O[a]||i[a]||O[l].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,(function(d,m,f){return m||f.slice(1)}))}))).match(e),B=A.length,j=0;j<B;j+=1){var $=A[j],T=H[$],k=T&&T[0],E=T&&T[1];A[j]=E?{regex:k,parser:E}:$.replace(/^\[|\]$/g,"")}return function(y){for(var p={},a=0,l=0;a<B;a+=1){var d=A[a];if(typeof d=="string")l+=d.length;else{var m=d.regex,f=d.parser,x=y.slice(l),n=m.exec(x)[0];f.call(p,n),y=y.replace(n,"")}}return(function(w){var u=w.afternoon;if(u!==void 0){var c=w.hours;u?c<12&&(w.hours+=12):c===12&&(w.hours=0),delete w.afternoon}})(p),p}}return o(P,"l"),function(g,C,O){O.p.customParseFormat=!0,g&&g.parseTwoDigitYear&&(I=g.parseTwoDigitYear);var A=C.prototype,B=A.parse;A.parse=function(j){var $=j.date,T=j.utc,k=j.args;this.$u=T;var E=k[1];if(typeof E=="string"){var y=k[2]===!0,p=k[3]===!0,a=y||p,l=k[2];p&&(l=k[2]),W=this.$locale(),!y&&l&&(W=O.Ls[l]),this.$d=(function(x,n,w,u){try{if(["x","X"].indexOf(n)>-1)return new Date((n==="X"?1e3:1)*x);var c=P(n)(x),b=c.year,M=c.month,L=c.day,Y=c.hours,G=c.minutes,D=c.seconds,Z=c.milliseconds,st=c.zone,ct=c.week,yt=new Date,gt=L||(b||M?1:yt.getDate()),lt=b||yt.getFullYear(),z=0;b&&!M||(z=M>0?M-1:yt.getMonth());var it,Q=Y||0,q=G||0,nt=D||0,J=Z||0;return st?new Date(Date.UTC(lt,z,gt,Q,q,nt,J+60*st.offset*1e3)):w?new Date(Date.UTC(lt,z,gt,Q,q,nt,J)):(it=new Date(lt,z,gt,Q,q,nt,J),ct&&(it=u(it).week(ct).toDate()),it)}catch{return new Date("")}})($,E,T,O),this.init(),l&&l!==!0&&(this.$L=this.locale(l).$L),a&&$!=this.format(E)&&(this.$d=new Date("")),W={}}else if(E instanceof Array)for(var d=E.length,m=1;m<=d;m+=1){k[1]=E[m-1];var f=O.apply(this,k);if(f.isValid()){this.$d=f.$d,this.$L=f.$L,this.init();break}m===d&&(this.$d=new Date(""))}else B.call(this,j)}}}))}}),Ve=Ct({"../../node_modules/.pnpm/dayjs@1.11.20/node_modules/dayjs/plugin/advancedFormat.js"(t,s){"use strict";(function(i,e){typeof t=="object"&&typeof s<"u"?s.exports=e():typeof define=="function"&&define.amd?define(e):(i=typeof globalThis<"u"?globalThis:i||self).dayjs_plugin_advancedFormat=e()})(t,(function(){"use strict";return function(i,e){var r=e.prototype,h=r.format;r.format=function(v){var _=this,W=this.$locale();if(!this.isValid())return h.bind(this)(v);var I=this.$utils(),S=(v||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,(function(V){switch(V){case"Q":return Math.ceil((_.$M+1)/3);case"Do":return W.ordinal(_.$D);case"gggg":return _.weekYear();case"GGGG":return _.isoWeekYear();case"wo":return W.ordinal(_.week(),"W");case"w":case"ww":return I.s(_.week(),V==="w"?1:2,"0");case"W":case"WW":return I.s(_.isoWeek(),V==="W"?1:2,"0");case"k":case"kk":return I.s(String(_.$H===0?24:_.$H),V==="k"?1:2,"0");case"X":return Math.floor(_.$d.getTime()/1e3);case"x":return _.$d.getTime();case"z":return"["+_.offsetName()+"]";case"zzz":return"["+_.offsetName("long")+"]";default:return V}}));return h.bind(this)(S)}}}))}}),Pe=Ct({"../../node_modules/.pnpm/dayjs@1.11.20/node_modules/dayjs/plugin/duration.js"(t,s){"use strict";(function(i,e){typeof t=="object"&&typeof s<"u"?s.exports=e():typeof define=="function"&&define.amd?define(e):(i=typeof globalThis<"u"?globalThis:i||self).dayjs_plugin_duration=e()})(t,(function(){"use strict";var i,e,r=1e3,h=6e4,v=36e5,_=864e5,W=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,I=31536e6,S=2628e6,V=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,F={years:I,months:S,days:_,hours:v,minutes:h,seconds:r,milliseconds:1,weeks:6048e5},N=o(function($){return $ instanceof B},"c"),H=o(function($,T,k){return new B($,k,T.$l)},"f"),P=o(function($){return e.p($)+"s"},"m"),g=o(function($){return $<0},"l"),C=o(function($){return g($)?Math.ceil($):Math.floor($)},"$"),O=o(function($){return Math.abs($)},"y"),A=o(function($,T){return $?g($)?{negative:!0,format:""+O($)+T}:{negative:!1,format:""+$+T}:{negative:!1,format:""}},"v"),B=(function(){function $(k,E,y){var p=this;if(this.$d={},this.$l=y,k===void 0&&(this.$ms=0,this.parseFromMilliseconds()),E)return H(k*F[P(E)],this);if(typeof k=="number")return this.$ms=k,this.parseFromMilliseconds(),this;if(typeof k=="object")return Object.keys(k).forEach((function(d){p.$d[P(d)]=k[d]})),this.calMilliseconds(),this;if(typeof k=="string"){var a=k.match(V);if(a){var l=a.slice(2).map((function(d){return d!=null?Number(d):0}));return this.$d.years=l[0],this.$d.months=l[1],this.$d.weeks=l[2],this.$d.days=l[3],this.$d.hours=l[4],this.$d.minutes=l[5],this.$d.seconds=l[6],this.calMilliseconds(),this}}return this}o($,"l");var T=$.prototype;return T.calMilliseconds=function(){var k=this;this.$ms=Object.keys(this.$d).reduce((function(E,y){return E+(k.$d[y]||0)*F[y]}),0)},T.parseFromMilliseconds=function(){var k=this.$ms;this.$d.years=C(k/I),k%=I,this.$d.months=C(k/S),k%=S,this.$d.days=C(k/_),k%=_,this.$d.hours=C(k/v),k%=v,this.$d.minutes=C(k/h),k%=h,this.$d.seconds=C(k/r),k%=r,this.$d.milliseconds=k},T.toISOString=function(){var k=A(this.$d.years,"Y"),E=A(this.$d.months,"M"),y=+this.$d.days||0;this.$d.weeks&&(y+=7*this.$d.weeks);var p=A(y,"D"),a=A(this.$d.hours,"H"),l=A(this.$d.minutes,"M"),d=this.$d.seconds||0;this.$d.milliseconds&&(d+=this.$d.milliseconds/1e3,d=Math.round(1e3*d)/1e3);var m=A(d,"S"),f=k.negative||E.negative||p.negative||a.negative||l.negative||m.negative,x=a.format||l.format||m.format?"T":"",n=(f?"-":"")+"P"+k.format+E.format+p.format+x+a.format+l.format+m.format;return n==="P"||n==="-P"?"P0D":n},T.toJSON=function(){return this.toISOString()},T.format=function(k){var E=k||"YYYY-MM-DDTHH:mm:ss",y={Y:this.$d.years,YY:e.s(this.$d.years,2,"0"),YYYY:e.s(this.$d.years,4,"0"),M:this.$d.months,MM:e.s(this.$d.months,2,"0"),D:this.$d.days,DD:e.s(this.$d.days,2,"0"),H:this.$d.hours,HH:e.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:e.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:e.s(this.$d.seconds,2,"0"),SSS:e.s(this.$d.milliseconds,3,"0")};return E.replace(W,(function(p,a){return a||String(y[p])}))},T.as=function(k){return this.$ms/F[P(k)]},T.get=function(k){var E=this.$ms,y=P(k);return y==="milliseconds"?E%=1e3:E=y==="weeks"?C(E/F[y]):this.$d[y],E||0},T.add=function(k,E,y){var p;return p=E?k*F[P(E)]:N(k)?k.$ms:H(k,this).$ms,H(this.$ms+p*(y?-1:1),this)},T.subtract=function(k,E){return this.add(k,E,!0)},T.locale=function(k){var E=this.clone();return E.$l=k,E},T.clone=function(){return H(this.$ms,this)},T.humanize=function(k){return i().add(this.$ms,"ms").locale(this.$l).fromNow(!k)},T.valueOf=function(){return this.asMilliseconds()},T.milliseconds=function(){return this.get("milliseconds")},T.asMilliseconds=function(){return this.as("milliseconds")},T.seconds=function(){return this.get("seconds")},T.asSeconds=function(){return this.as("seconds")},T.minutes=function(){return this.get("minutes")},T.asMinutes=function(){return this.as("minutes")},T.hours=function(){return this.get("hours")},T.asHours=function(){return this.as("hours")},T.days=function(){return this.get("days")},T.asDays=function(){return this.as("days")},T.weeks=function(){return this.get("weeks")},T.asWeeks=function(){return this.as("weeks")},T.months=function(){return this.get("months")},T.asMonths=function(){return this.as("months")},T.years=function(){return this.get("years")},T.asYears=function(){return this.as("years")},$})(),j=o(function($,T,k){return $.add(T.years()*k,"y").add(T.months()*k,"M").add(T.days()*k,"d").add(T.hours()*k,"h").add(T.minutes()*k,"m").add(T.seconds()*k,"s").add(T.milliseconds()*k,"ms")},"p");return function($,T,k){i=k,e=k().$utils(),k.duration=function(p,a){return H(p,{$l:k.locale()},a)},k.isDuration=N;var E=T.prototype.add,y=T.prototype.subtract;T.prototype.add=function(p,a){return N(p)?j(this,p,1):E.bind(this)(p,a)},T.prototype.subtract=function(p,a){return N(p)?j(this,p,-1):y.bind(this)(p,a)}}}))}}),It=(function(){var t=o(function(a,l,d,m){for(d=d||{},m=a.length;m--;d[a[m]]=l);return d},"o"),s=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],i=[1,26],e=[1,27],r=[1,28],h=[1,29],v=[1,30],_=[1,31],W=[1,32],I=[1,33],S=[1,34],V=[1,9],F=[1,10],N=[1,11],H=[1,12],P=[1,13],g=[1,14],C=[1,15],O=[1,16],A=[1,19],B=[1,20],j=[1,21],$=[1,22],T=[1,23],k=[1,25],E=[1,35],y={trace:o(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:o(function(l,d,m,f,x,n,w){var u=n.length-1;switch(x){case 1:return n[u-1];case 2:this.$=[];break;case 3:n[u-1].push(n[u]),this.$=n[u-1];break;case 4:case 5:this.$=n[u];break;case 6:case 7:this.$=[];break;case 8:f.setWeekday("monday");break;case 9:f.setWeekday("tuesday");break;case 10:f.setWeekday("wednesday");break;case 11:f.setWeekday("thursday");break;case 12:f.setWeekday("friday");break;case 13:f.setWeekday("saturday");break;case 14:f.setWeekday("sunday");break;case 15:f.setWeekend("friday");break;case 16:f.setWeekend("saturday");break;case 17:f.setDateFormat(n[u].substr(11)),this.$=n[u].substr(11);break;case 18:f.enableInclusiveEndDates(),this.$=n[u].substr(18);break;case 19:f.TopAxis(),this.$=n[u].substr(8);break;case 20:f.setAxisFormat(n[u].substr(11)),this.$=n[u].substr(11);break;case 21:f.setTickInterval(n[u].substr(13)),this.$=n[u].substr(13);break;case 22:f.setExcludes(n[u].substr(9)),this.$=n[u].substr(9);break;case 23:f.setIncludes(n[u].substr(9)),this.$=n[u].substr(9);break;case 24:f.setTodayMarker(n[u].substr(12)),this.$=n[u].substr(12);break;case 27:f.setDiagramTitle(n[u].substr(6)),this.$=n[u].substr(6);break;case 28:this.$=n[u].trim(),f.setAccTitle(this.$);break;case 29:case 30:this.$=n[u].trim(),f.setAccDescription(this.$);break;case 31:f.addSection(n[u].substr(8)),this.$=n[u].substr(8);break;case 33:f.addTask(n[u-1],n[u]),this.$="task";break;case 34:this.$=n[u-1],f.setClickEvent(n[u-1],n[u],null);break;case 35:this.$=n[u-2],f.setClickEvent(n[u-2],n[u-1],n[u]);break;case 36:this.$=n[u-2],f.setClickEvent(n[u-2],n[u-1],null),f.setLink(n[u-2],n[u]);break;case 37:this.$=n[u-3],f.setClickEvent(n[u-3],n[u-2],n[u-1]),f.setLink(n[u-3],n[u]);break;case 38:this.$=n[u-2],f.setClickEvent(n[u-2],n[u],null),f.setLink(n[u-2],n[u-1]);break;case 39:this.$=n[u-3],f.setClickEvent(n[u-3],n[u-1],n[u]),f.setLink(n[u-3],n[u-2]);break;case 40:this.$=n[u-1],f.setLink(n[u-1],n[u]);break;case 41:case 47:this.$=n[u-1]+" "+n[u];break;case 42:case 43:case 45:this.$=n[u-2]+" "+n[u-1]+" "+n[u];break;case 44:case 46:this.$=n[u-3]+" "+n[u-2]+" "+n[u-1]+" "+n[u];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(s,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:i,13:e,14:r,15:h,16:v,17:_,18:W,19:18,20:I,21:S,22:V,23:F,24:N,25:H,26:P,27:g,28:C,29:O,30:A,31:B,33:j,35:$,36:T,37:24,38:k,40:E},t(s,[2,7],{1:[2,1]}),t(s,[2,3]),{9:36,11:17,12:i,13:e,14:r,15:h,16:v,17:_,18:W,19:18,20:I,21:S,22:V,23:F,24:N,25:H,26:P,27:g,28:C,29:O,30:A,31:B,33:j,35:$,36:T,37:24,38:k,40:E},t(s,[2,5]),t(s,[2,6]),t(s,[2,17]),t(s,[2,18]),t(s,[2,19]),t(s,[2,20]),t(s,[2,21]),t(s,[2,22]),t(s,[2,23]),t(s,[2,24]),t(s,[2,25]),t(s,[2,26]),t(s,[2,27]),{32:[1,37]},{34:[1,38]},t(s,[2,30]),t(s,[2,31]),t(s,[2,32]),{39:[1,39]},t(s,[2,8]),t(s,[2,9]),t(s,[2,10]),t(s,[2,11]),t(s,[2,12]),t(s,[2,13]),t(s,[2,14]),t(s,[2,15]),t(s,[2,16]),{41:[1,40],43:[1,41]},t(s,[2,4]),t(s,[2,28]),t(s,[2,29]),t(s,[2,33]),t(s,[2,34],{42:[1,42],43:[1,43]}),t(s,[2,40],{41:[1,44]}),t(s,[2,35],{43:[1,45]}),t(s,[2,36]),t(s,[2,38],{42:[1,46]}),t(s,[2,37]),t(s,[2,39])],defaultActions:{},parseError:o(function(l,d){if(d.recoverable)this.trace(l);else{var m=new Error(l);throw m.hash=d,m}},"parseError"),parse:o(function(l){var d=this,m=[0],f=[],x=[null],n=[],w=this.table,u="",c=0,b=0,M=0,L=2,Y=1,G=n.slice.call(arguments,1),D=Object.create(this.lexer),Z={yy:{}};for(var st in this.yy)Object.prototype.hasOwnProperty.call(this.yy,st)&&(Z.yy[st]=this.yy[st]);D.setInput(l,Z.yy),Z.yy.lexer=D,Z.yy.parser=this,typeof D.yylloc>"u"&&(D.yylloc={});var ct=D.yylloc;n.push(ct);var yt=D.options&&D.options.ranges;typeof Z.yy.parseError=="function"?this.parseError=Z.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function gt(X){m.length=m.length-2*X,x.length=x.length-X,n.length=n.length-X}o(gt,"popStack");function lt(){var X=f.pop()||D.lex()||Y;return typeof X!="number"&&(X instanceof Array&&(f=X,X=f.pop()),X=d.symbols_[X]||X),X}o(lt,"lex");for(var z,it,Q,q,nt,J={},pt,tt,Ht,xt;;){if(Q=m[m.length-1],this.defaultActions[Q]?q=this.defaultActions[Q]:((z===null||typeof z>"u")&&(z=lt()),q=w[Q]&&w[Q][z]),typeof q>"u"||!q.length||!q[0]){var Mt="";xt=[];for(pt in w[Q])this.terminals_[pt]&&pt>L&&xt.push("'"+this.terminals_[pt]+"'");D.showPosition?Mt="Parse error on line "+(c+1)+`:
`+D.showPosition()+`
Expecting `+xt.join(", ")+", got '"+(this.terminals_[z]||z)+"'":Mt="Parse error on line "+(c+1)+": Unexpected "+(z==Y?"end of input":"'"+(this.terminals_[z]||z)+"'"),this.parseError(Mt,{text:D.match,token:this.terminals_[z]||z,line:D.yylineno,loc:ct,expected:xt})}if(q[0]instanceof Array&&q.length>1)throw new Error("Parse Error: multiple actions possible at state: "+Q+", token: "+z);switch(q[0]){case 1:m.push(z),x.push(D.yytext),n.push(D.yylloc),m.push(q[1]),z=null,it?(z=it,it=null):(b=D.yyleng,u=D.yytext,c=D.yylineno,ct=D.yylloc,M>0&&M--);break;case 2:if(tt=this.productions_[q[1]][1],J.$=x[x.length-tt],J._$={first_line:n[n.length-(tt||1)].first_line,last_line:n[n.length-1].last_line,first_column:n[n.length-(tt||1)].first_column,last_column:n[n.length-1].last_column},yt&&(J._$.range=[n[n.length-(tt||1)].range[0],n[n.length-1].range[1]]),nt=this.performAction.apply(J,[u,b,c,Z.yy,q[1],x,n].concat(G)),typeof nt<"u")return nt;tt&&(m=m.slice(0,-1*tt*2),x=x.slice(0,-1*tt),n=n.slice(0,-1*tt)),m.push(this.productions_[q[1]][0]),x.push(J.$),n.push(J._$),Ht=w[m[m.length-2]][m[m.length-1]],m.push(Ht);break;case 3:return!0}}return!0},"parse")};y.lexer=(function(){return{EOF:1,parseError:o(function(l,d){if(this.yy.parser)this.yy.parser.parseError(l,d);else throw new Error(l)},"parseError"),setInput:o(function(a,l){return this.yy=l||this.yy||{},this._input=a,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:o(function(){var a=this._input[0];return this.yytext+=a,this.yyleng++,this.offset++,this.match+=a,this.matched+=a,a.match(/(?:\r\n?|\n).*/g)?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),a},"input"),unput:o(function(a){var l=a.length,d=a.split(/(?:\r\n?|\n)/g);this._input=a+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-l),this.offset-=l;var m=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),d.length-1&&(this.yylineno-=d.length-1);var f=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:d?(d.length===m.length?this.yylloc.first_column:0)+m[m.length-d.length].length-d[0].length:this.yylloc.first_column-l},this.options.ranges&&(this.yylloc.range=[f[0],f[0]+this.yyleng-l]),this.yyleng=this.yytext.length,this},"unput"),more:o(function(){return this._more=!0,this},"more"),reject:o(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:o(function(a){this.unput(this.match.slice(a))},"less"),pastInput:o(function(){var a=this.matched.substr(0,this.matched.length-this.match.length);return(a.length>20?"...":"")+a.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:o(function(){var a=this.match;return a.length<20&&(a+=this._input.substr(0,20-a.length)),(a.substr(0,20)+(a.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:o(function(){var a=this.pastInput(),l=new Array(a.length+1).join("-");return a+this.upcomingInput()+`
`+l+"^"},"showPosition"),test_match:o(function(a,l){var d,m,f;if(this.options.backtrack_lexer&&(f={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(f.yylloc.range=this.yylloc.range.slice(0))),m=a[0].match(/(?:\r\n?|\n).*/g),m&&(this.yylineno+=m.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:m?m[m.length-1].length-m[m.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+a[0].length},this.yytext+=a[0],this.match+=a[0],this.matches=a,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(a[0].length),this.matched+=a[0],d=this.performAction.call(this,this.yy,this,l,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),d)return d;if(this._backtrack){for(var x in f)this[x]=f[x];return!1}return!1},"test_match"),next:o(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var a,l,d,m;this._more||(this.yytext="",this.match="");for(var f=this._currentRules(),x=0;x<f.length;x++)if(d=this._input.match(this.rules[f[x]]),d&&(!l||d[0].length>l[0].length)){if(l=d,m=x,this.options.backtrack_lexer){if(a=this.test_match(d,f[x]),a!==!1)return a;if(this._backtrack){l=!1;continue}else return!1}else if(!this.options.flex)break}return l?(a=this.test_match(l,f[m]),a!==!1?a:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:o(function(){var l=this.next();return l||this.lex()},"lex"),begin:o(function(l){this.conditionStack.push(l)},"begin"),popState:o(function(){return this.conditionStack.length-1>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:o(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:o(function(l){return l=this.conditionStack.length-1-Math.abs(l||0),l>=0?this.conditionStack[l]:"INITIAL"},"topState"),pushState:o(function(l){this.begin(l)},"pushState"),stateStackSize:o(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:o(function(l,d,m,f){switch(m){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}}})();function p(){this.yy={}}return o(p,"Parser"),p.prototype=y,y.Parser=p,new p})();It.parser=It;var ze=It,Ne=at(Ae(),1),U=at(ee(),1),je=at(Oe(),1),Re=at(We(),1),He=at(Ve(),1);U.default.extend(je.default);U.default.extend(Re.default);U.default.extend(He.default);var Jt={friday:5,saturday:6},K="",At="",Ft=void 0,Ot="",ht=[],mt=[],Wt=new Map,Vt=[],Dt=[],kt="",Pt="",se=["active","done","crit","milestone","vert"],zt=[],ut="",Tt=!1,Nt=!1,jt="sunday",St="saturday",$t=0,Be=o(function(){Vt=[],Dt=[],kt="",zt=[],wt=0,Lt=void 0,_t=void 0,R=[],K="",At="",Pt="",Ft=void 0,Ot="",ht=[],mt=[],Tt=!1,Nt=!1,$t=0,Wt=new Map,ut="",Ye(),jt="sunday",St="saturday"},"clear"),Ge=o(function(t){ut=t},"setDiagramId"),qe=o(function(t){At=t},"setAxisFormat"),Xe=o(function(){return At},"getAxisFormat"),Ue=o(function(t){Ft=t},"setTickInterval"),Ze=o(function(){return Ft},"getTickInterval"),Qe=o(function(t){Ot=t},"setTodayMarker"),Je=o(function(){return Ot},"getTodayMarker"),Ke=o(function(t){K=t},"setDateFormat"),ts=o(function(){Tt=!0},"enableInclusiveEndDates"),es=o(function(){return Tt},"endDatesAreInclusive"),ss=o(function(){Nt=!0},"enableTopAxis"),is=o(function(){return Nt},"topAxisEnabled"),ns=o(function(t){Pt=t},"setDisplayMode"),rs=o(function(){return Pt},"getDisplayMode"),as=o(function(){return K},"getDateFormat"),ie=o((t,s)=>{const i=s.toLowerCase().split(/[\s,]+/).filter(e=>e!=="");return[...new Set([...t,...i])]},"mergeTokens"),os=o(function(t){ht=ie(ht,t)},"setIncludes"),cs=o(function(){return ht},"getIncludes"),ls=o(function(t){mt=ie(mt,t)},"setExcludes"),us=o(function(){return mt},"getExcludes"),ds=o(function(){return Wt},"getLinks"),fs=o(function(t){kt=t,Vt.push(t)},"addSection"),hs=o(function(){return Vt},"getSections"),ms=o(function(){let t=Kt();const s=10;let i=0;for(;!t&&i<s;)t=Kt(),i++;return Dt=R,Dt},"getTasks"),ne=o(function(t,s,i,e){const r=t.format(s.trim()),h=t.format("YYYY-MM-DD");return e.includes(r)||e.includes(h)?!1:i.includes("weekends")&&(t.isoWeekday()===Jt[St]||t.isoWeekday()===Jt[St]+1)||i.includes(t.format("dddd").toLowerCase())?!0:i.includes(r)||i.includes(h)},"isInvalidDate"),ks=o(function(t){jt=t},"setWeekday"),ys=o(function(){return jt},"getWeekday"),gs=o(function(t){St=t},"setWeekend"),re=o(function(t,s,i,e){if(!i.length||t.manualEndTime)return;let r;t.startTime instanceof Date?r=(0,U.default)(t.startTime):r=(0,U.default)(t.startTime,s,!0),r=r.add(1,"d");let h;t.endTime instanceof Date?h=(0,U.default)(t.endTime):h=(0,U.default)(t.endTime,s,!0);const[v,_]=ps(r,h,s,i,e);t.endTime=v.toDate(),t.renderEndTime=_},"checkTaskDates"),ps=o(function(t,s,i,e,r){let h=!1,v=null;const _=s.add(1e4,"d");for(;t<=s;){if(h||(v=s.toDate()),h=ne(t,i,e,r),h&&(s=s.add(1,"d"),s>_))throw new Error("Failed to find a valid date that was not excluded by `excludes` after 10,000 iterations.");t=t.add(1,"d")}return[s,v]},"fixTaskDates"),Yt=o(function(t,s,i){if(i=i.trim(),o(h=>{const v=h.trim();return v==="x"||v==="X"},"isTimestampFormat")(s)&&/^\d+$/.test(i))return new Date(Number(i));const e=/^after\s+(?<ids>[\d\w- ]+)/.exec(i);if(e!==null){let h=null;for(const _ of e.groups.ids.split(" ")){let W=ot(_);W!==void 0&&(!h||W.endTime>h.endTime)&&(h=W)}if(h)return h.endTime;const v=new Date;return v.setHours(0,0,0,0),v}let r=(0,U.default)(i,s.trim(),!0);if(r.isValid())return r.toDate();{rt.debug("Invalid date:"+i),rt.debug("With date format:"+s.trim());const h=new Date(i);if(h===void 0||isNaN(h.getTime())||h.getFullYear()<-1e4||h.getFullYear()>1e4)throw new Error("Invalid date:"+i);return h}},"getStartDate"),ae=o(function(t){const s=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return s!==null?[Number.parseFloat(s[1]),s[2]]:[NaN,"ms"]},"parseDuration"),oe=o(function(t,s,i,e=!1){i=i.trim();const r=/^until\s+(?<ids>[\d\w- ]+)/.exec(i);if(r!==null){let I=null;for(const V of r.groups.ids.split(" ")){let F=ot(V);F!==void 0&&(!I||F.startTime<I.startTime)&&(I=F)}if(I)return I.startTime;const S=new Date;return S.setHours(0,0,0,0),S}let h=(0,U.default)(i,s.trim(),!0);if(h.isValid())return e&&(h=h.add(1,"d")),h.toDate();let v=(0,U.default)(t);const[_,W]=ae(i);if(!Number.isNaN(_)){const I=v.add(_,W);I.isValid()&&(v=I)}return v.toDate()},"getEndDate"),wt=0,ft=o(function(t){return t===void 0?(wt=wt+1,"task"+wt):t},"parseId"),vs=o(function(t,s){let i;s.substr(0,1)===":"?i=s.substr(1,s.length):i=s;const e=i.split(","),r={};Rt(e,r,se);for(let v=0;v<e.length;v++)e[v]=e[v].trim();let h="";switch(e.length){case 1:r.id=ft(),r.startTime=t.endTime,h=e[0];break;case 2:r.id=ft(),r.startTime=Yt(void 0,K,e[0]),h=e[1];break;case 3:r.id=ft(e[0]),r.startTime=Yt(void 0,K,e[1]),h=e[2];break;default:}return h&&(r.endTime=oe(r.startTime,K,h,Tt),r.manualEndTime=(0,U.default)(h,"YYYY-MM-DD",!0).isValid(),re(r,K,mt,ht)),r},"compileData"),Ts=o(function(t,s){let i;s.substr(0,1)===":"?i=s.substr(1,s.length):i=s;const e=i.split(","),r={};Rt(e,r,se);for(let h=0;h<e.length;h++)e[h]=e[h].trim();switch(e.length){case 1:r.id=ft(),r.startTime={type:"prevTaskEnd",id:t},r.endTime={data:e[0]};break;case 2:r.id=ft(),r.startTime={type:"getStartDate",startData:e[0]},r.endTime={data:e[1]};break;case 3:r.id=ft(e[0]),r.startTime={type:"getStartDate",startData:e[1]},r.endTime={data:e[2]};break;default:}return r},"parseData"),Lt,_t,R=[],ce={},xs=o(function(t,s){const i={section:kt,type:kt,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:s},task:t,classes:[]},e=Ts(_t,s);i.raw.startTime=e.startTime,i.raw.endTime=e.endTime,i.id=e.id,i.prevTaskId=_t,i.active=e.active,i.done=e.done,i.crit=e.crit,i.milestone=e.milestone,i.vert=e.vert,i.vert?i.order=-1:(i.order=$t,$t++);const r=R.push(i);_t=i.id,ce[i.id]=r-1},"addTask"),ot=o(function(t){const s=ce[t];return R[s]},"findTaskById"),bs=o(function(t,s){const i={section:kt,type:kt,description:t,task:t,classes:[]},e=vs(Lt,s);i.startTime=e.startTime,i.endTime=e.endTime,i.id=e.id,i.active=e.active,i.done=e.done,i.crit=e.crit,i.milestone=e.milestone,i.vert=e.vert,Lt=i,Dt.push(i)},"addTaskOrg"),Kt=o(function(){const t=o(function(i){const e=R[i];let r="";switch(R[i].raw.startTime.type){case"prevTaskEnd":e.startTime=ot(e.prevTaskId).endTime;break;case"getStartDate":r=Yt(void 0,K,R[i].raw.startTime.startData),r&&(R[i].startTime=r);break}return R[i].startTime&&(R[i].endTime=oe(R[i].startTime,K,R[i].raw.endTime.data,Tt),R[i].endTime&&(R[i].processed=!0,R[i].manualEndTime=(0,U.default)(R[i].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),re(R[i],K,mt,ht))),R[i].processed},"compileTask");let s=!0;for(const[i,e]of R.entries())t(i),s=s&&e.processed;return s},"compileTasks"),ws=o(function(t,s){let i=s;dt().securityLevel!=="loose"&&(i=(0,Ne.sanitizeUrl)(s)),t.split(",").forEach(function(e){ot(e)!==void 0&&(ue(e,()=>{window.open(i,"_self")}),Wt.set(e,i))}),le(t,"clickable")},"setLink"),le=o(function(t,s){t.split(",").forEach(function(i){let e=ot(i);e!==void 0&&e.classes.push(s)})},"setClass"),_s=o(function(t,s,i){if(dt().securityLevel!=="loose"||s===void 0)return;let e=[];if(typeof i=="string"){e=i.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let r=0;r<e.length;r++){let h=e[r].trim();h.startsWith('"')&&h.endsWith('"')&&(h=h.substr(1,h.length-2)),e[r]=h}}e.length===0&&e.push(t),ot(t)!==void 0&&ue(t,()=>{Fe.runFunc(s,...e)})},"setClickFun"),ue=o(function(t,s){zt.push(function(){const i=ut?`${ut}-${t}`:t,e=document.querySelector(`[id="${i}"]`);e!==null&&e.addEventListener("click",function(){s()})},function(){const i=ut?`${ut}-${t}`:t,e=document.querySelector(`[id="${i}-text"]`);e!==null&&e.addEventListener("click",function(){s()})})},"pushFun"),Ds={getConfig:o(()=>dt().gantt,"getConfig"),clear:Be,setDateFormat:Ke,getDateFormat:as,enableInclusiveEndDates:ts,endDatesAreInclusive:es,enableTopAxis:ss,topAxisEnabled:is,setAxisFormat:qe,getAxisFormat:Xe,setTickInterval:Ue,getTickInterval:Ze,setTodayMarker:Qe,getTodayMarker:Je,setAccTitle:Me,getAccTitle:Le,setDiagramTitle:Ce,getDiagramTitle:De,setDiagramId:Ge,setDisplayMode:ns,getDisplayMode:rs,setAccDescription:Se,getAccDescription:Ee,addSection:fs,getSections:hs,getTasks:ms,addTask:xs,findTaskById:ot,addTaskOrg:bs,setIncludes:os,getIncludes:cs,setExcludes:ls,getExcludes:us,setClickEvent:o(function(t,s,i){t.split(",").forEach(function(e){_s(e,s,i)}),le(t,"clickable")},"setClickEvent"),setLink:ws,getLinks:ds,bindFunctions:o(function(t){zt.forEach(function(s){s(t)})},"bindFunctions"),parseDuration:ae,isInvalidDate:ne,setWeekday:ks,getWeekday:ys,setWeekend:gs};function Rt(t,s,i){let e=!0;for(;e;)e=!1,i.forEach(function(r){const h="^\\s*"+r+"\\s*$",v=new RegExp(h);t[0].match(v)&&(s[r]=!0,t.shift(1),e=!0)})}o(Rt,"getTaskTags");var vt=at(ee(),1),Ss=at(Pe(),1);vt.default.extend(Ss.default);var Cs=o(function(){rt.debug("Something is calling, setConf, remove the call")},"setConf"),te={monday:be,tuesday:me,wednesday:de,thursday:Te,friday:ge,saturday:ve,sunday:pe},Ms=o((t,s)=>{let i=[...t].map(()=>-1/0),e=[...t].sort((h,v)=>h.startTime-v.startTime||h.order-v.order),r=0;for(const h of e)for(let v=0;v<i.length;v++)if(h.startTime>=i[v]){i[v]=h.endTime,h.order=v+s,v>r&&(r=v);break}return r},"getMaxIntersections"),et,Et=1e4,As={parser:ze,db:Ds,renderer:{setConf:Cs,draw:o(function(t,s,i,e){const r=dt().gantt;e.db.setDiagramId(s);const h=dt().securityLevel;let v;h==="sandbox"&&(v=bt("#i"+s));const _=h==="sandbox"?bt(v.nodes()[0].contentDocument.body):bt("body"),W=h==="sandbox"?v.nodes()[0].contentDocument:document,I=W.getElementById(s);et=I.parentElement.offsetWidth,et===void 0&&(et=1200),r.useWidth!==void 0&&(et=r.useWidth);const S=e.db.getTasks(),V=S.filter(y=>!y.vert);let F=[];for(const y of V)F.push(y.type);F=E(F);const N={};let H=2*r.topPadding;if(e.db.getDisplayMode()==="compact"||r.displayMode==="compact"){const y={};for(const a of V)y[a.section]===void 0?y[a.section]=[a]:y[a.section].push(a);let p=0;for(const a of Object.keys(y)){const l=Ms(y[a],p)+1;p+=l,H+=l*(r.barHeight+r.barGap),N[a]=l}}else{H+=V.length*(r.barHeight+r.barGap);for(const y of F)N[y]=V.filter(p=>p.type===y).length}I.setAttribute("viewBox","0 0 "+et+" "+H);const P=_.select(`[id="${s}"]`),g=ye().domain([he(S,function(y){return y.startTime}),fe(S,function(y){return y.endTime})]).rangeRound([0,et-r.leftPadding-r.rightPadding]);function C(y,p){const a=y.startTime,l=p.startTime;let d=0;return a>l?d=1:a<l&&(d=-1),d}o(C,"taskCompare"),S.sort(C),O(S,et,H),$e(P,H,et,r.useMaxWidth),P.append("text").text(e.db.getDiagramTitle()).attr("x",et/2).attr("y",r.titleTopMargin).attr("class","titleText");function O(y,p,a){const l=r.barHeight,d=l+r.barGap,m=r.topPadding,f=r.leftPadding,x=ke().domain([0,F.length]).range(["#00B9FA","#F95002"]).interpolate(_e);B(d,m,f,p,a,y,e.db.getExcludes(),e.db.getIncludes()),$(f,m,p,a),A(y,d,m,f,l,x,p,a),T(d,m,f,l,x),k(f,m,p,a)}o(O,"makeGantt");function A(y,p,a,l,d,m,f){y.sort((c,b)=>c.vert===b.vert?0:c.vert?1:-1);const x=y.filter(c=>!c.vert),n=[...new Set(x.map(c=>c.order))].map(c=>x.find(b=>b.order===c));P.append("g").selectAll("rect").data(n).enter().append("rect").attr("x",0).attr("y",function(c,b){return b=c.order,b*p+a-2}).attr("width",function(){return f-r.rightPadding/2}).attr("height",p).attr("class",function(c){for(const[b,M]of F.entries())if(c.type===M)return"section section"+b%r.numberSectionStyles;return"section section0"}).enter();const w=P.append("g").selectAll("rect").data(y).enter(),u=e.db.getLinks();if(w.append("rect").attr("id",function(c){return s+"-"+c.id}).attr("rx",3).attr("ry",3).attr("x",function(c){return c.milestone?g(c.startTime)+l+.5*(g(c.endTime)-g(c.startTime))-.5*d:g(c.startTime)+l}).attr("y",function(c,b){return b=c.order,c.vert?r.gridLineStartPadding:b*p+a}).attr("width",function(c){return c.milestone?d:c.vert?.08*d:g(c.renderEndTime||c.endTime)-g(c.startTime)}).attr("height",function(c){return c.vert?x.length*(r.barHeight+r.barGap)+r.barHeight*2:d}).attr("transform-origin",function(c,b){return b=c.order,(g(c.startTime)+l+.5*(g(c.endTime)-g(c.startTime))).toString()+"px "+(b*p+a+.5*d).toString()+"px"}).attr("class",function(c){const b="task";let M="";c.classes.length>0&&(M=c.classes.join(" "));let L=0;for(const[G,D]of F.entries())c.type===D&&(L=G%r.numberSectionStyles);let Y="";return c.active?c.crit?Y+=" activeCrit":Y=" active":c.done?c.crit?Y=" doneCrit":Y=" done":c.crit&&(Y+=" crit"),Y.length===0&&(Y=" task"),c.milestone&&(Y=" milestone "+Y),c.vert&&(Y=" vert "+Y),Y+=L,Y+=" "+M,b+Y}),w.append("text").attr("id",function(c){return s+"-"+c.id+"-text"}).text(function(c){return c.task}).attr("font-size",r.fontSize).attr("x",function(c){let b=g(c.startTime),M=g(c.renderEndTime||c.endTime);if(c.milestone&&(b+=.5*(g(c.endTime)-g(c.startTime))-.5*d,M=b+d),c.vert)return g(c.startTime)+l;const L=this.getBBox().width;return L>M-b?M+L+1.5*r.leftPadding>f?b+l-5:M+l+5:(M-b)/2+b+l}).attr("y",function(c,b){return c.vert?r.gridLineStartPadding+x.length*(r.barHeight+r.barGap)+60:(b=c.order,b*p+r.barHeight/2+(r.fontSize/2-2)+a)}).attr("text-height",d).attr("class",function(c){const b=g(c.startTime);let M=g(c.endTime);c.milestone&&(M=b+d);const L=this.getBBox().width;let Y="";c.classes.length>0&&(Y=c.classes.join(" "));let G=0;for(const[Z,st]of F.entries())c.type===st&&(G=Z%r.numberSectionStyles);let D="";return c.active&&(c.crit?D="activeCritText"+G:D="activeText"+G),c.done?c.crit?D=D+" doneCritText"+G:D=D+" doneText"+G:c.crit&&(D=D+" critText"+G),c.milestone&&(D+=" milestoneText"),c.vert&&(D+=" vertText"),L>M-b?M+L+1.5*r.leftPadding>f?Y+" taskTextOutsideLeft taskTextOutside"+G+" "+D:Y+" taskTextOutsideRight taskTextOutside"+G+" "+D+" width-"+L:Y+" taskText taskText"+G+" "+D+" width-"+L}),dt().securityLevel==="sandbox"){let c;c=bt("#i"+s);const b=c.nodes()[0].contentDocument;w.filter(function(M){return u.has(M.id)}).each(function(M){var L=b.querySelector("#"+CSS.escape(s+"-"+M.id)),Y=b.querySelector("#"+CSS.escape(s+"-"+M.id+"-text"));const G=L.parentNode;var D=b.createElement("a");D.setAttribute("xlink:href",u.get(M.id)),D.setAttribute("target","_top"),G.appendChild(D),D.appendChild(L),D.appendChild(Y)})}}o(A,"drawRects");function B(y,p,a,l,d,m,f,x){if(f.length===0&&x.length===0)return;let n,w;for(const{startTime:L,endTime:Y}of m)(n===void 0||L<n)&&(n=L),(w===void 0||Y>w)&&(w=Y);if(!n||!w)return;if((0,vt.default)(w).diff((0,vt.default)(n),"year")>5){rt.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const u=e.db.getDateFormat(),c=[];let b=null,M=(0,vt.default)(n);for(;M.valueOf()<=w;)e.db.isInvalidDate(M,u,f,x)?b?b.end=M:b={start:M,end:M}:b&&(c.push(b),b=null),M=M.add(1,"d");P.append("g").selectAll("rect").data(c).enter().append("rect").attr("id",L=>s+"-exclude-"+L.start.format("YYYY-MM-DD")).attr("x",L=>g(L.start.startOf("day"))+a).attr("y",r.gridLineStartPadding).attr("width",L=>g(L.end.endOf("day"))-g(L.start.startOf("day"))).attr("height",d-p-r.gridLineStartPadding).attr("transform-origin",function(L,Y){return(g(L.start)+a+.5*(g(L.end)-g(L.start))).toString()+"px "+(Y*y+.5*d).toString()+"px"}).attr("class","exclude-range")}o(B,"drawExcludeDays");function j(y,p,a,l){if(a<=0||y>p)return 1/0;const d=p-y,m=vt.default.duration({[l??"day"]:a}).asMilliseconds();return m<=0?1/0:Math.ceil(d/m)}o(j,"getEstimatedTickCount");function $(y,p,a,l){const d=e.db.getDateFormat(),m=e.db.getAxisFormat();let f;m?f=m:d==="D"?f="%d":f=r.axisFormat??"%Y-%m-%d";let x=we(g).tickSize(-l+p+r.gridLineStartPadding).tickFormat(Qt(f));const n=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(e.db.getTickInterval()||r.tickInterval);if(n!==null){const w=parseInt(n[1],10);if(isNaN(w)||w<=0)rt.warn(`Invalid tick interval value: "${n[1]}". Skipping custom tick interval.`);else{const u=n[2],c=e.db.getWeekday()||r.weekday,b=g.domain(),M=b[0],L=b[1],Y=j(M,L,w,u);if(Y>Et)rt.warn(`The tick interval "${w}${u}" would generate ${Y} ticks, which exceeds the maximum allowed (${Et}). This may indicate an invalid date or time range. Skipping custom tick interval.`);else switch(u){case"millisecond":x.ticks(Bt.every(w));break;case"second":x.ticks(Gt.every(w));break;case"minute":x.ticks(Zt.every(w));break;case"hour":x.ticks(qt.every(w));break;case"day":x.ticks(Xt.every(w));break;case"week":x.ticks(te[c].every(w));break;case"month":x.ticks(Ut.every(w));break}}}if(P.append("g").attr("class","grid").attr("transform","translate("+y+", "+(l-50)+")").call(x).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),e.db.topAxisEnabled()||r.topAxis){let w=xe(g).tickSize(-l+p+r.gridLineStartPadding).tickFormat(Qt(f));if(n!==null){const u=parseInt(n[1],10);if(isNaN(u)||u<=0)rt.warn(`Invalid tick interval value: "${n[1]}". Skipping custom tick interval.`);else{const c=n[2],b=e.db.getWeekday()||r.weekday,M=g.domain(),L=M[0],Y=M[1];if(j(L,Y,u,c)<=Et)switch(c){case"millisecond":w.ticks(Bt.every(u));break;case"second":w.ticks(Gt.every(u));break;case"minute":w.ticks(Zt.every(u));break;case"hour":w.ticks(qt.every(u));break;case"day":w.ticks(Xt.every(u));break;case"week":w.ticks(te[b].every(u));break;case"month":w.ticks(Ut.every(u));break}}}P.append("g").attr("class","grid").attr("transform","translate("+y+", "+p+")").call(w).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}o($,"makeGrid");function T(y,p){let a=0;const l=Object.keys(N).map(d=>[d,N[d]]);P.append("g").selectAll("text").data(l).enter().append(function(d){const m=d[0].split(Ie.lineBreakRegex),f=-(m.length-1)/2,x=W.createElementNS("http://www.w3.org/2000/svg","text");x.setAttribute("dy",f+"em");for(const[n,w]of m.entries()){const u=W.createElementNS("http://www.w3.org/2000/svg","tspan");u.setAttribute("alignment-baseline","central"),u.setAttribute("x","10"),n>0&&u.setAttribute("dy","1em"),u.textContent=w,x.appendChild(u)}return x}).attr("x",10).attr("y",function(d,m){if(m>0)for(let f=0;f<m;f++)return a+=l[m-1][1],d[1]*y/2+a*y+p;else return d[1]*y/2+p}).attr("font-size",r.sectionFontSize).attr("class",function(d){for(const[m,f]of F.entries())if(d[0]===f)return"sectionTitle sectionTitle"+m%r.numberSectionStyles;return"sectionTitle"})}o(T,"vertLabels");function k(y,p,a,l){const d=e.db.getTodayMarker();if(d==="off")return;const m=P.append("g").attr("class","today"),f=new Date,x=m.append("line");x.attr("x1",g(f)+y).attr("x2",g(f)+y).attr("y1",r.titleTopMargin).attr("y2",l-r.titleTopMargin).attr("class","today"),d!==""&&x.attr("style",d.replace(/,/g,";"))}o(k,"drawToday");function E(y){const p={},a=[];for(let l=0,d=y.length;l<d;++l)Object.prototype.hasOwnProperty.call(p,y[l])||(p[y[l]]=!0,a.push(y[l]));return a}o(E,"checkUnique")},"draw")},styles:o(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done task text displayed outside the bar sits against the diagram background,
     not against the done-task bar, so it must use the outside/contrast color. */
  .doneText0.taskTextOutsideLeft,
  .doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,
  .doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,
  .doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,
  .doneText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done-crit task text outside the bar — same reasoning as doneText above. */
  .doneCritText0.taskTextOutsideLeft,
  .doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,
  .doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,
  .doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,
  .doneCritText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles")};export{As as diagram};

//# chunkId=019f4f14-6718-7f31-a94e-be89ca225acc