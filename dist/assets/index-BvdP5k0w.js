(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const l of document.querySelectorAll('link[rel="modulepreload"]'))r(l);new MutationObserver(l=>{for(const c of l)if(c.type==="childList")for(const d of c.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&r(d)}).observe(document,{childList:!0,subtree:!0});function i(l){const c={};return l.integrity&&(c.integrity=l.integrity),l.referrerPolicy&&(c.referrerPolicy=l.referrerPolicy),l.crossOrigin==="use-credentials"?c.credentials="include":l.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function r(l){if(l.ep)return;l.ep=!0;const c=i(l);fetch(l.href,c)}})();var Gf={exports:{}},ae={};var h0;function SS(){if(h0)return ae;h0=1;var s=Symbol.for("react.transitional.element"),e=Symbol.for("react.portal"),i=Symbol.for("react.fragment"),r=Symbol.for("react.strict_mode"),l=Symbol.for("react.profiler"),c=Symbol.for("react.consumer"),d=Symbol.for("react.context"),h=Symbol.for("react.forward_ref"),m=Symbol.for("react.suspense"),p=Symbol.for("react.memo"),v=Symbol.for("react.lazy"),g=Symbol.for("react.activity"),S=Symbol.iterator;function M(P){return P===null||typeof P!="object"?null:(P=S&&P[S]||P["@@iterator"],typeof P=="function"?P:null)}var T={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},R=Object.assign,y={};function _(P,et,X){this.props=P,this.context=et,this.refs=y,this.updater=X||T}_.prototype.isReactComponent={},_.prototype.setState=function(P,et){if(typeof P!="object"&&typeof P!="function"&&P!=null)throw Error("takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,P,et,"setState")},_.prototype.forceUpdate=function(P){this.updater.enqueueForceUpdate(this,P,"forceUpdate")};function I(){}I.prototype=_.prototype;function z(P,et,X){this.props=P,this.context=et,this.refs=y,this.updater=X||T}var D=z.prototype=new I;D.constructor=z,R(D,_.prototype),D.isPureReactComponent=!0;var H=Array.isArray;function L(){}var U={H:null,A:null,T:null,S:null},V=Object.prototype.hasOwnProperty;function A(P,et,X){var pt=X.ref;return{$$typeof:s,type:P,key:et,ref:pt!==void 0?pt:null,props:X}}function w(P,et){return A(P.type,et,P.props)}function N(P){return typeof P=="object"&&P!==null&&P.$$typeof===s}function J(P){var et={"=":"=0",":":"=2"};return"$"+P.replace(/[=:]/g,function(X){return et[X]})}var tt=/\/+/g;function rt(P,et){return typeof P=="object"&&P!==null&&P.key!=null?J(""+P.key):et.toString(36)}function ct(P){switch(P.status){case"fulfilled":return P.value;case"rejected":throw P.reason;default:switch(typeof P.status=="string"?P.then(L,L):(P.status="pending",P.then(function(et){P.status==="pending"&&(P.status="fulfilled",P.value=et)},function(et){P.status==="pending"&&(P.status="rejected",P.reason=et)})),P.status){case"fulfilled":return P.value;case"rejected":throw P.reason}}throw P}function B(P,et,X,pt,Y){var mt=typeof P;(mt==="undefined"||mt==="boolean")&&(P=null);var ft=!1;if(P===null)ft=!0;else switch(mt){case"bigint":case"string":case"number":ft=!0;break;case"object":switch(P.$$typeof){case s:case e:ft=!0;break;case v:return ft=P._init,B(ft(P._payload),et,X,pt,Y)}}if(ft)return Y=Y(P),ft=pt===""?"."+rt(P,0):pt,H(Y)?(X="",ft!=null&&(X=ft.replace(tt,"$&/")+"/"),B(Y,et,X,"",function($t){return $t})):Y!=null&&(N(Y)&&(Y=w(Y,X+(Y.key==null||P&&P.key===Y.key?"":(""+Y.key).replace(tt,"$&/")+"/")+ft)),et.push(Y)),1;ft=0;var Ut=pt===""?".":pt+":";if(H(P))for(var Dt=0;Dt<P.length;Dt++)pt=P[Dt],mt=Ut+rt(pt,Dt),ft+=B(pt,et,X,mt,Y);else if(Dt=M(P),typeof Dt=="function")for(P=Dt.call(P),Dt=0;!(pt=P.next()).done;)pt=pt.value,mt=Ut+rt(pt,Dt++),ft+=B(pt,et,X,mt,Y);else if(mt==="object"){if(typeof P.then=="function")return B(ct(P),et,X,pt,Y);throw et=String(P),Error("Objects are not valid as a React child (found: "+(et==="[object Object]"?"object with keys {"+Object.keys(P).join(", ")+"}":et)+"). If you meant to render a collection of children, use an array instead.")}return ft}function q(P,et,X){if(P==null)return P;var pt=[],Y=0;return B(P,pt,"","",function(mt){return et.call(X,mt,Y++)}),pt}function j(P){if(P._status===-1){var et=P._result;et=et(),et.then(function(X){(P._status===0||P._status===-1)&&(P._status=1,P._result=X)},function(X){(P._status===0||P._status===-1)&&(P._status=2,P._result=X)}),P._status===-1&&(P._status=0,P._result=et)}if(P._status===1)return P._result.default;throw P._result}var yt=typeof reportError=="function"?reportError:function(P){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var et=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof P=="object"&&P!==null&&typeof P.message=="string"?String(P.message):String(P),error:P});if(!window.dispatchEvent(et))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",P);return}console.error(P)},St={map:q,forEach:function(P,et,X){q(P,function(){et.apply(this,arguments)},X)},count:function(P){var et=0;return q(P,function(){et++}),et},toArray:function(P){return q(P,function(et){return et})||[]},only:function(P){if(!N(P))throw Error("React.Children.only expected to receive a single React element child.");return P}};return ae.Activity=g,ae.Children=St,ae.Component=_,ae.Fragment=i,ae.Profiler=l,ae.PureComponent=z,ae.StrictMode=r,ae.Suspense=m,ae.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=U,ae.__COMPILER_RUNTIME={__proto__:null,c:function(P){return U.H.useMemoCache(P)}},ae.cache=function(P){return function(){return P.apply(null,arguments)}},ae.cacheSignal=function(){return null},ae.cloneElement=function(P,et,X){if(P==null)throw Error("The argument must be a React element, but you passed "+P+".");var pt=R({},P.props),Y=P.key;if(et!=null)for(mt in et.key!==void 0&&(Y=""+et.key),et)!V.call(et,mt)||mt==="key"||mt==="__self"||mt==="__source"||mt==="ref"&&et.ref===void 0||(pt[mt]=et[mt]);var mt=arguments.length-2;if(mt===1)pt.children=X;else if(1<mt){for(var ft=Array(mt),Ut=0;Ut<mt;Ut++)ft[Ut]=arguments[Ut+2];pt.children=ft}return A(P.type,Y,pt)},ae.createContext=function(P){return P={$$typeof:d,_currentValue:P,_currentValue2:P,_threadCount:0,Provider:null,Consumer:null},P.Provider=P,P.Consumer={$$typeof:c,_context:P},P},ae.createElement=function(P,et,X){var pt,Y={},mt=null;if(et!=null)for(pt in et.key!==void 0&&(mt=""+et.key),et)V.call(et,pt)&&pt!=="key"&&pt!=="__self"&&pt!=="__source"&&(Y[pt]=et[pt]);var ft=arguments.length-2;if(ft===1)Y.children=X;else if(1<ft){for(var Ut=Array(ft),Dt=0;Dt<ft;Dt++)Ut[Dt]=arguments[Dt+2];Y.children=Ut}if(P&&P.defaultProps)for(pt in ft=P.defaultProps,ft)Y[pt]===void 0&&(Y[pt]=ft[pt]);return A(P,mt,Y)},ae.createRef=function(){return{current:null}},ae.forwardRef=function(P){return{$$typeof:h,render:P}},ae.isValidElement=N,ae.lazy=function(P){return{$$typeof:v,_payload:{_status:-1,_result:P},_init:j}},ae.memo=function(P,et){return{$$typeof:p,type:P,compare:et===void 0?null:et}},ae.startTransition=function(P){var et=U.T,X={};U.T=X;try{var pt=P(),Y=U.S;Y!==null&&Y(X,pt),typeof pt=="object"&&pt!==null&&typeof pt.then=="function"&&pt.then(L,yt)}catch(mt){yt(mt)}finally{et!==null&&X.types!==null&&(et.types=X.types),U.T=et}},ae.unstable_useCacheRefresh=function(){return U.H.useCacheRefresh()},ae.use=function(P){return U.H.use(P)},ae.useActionState=function(P,et,X){return U.H.useActionState(P,et,X)},ae.useCallback=function(P,et){return U.H.useCallback(P,et)},ae.useContext=function(P){return U.H.useContext(P)},ae.useDebugValue=function(){},ae.useDeferredValue=function(P,et){return U.H.useDeferredValue(P,et)},ae.useEffect=function(P,et){return U.H.useEffect(P,et)},ae.useEffectEvent=function(P){return U.H.useEffectEvent(P)},ae.useId=function(){return U.H.useId()},ae.useImperativeHandle=function(P,et,X){return U.H.useImperativeHandle(P,et,X)},ae.useInsertionEffect=function(P,et){return U.H.useInsertionEffect(P,et)},ae.useLayoutEffect=function(P,et){return U.H.useLayoutEffect(P,et)},ae.useMemo=function(P,et){return U.H.useMemo(P,et)},ae.useOptimistic=function(P,et){return U.H.useOptimistic(P,et)},ae.useReducer=function(P,et,X){return U.H.useReducer(P,et,X)},ae.useRef=function(P){return U.H.useRef(P)},ae.useState=function(P){return U.H.useState(P)},ae.useSyncExternalStore=function(P,et,X){return U.H.useSyncExternalStore(P,et,X)},ae.useTransition=function(){return U.H.useTransition()},ae.version="19.2.6",ae}var p0;function hh(){return p0||(p0=1,Gf.exports=SS()),Gf.exports}var ue=hh(),Vf={exports:{}},Eo={},kf={exports:{}},Xf={};var m0;function yS(){return m0||(m0=1,(function(s){function e(B,q){var j=B.length;B.push(q);t:for(;0<j;){var yt=j-1>>>1,St=B[yt];if(0<l(St,q))B[yt]=q,B[j]=St,j=yt;else break t}}function i(B){return B.length===0?null:B[0]}function r(B){if(B.length===0)return null;var q=B[0],j=B.pop();if(j!==q){B[0]=j;t:for(var yt=0,St=B.length,P=St>>>1;yt<P;){var et=2*(yt+1)-1,X=B[et],pt=et+1,Y=B[pt];if(0>l(X,j))pt<St&&0>l(Y,X)?(B[yt]=Y,B[pt]=j,yt=pt):(B[yt]=X,B[et]=j,yt=et);else if(pt<St&&0>l(Y,j))B[yt]=Y,B[pt]=j,yt=pt;else break t}}return q}function l(B,q){var j=B.sortIndex-q.sortIndex;return j!==0?j:B.id-q.id}if(s.unstable_now=void 0,typeof performance=="object"&&typeof performance.now=="function"){var c=performance;s.unstable_now=function(){return c.now()}}else{var d=Date,h=d.now();s.unstable_now=function(){return d.now()-h}}var m=[],p=[],v=1,g=null,S=3,M=!1,T=!1,R=!1,y=!1,_=typeof setTimeout=="function"?setTimeout:null,I=typeof clearTimeout=="function"?clearTimeout:null,z=typeof setImmediate<"u"?setImmediate:null;function D(B){for(var q=i(p);q!==null;){if(q.callback===null)r(p);else if(q.startTime<=B)r(p),q.sortIndex=q.expirationTime,e(m,q);else break;q=i(p)}}function H(B){if(R=!1,D(B),!T)if(i(m)!==null)T=!0,L||(L=!0,J());else{var q=i(p);q!==null&&ct(H,q.startTime-B)}}var L=!1,U=-1,V=5,A=-1;function w(){return y?!0:!(s.unstable_now()-A<V)}function N(){if(y=!1,L){var B=s.unstable_now();A=B;var q=!0;try{t:{T=!1,R&&(R=!1,I(U),U=-1),M=!0;var j=S;try{e:{for(D(B),g=i(m);g!==null&&!(g.expirationTime>B&&w());){var yt=g.callback;if(typeof yt=="function"){g.callback=null,S=g.priorityLevel;var St=yt(g.expirationTime<=B);if(B=s.unstable_now(),typeof St=="function"){g.callback=St,D(B),q=!0;break e}g===i(m)&&r(m),D(B)}else r(m);g=i(m)}if(g!==null)q=!0;else{var P=i(p);P!==null&&ct(H,P.startTime-B),q=!1}}break t}finally{g=null,S=j,M=!1}q=void 0}}finally{q?J():L=!1}}}var J;if(typeof z=="function")J=function(){z(N)};else if(typeof MessageChannel<"u"){var tt=new MessageChannel,rt=tt.port2;tt.port1.onmessage=N,J=function(){rt.postMessage(null)}}else J=function(){_(N,0)};function ct(B,q){U=_(function(){B(s.unstable_now())},q)}s.unstable_IdlePriority=5,s.unstable_ImmediatePriority=1,s.unstable_LowPriority=4,s.unstable_NormalPriority=3,s.unstable_Profiling=null,s.unstable_UserBlockingPriority=2,s.unstable_cancelCallback=function(B){B.callback=null},s.unstable_forceFrameRate=function(B){0>B||125<B?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):V=0<B?Math.floor(1e3/B):5},s.unstable_getCurrentPriorityLevel=function(){return S},s.unstable_next=function(B){switch(S){case 1:case 2:case 3:var q=3;break;default:q=S}var j=S;S=q;try{return B()}finally{S=j}},s.unstable_requestPaint=function(){y=!0},s.unstable_runWithPriority=function(B,q){switch(B){case 1:case 2:case 3:case 4:case 5:break;default:B=3}var j=S;S=B;try{return q()}finally{S=j}},s.unstable_scheduleCallback=function(B,q,j){var yt=s.unstable_now();switch(typeof j=="object"&&j!==null?(j=j.delay,j=typeof j=="number"&&0<j?yt+j:yt):j=yt,B){case 1:var St=-1;break;case 2:St=250;break;case 5:St=1073741823;break;case 4:St=1e4;break;default:St=5e3}return St=j+St,B={id:v++,callback:q,priorityLevel:B,startTime:j,expirationTime:St,sortIndex:-1},j>yt?(B.sortIndex=j,e(p,B),i(m)===null&&B===i(p)&&(R?(I(U),U=-1):R=!0,ct(H,j-yt))):(B.sortIndex=St,e(m,B),T||M||(T=!0,L||(L=!0,J()))),B},s.unstable_shouldYield=w,s.unstable_wrapCallback=function(B){var q=S;return function(){var j=S;S=q;try{return B.apply(this,arguments)}finally{S=j}}}})(Xf)),Xf}var g0;function MS(){return g0||(g0=1,kf.exports=yS()),kf.exports}var Wf={exports:{}},Tn={};var _0;function ES(){if(_0)return Tn;_0=1;var s=hh();function e(m){var p="https://react.dev/errors/"+m;if(1<arguments.length){p+="?args[]="+encodeURIComponent(arguments[1]);for(var v=2;v<arguments.length;v++)p+="&args[]="+encodeURIComponent(arguments[v])}return"Minified React error #"+m+"; visit "+p+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function i(){}var r={d:{f:i,r:function(){throw Error(e(522))},D:i,C:i,L:i,m:i,X:i,S:i,M:i},p:0,findDOMNode:null},l=Symbol.for("react.portal");function c(m,p,v){var g=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:l,key:g==null?null:""+g,children:m,containerInfo:p,implementation:v}}var d=s.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;function h(m,p){if(m==="font")return"";if(typeof p=="string")return p==="use-credentials"?p:""}return Tn.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=r,Tn.createPortal=function(m,p){var v=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!p||p.nodeType!==1&&p.nodeType!==9&&p.nodeType!==11)throw Error(e(299));return c(m,p,null,v)},Tn.flushSync=function(m){var p=d.T,v=r.p;try{if(d.T=null,r.p=2,m)return m()}finally{d.T=p,r.p=v,r.d.f()}},Tn.preconnect=function(m,p){typeof m=="string"&&(p?(p=p.crossOrigin,p=typeof p=="string"?p==="use-credentials"?p:"":void 0):p=null,r.d.C(m,p))},Tn.prefetchDNS=function(m){typeof m=="string"&&r.d.D(m)},Tn.preinit=function(m,p){if(typeof m=="string"&&p&&typeof p.as=="string"){var v=p.as,g=h(v,p.crossOrigin),S=typeof p.integrity=="string"?p.integrity:void 0,M=typeof p.fetchPriority=="string"?p.fetchPriority:void 0;v==="style"?r.d.S(m,typeof p.precedence=="string"?p.precedence:void 0,{crossOrigin:g,integrity:S,fetchPriority:M}):v==="script"&&r.d.X(m,{crossOrigin:g,integrity:S,fetchPriority:M,nonce:typeof p.nonce=="string"?p.nonce:void 0})}},Tn.preinitModule=function(m,p){if(typeof m=="string")if(typeof p=="object"&&p!==null){if(p.as==null||p.as==="script"){var v=h(p.as,p.crossOrigin);r.d.M(m,{crossOrigin:v,integrity:typeof p.integrity=="string"?p.integrity:void 0,nonce:typeof p.nonce=="string"?p.nonce:void 0})}}else p==null&&r.d.M(m)},Tn.preload=function(m,p){if(typeof m=="string"&&typeof p=="object"&&p!==null&&typeof p.as=="string"){var v=p.as,g=h(v,p.crossOrigin);r.d.L(m,v,{crossOrigin:g,integrity:typeof p.integrity=="string"?p.integrity:void 0,nonce:typeof p.nonce=="string"?p.nonce:void 0,type:typeof p.type=="string"?p.type:void 0,fetchPriority:typeof p.fetchPriority=="string"?p.fetchPriority:void 0,referrerPolicy:typeof p.referrerPolicy=="string"?p.referrerPolicy:void 0,imageSrcSet:typeof p.imageSrcSet=="string"?p.imageSrcSet:void 0,imageSizes:typeof p.imageSizes=="string"?p.imageSizes:void 0,media:typeof p.media=="string"?p.media:void 0})}},Tn.preloadModule=function(m,p){if(typeof m=="string")if(p){var v=h(p.as,p.crossOrigin);r.d.m(m,{as:typeof p.as=="string"&&p.as!=="script"?p.as:void 0,crossOrigin:v,integrity:typeof p.integrity=="string"?p.integrity:void 0})}else r.d.m(m)},Tn.requestFormReset=function(m){r.d.r(m)},Tn.unstable_batchedUpdates=function(m,p){return m(p)},Tn.useFormState=function(m,p,v){return d.H.useFormState(m,p,v)},Tn.useFormStatus=function(){return d.H.useHostTransitionStatus()},Tn.version="19.2.6",Tn}var v0;function TS(){if(v0)return Wf.exports;v0=1;function s(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(s)}catch(e){console.error(e)}}return s(),Wf.exports=ES(),Wf.exports}var x0;function bS(){if(x0)return Eo;x0=1;var s=MS(),e=hh(),i=TS();function r(t){var n="https://react.dev/errors/"+t;if(1<arguments.length){n+="?args[]="+encodeURIComponent(arguments[1]);for(var a=2;a<arguments.length;a++)n+="&args[]="+encodeURIComponent(arguments[a])}return"Minified React error #"+t+"; visit "+n+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function l(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function c(t){var n=t,a=t;if(t.alternate)for(;n.return;)n=n.return;else{t=n;do n=t,(n.flags&4098)!==0&&(a=n.return),t=n.return;while(t)}return n.tag===3?a:null}function d(t){if(t.tag===13){var n=t.memoizedState;if(n===null&&(t=t.alternate,t!==null&&(n=t.memoizedState)),n!==null)return n.dehydrated}return null}function h(t){if(t.tag===31){var n=t.memoizedState;if(n===null&&(t=t.alternate,t!==null&&(n=t.memoizedState)),n!==null)return n.dehydrated}return null}function m(t){if(c(t)!==t)throw Error(r(188))}function p(t){var n=t.alternate;if(!n){if(n=c(t),n===null)throw Error(r(188));return n!==t?null:t}for(var a=t,o=n;;){var u=a.return;if(u===null)break;var f=u.alternate;if(f===null){if(o=u.return,o!==null){a=o;continue}break}if(u.child===f.child){for(f=u.child;f;){if(f===a)return m(u),t;if(f===o)return m(u),n;f=f.sibling}throw Error(r(188))}if(a.return!==o.return)a=u,o=f;else{for(var x=!1,b=u.child;b;){if(b===a){x=!0,a=u,o=f;break}if(b===o){x=!0,o=u,a=f;break}b=b.sibling}if(!x){for(b=f.child;b;){if(b===a){x=!0,a=f,o=u;break}if(b===o){x=!0,o=f,a=u;break}b=b.sibling}if(!x)throw Error(r(189))}}if(a.alternate!==o)throw Error(r(190))}if(a.tag!==3)throw Error(r(188));return a.stateNode.current===a?t:n}function v(t){var n=t.tag;if(n===5||n===26||n===27||n===6)return t;for(t=t.child;t!==null;){if(n=v(t),n!==null)return n;t=t.sibling}return null}var g=Object.assign,S=Symbol.for("react.element"),M=Symbol.for("react.transitional.element"),T=Symbol.for("react.portal"),R=Symbol.for("react.fragment"),y=Symbol.for("react.strict_mode"),_=Symbol.for("react.profiler"),I=Symbol.for("react.consumer"),z=Symbol.for("react.context"),D=Symbol.for("react.forward_ref"),H=Symbol.for("react.suspense"),L=Symbol.for("react.suspense_list"),U=Symbol.for("react.memo"),V=Symbol.for("react.lazy"),A=Symbol.for("react.activity"),w=Symbol.for("react.memo_cache_sentinel"),N=Symbol.iterator;function J(t){return t===null||typeof t!="object"?null:(t=N&&t[N]||t["@@iterator"],typeof t=="function"?t:null)}var tt=Symbol.for("react.client.reference");function rt(t){if(t==null)return null;if(typeof t=="function")return t.$$typeof===tt?null:t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case R:return"Fragment";case _:return"Profiler";case y:return"StrictMode";case H:return"Suspense";case L:return"SuspenseList";case A:return"Activity"}if(typeof t=="object")switch(t.$$typeof){case T:return"Portal";case z:return t.displayName||"Context";case I:return(t._context.displayName||"Context")+".Consumer";case D:var n=t.render;return t=t.displayName,t||(t=n.displayName||n.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case U:return n=t.displayName||null,n!==null?n:rt(t.type)||"Memo";case V:n=t._payload,t=t._init;try{return rt(t(n))}catch{}}return null}var ct=Array.isArray,B=e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,q=i.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,j={pending:!1,data:null,method:null,action:null},yt=[],St=-1;function P(t){return{current:t}}function et(t){0>St||(t.current=yt[St],yt[St]=null,St--)}function X(t,n){St++,yt[St]=t.current,t.current=n}var pt=P(null),Y=P(null),mt=P(null),ft=P(null);function Ut(t,n){switch(X(mt,n),X(Y,t),X(pt,null),n.nodeType){case 9:case 11:t=(t=n.documentElement)&&(t=t.namespaceURI)?Pg(t):0;break;default:if(t=n.tagName,n=n.namespaceURI)n=Pg(n),t=Bg(n,t);else switch(t){case"svg":t=1;break;case"math":t=2;break;default:t=0}}et(pt),X(pt,t)}function Dt(){et(pt),et(Y),et(mt)}function $t(t){t.memoizedState!==null&&X(ft,t);var n=pt.current,a=Bg(n,t.type);n!==a&&(X(Y,t),X(pt,a))}function Be(t){Y.current===t&&(et(pt),et(Y)),ft.current===t&&(et(ft),xo._currentValue=j)}var fe,G;function de(t){if(fe===void 0)try{throw Error()}catch(a){var n=a.stack.trim().match(/\n( *(at )?)/);fe=n&&n[1]||"",G=-1<a.stack.indexOf(`
    at`)?" (<anonymous>)":-1<a.stack.indexOf("@")?"@unknown:0:0":""}return`
`+fe+t+G}var Xt=!1;function pe(t,n){if(!t||Xt)return"";Xt=!0;var a=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{var o={DetermineComponentFrameRoot:function(){try{if(n){var vt=function(){throw Error()};if(Object.defineProperty(vt.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(vt,[])}catch(ut){var st=ut}Reflect.construct(t,[],vt)}else{try{vt.call()}catch(ut){st=ut}t.call(vt.prototype)}}else{try{throw Error()}catch(ut){st=ut}(vt=t())&&typeof vt.catch=="function"&&vt.catch(function(){})}}catch(ut){if(ut&&st&&typeof ut.stack=="string")return[ut.stack,st.stack]}return[null,null]}};o.DetermineComponentFrameRoot.displayName="DetermineComponentFrameRoot";var u=Object.getOwnPropertyDescriptor(o.DetermineComponentFrameRoot,"name");u&&u.configurable&&Object.defineProperty(o.DetermineComponentFrameRoot,"name",{value:"DetermineComponentFrameRoot"});var f=o.DetermineComponentFrameRoot(),x=f[0],b=f[1];if(x&&b){var F=x.split(`
`),it=b.split(`
`);for(u=o=0;o<F.length&&!F[o].includes("DetermineComponentFrameRoot");)o++;for(;u<it.length&&!it[u].includes("DetermineComponentFrameRoot");)u++;if(o===F.length||u===it.length)for(o=F.length-1,u=it.length-1;1<=o&&0<=u&&F[o]!==it[u];)u--;for(;1<=o&&0<=u;o--,u--)if(F[o]!==it[u]){if(o!==1||u!==1)do if(o--,u--,0>u||F[o]!==it[u]){var ht=`
`+F[o].replace(" at new "," at ");return t.displayName&&ht.includes("<anonymous>")&&(ht=ht.replace("<anonymous>",t.displayName)),ht}while(1<=o&&0<=u);break}}}finally{Xt=!1,Error.prepareStackTrace=a}return(a=t?t.displayName||t.name:"")?de(a):""}function Wt(t,n){switch(t.tag){case 26:case 27:case 5:return de(t.type);case 16:return de("Lazy");case 13:return t.child!==n&&n!==null?de("Suspense Fallback"):de("Suspense");case 19:return de("SuspenseList");case 0:case 15:return pe(t.type,!1);case 11:return pe(t.type.render,!1);case 1:return pe(t.type,!0);case 31:return de("Activity");default:return""}}function Ne(t){try{var n="",a=null;do n+=Wt(t,a),a=t,t=t.return;while(t);return n}catch(o){return`
Error generating stack: `+o.message+`
`+o.stack}}var Bt=Object.prototype.hasOwnProperty,ne=s.unstable_scheduleCallback,We=s.unstable_cancelCallback,je=s.unstable_shouldYield,O=s.unstable_requestPaint,E=s.unstable_now,at=s.unstable_getCurrentPriorityLevel,gt=s.unstable_ImmediatePriority,Et=s.unstable_UserBlockingPriority,dt=s.unstable_NormalPriority,Zt=s.unstable_LowPriority,Rt=s.unstable_IdlePriority,qt=s.log,Yt=s.unstable_setDisableYieldValue,bt=null,Ct=null;function jt(t){if(typeof qt=="function"&&Yt(t),Ct&&typeof Ct.setStrictMode=="function")try{Ct.setStrictMode(bt,t)}catch{}}var Pt=Math.clz32?Math.clz32:W,Lt=Math.log,re=Math.LN2;function W(t){return t>>>=0,t===0?32:31-(Lt(t)/re|0)|0}var At=256,wt=262144,Ft=4194304;function Tt(t){var n=t&42;if(n!==0)return n;switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:return 64;case 128:return 128;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:return t&261888;case 262144:case 524288:case 1048576:case 2097152:return t&3932160;case 4194304:case 8388608:case 16777216:case 33554432:return t&62914560;case 67108864:return 67108864;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 0;default:return t}}function xt(t,n,a){var o=t.pendingLanes;if(o===0)return 0;var u=0,f=t.suspendedLanes,x=t.pingedLanes;t=t.warmLanes;var b=o&134217727;return b!==0?(o=b&~f,o!==0?u=Tt(o):(x&=b,x!==0?u=Tt(x):a||(a=b&~t,a!==0&&(u=Tt(a))))):(b=o&~f,b!==0?u=Tt(b):x!==0?u=Tt(x):a||(a=o&~t,a!==0&&(u=Tt(a)))),u===0?0:n!==0&&n!==u&&(n&f)===0&&(f=u&-u,a=n&-n,f>=a||f===32&&(a&4194048)!==0)?n:u}function It(t,n){return(t.pendingLanes&~(t.suspendedLanes&~t.pingedLanes)&n)===0}function ie(t,n){switch(t){case 1:case 2:case 4:case 8:case 64:return n+250;case 16:case 32:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return n+5e3;case 4194304:case 8388608:case 16777216:case 33554432:return-1;case 67108864:case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function Oe(){var t=Ft;return Ft<<=1,(Ft&62914560)===0&&(Ft=4194304),t}function Ee(t){for(var n=[],a=0;31>a;a++)n.push(t);return n}function wn(t,n){t.pendingLanes|=n,n!==268435456&&(t.suspendedLanes=0,t.pingedLanes=0,t.warmLanes=0)}function ti(t,n,a,o,u,f){var x=t.pendingLanes;t.pendingLanes=a,t.suspendedLanes=0,t.pingedLanes=0,t.warmLanes=0,t.expiredLanes&=a,t.entangledLanes&=a,t.errorRecoveryDisabledLanes&=a,t.shellSuspendCounter=0;var b=t.entanglements,F=t.expirationTimes,it=t.hiddenUpdates;for(a=x&~a;0<a;){var ht=31-Pt(a),vt=1<<ht;b[ht]=0,F[ht]=-1;var st=it[ht];if(st!==null)for(it[ht]=null,ht=0;ht<st.length;ht++){var ut=st[ht];ut!==null&&(ut.lane&=-536870913)}a&=~vt}o!==0&&Ls(t,o,0),f!==0&&u===0&&t.tag!==0&&(t.suspendedLanes|=f&~(x&~n))}function Ls(t,n,a){t.pendingLanes|=n,t.suspendedLanes&=~n;var o=31-Pt(n);t.entangledLanes|=n,t.entanglements[o]=t.entanglements[o]|1073741824|a&261930}function Mi(t,n){var a=t.entangledLanes|=n;for(t=t.entanglements;a;){var o=31-Pt(a),u=1<<o;u&n|t[o]&n&&(t[o]|=n),a&=~u}}function Er(t,n){var a=n&-n;return a=(a&42)!==0?1:Tr(a),(a&(t.suspendedLanes|n))!==0?0:a}function Tr(t){switch(t){case 2:t=1;break;case 8:t=4;break;case 32:t=16;break;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:t=128;break;case 268435456:t=134217728;break;default:t=0}return t}function br(t){return t&=-t,2<t?8<t?(t&134217727)!==0?32:268435456:8:2}function Va(){var t=q.p;return t!==0?t:(t=window.event,t===void 0?32:s0(t.type))}function Ns(t,n){var a=q.p;try{return q.p=t,n()}finally{q.p=a}}var kn=Math.random().toString(36).slice(2),an="__reactFiber$"+kn,_n="__reactProps$"+kn,oa="__reactContainer$"+kn,Os="__reactEvents$"+kn,Oc="__reactListeners$"+kn,zc="__reactHandles$"+kn,Ho="__reactResources$"+kn,ka="__reactMarker$"+kn;function C(t){delete t[an],delete t[_n],delete t[Os],delete t[Oc],delete t[zc]}function Z(t){var n=t[an];if(n)return n;for(var a=t.parentNode;a;){if(n=a[oa]||a[an]){if(a=n.alternate,n.child!==null||a!==null&&a.child!==null)for(t=Xg(t);t!==null;){if(a=t[an])return a;t=Xg(t)}return n}t=a,a=t.parentNode}return null}function ot(t){if(t=t[an]||t[oa]){var n=t.tag;if(n===5||n===6||n===13||n===31||n===26||n===27||n===3)return t}return null}function lt(t){var n=t.tag;if(n===5||n===26||n===27||n===6)return t.stateNode;throw Error(r(33))}function K(t){var n=t[Ho];return n||(n=t[Ho]={hoistableStyles:new Map,hoistableScripts:new Map}),n}function Mt(t){t[ka]=!0}var Nt=new Set,Gt={};function zt(t,n){Kt(t,n),Kt(t+"Capture",n)}function Kt(t,n){for(Gt[t]=n,t=0;t<n.length;t++)Nt.add(n[t])}var ee=RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"),Qt={},he={};function Ue(t){return Bt.call(he,t)?!0:Bt.call(Qt,t)?!1:ee.test(t)?he[t]=!0:(Qt[t]=!0,!1)}function Ve(t,n,a){if(Ue(n))if(a===null)t.removeAttribute(n);else{switch(typeof a){case"undefined":case"function":case"symbol":t.removeAttribute(n);return;case"boolean":var o=n.toLowerCase().slice(0,5);if(o!=="data-"&&o!=="aria-"){t.removeAttribute(n);return}}t.setAttribute(n,""+a)}}function Le(t,n,a){if(a===null)t.removeAttribute(n);else{switch(typeof a){case"undefined":case"function":case"symbol":case"boolean":t.removeAttribute(n);return}t.setAttribute(n,""+a)}}function me(t,n,a,o){if(o===null)t.removeAttribute(a);else{switch(typeof o){case"undefined":case"function":case"symbol":case"boolean":t.removeAttribute(a);return}t.setAttributeNS(n,a,""+o)}}function Vt(t){switch(typeof t){case"bigint":case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function Xe(t){var n=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(n==="checkbox"||n==="radio")}function Te(t,n,a){var o=Object.getOwnPropertyDescriptor(t.constructor.prototype,n);if(!t.hasOwnProperty(n)&&typeof o<"u"&&typeof o.get=="function"&&typeof o.set=="function"){var u=o.get,f=o.set;return Object.defineProperty(t,n,{configurable:!0,get:function(){return u.call(this)},set:function(x){a=""+x,f.call(this,x)}}),Object.defineProperty(t,n,{enumerable:o.enumerable}),{getValue:function(){return a},setValue:function(x){a=""+x},stopTracking:function(){t._valueTracker=null,delete t[n]}}}}function vn(t){if(!t._valueTracker){var n=Xe(t)?"checked":"value";t._valueTracker=Te(t,n,""+t[n])}}function Oi(t){if(!t)return!1;var n=t._valueTracker;if(!n)return!0;var a=n.getValue(),o="";return t&&(o=Xe(t)?t.checked?"true":"false":t.value),t=o,t!==a?(n.setValue(t),!0):!1}function pn(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}var Xa=/[\n"\\]/g;function ve(t){return t.replace(Xa,function(n){return"\\"+n.charCodeAt(0).toString(16)+" "})}function En(t,n,a,o,u,f,x,b){t.name="",x!=null&&typeof x!="function"&&typeof x!="symbol"&&typeof x!="boolean"?t.type=x:t.removeAttribute("type"),n!=null?x==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+Vt(n)):t.value!==""+Vt(n)&&(t.value=""+Vt(n)):x!=="submit"&&x!=="reset"||t.removeAttribute("value"),n!=null?un(t,x,Vt(n)):a!=null?un(t,x,Vt(a)):o!=null&&t.removeAttribute("value"),u==null&&f!=null&&(t.defaultChecked=!!f),u!=null&&(t.checked=u&&typeof u!="function"&&typeof u!="symbol"),b!=null&&typeof b!="function"&&typeof b!="symbol"&&typeof b!="boolean"?t.name=""+Vt(b):t.removeAttribute("name")}function Dn(t,n,a,o,u,f,x,b){if(f!=null&&typeof f!="function"&&typeof f!="symbol"&&typeof f!="boolean"&&(t.type=f),n!=null||a!=null){if(!(f!=="submit"&&f!=="reset"||n!=null)){vn(t);return}a=a!=null?""+Vt(a):"",n=n!=null?""+Vt(n):a,b||n===t.value||(t.value=n),t.defaultValue=n}o=o??u,o=typeof o!="function"&&typeof o!="symbol"&&!!o,t.checked=b?t.checked:!!o,t.defaultChecked=!!o,x!=null&&typeof x!="function"&&typeof x!="symbol"&&typeof x!="boolean"&&(t.name=x),vn(t)}function un(t,n,a){n==="number"&&pn(t.ownerDocument)===t||t.defaultValue===""+a||(t.defaultValue=""+a)}function tn(t,n,a,o){if(t=t.options,n){n={};for(var u=0;u<a.length;u++)n["$"+a[u]]=!0;for(a=0;a<t.length;a++)u=n.hasOwnProperty("$"+t[a].value),t[a].selected!==u&&(t[a].selected=u),u&&o&&(t[a].defaultSelected=!0)}else{for(a=""+Vt(a),n=null,u=0;u<t.length;u++){if(t[u].value===a){t[u].selected=!0,o&&(t[u].defaultSelected=!0);return}n!==null||t[u].disabled||(n=t[u])}n!==null&&(n.selected=!0)}}function Ar(t,n,a){if(n!=null&&(n=""+Vt(n),n!==t.value&&(t.value=n),a==null)){t.defaultValue!==n&&(t.defaultValue=n);return}t.defaultValue=a!=null?""+Vt(a):""}function Ei(t,n,a,o){if(n==null){if(o!=null){if(a!=null)throw Error(r(92));if(ct(o)){if(1<o.length)throw Error(r(93));o=o[0]}a=o}a==null&&(a=""),n=a}a=Vt(n),t.defaultValue=a,o=t.textContent,o===a&&o!==""&&o!==null&&(t.value=o),vn(t)}function Rr(t,n){if(n){var a=t.firstChild;if(a&&a===t.lastChild&&a.nodeType===3){a.nodeValue=n;return}}t.textContent=n}var mv=new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));function Nh(t,n,a){var o=n.indexOf("--")===0;a==null||typeof a=="boolean"||a===""?o?t.setProperty(n,""):n==="float"?t.cssFloat="":t[n]="":o?t.setProperty(n,a):typeof a!="number"||a===0||mv.has(n)?n==="float"?t.cssFloat=a:t[n]=(""+a).trim():t[n]=a+"px"}function Oh(t,n,a){if(n!=null&&typeof n!="object")throw Error(r(62));if(t=t.style,a!=null){for(var o in a)!a.hasOwnProperty(o)||n!=null&&n.hasOwnProperty(o)||(o.indexOf("--")===0?t.setProperty(o,""):o==="float"?t.cssFloat="":t[o]="");for(var u in n)o=n[u],n.hasOwnProperty(u)&&a[u]!==o&&Nh(t,u,o)}else for(var f in n)n.hasOwnProperty(f)&&Nh(t,f,n[f])}function Pc(t){if(t.indexOf("-")===-1)return!1;switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var gv=new Map([["acceptCharset","accept-charset"],["htmlFor","for"],["httpEquiv","http-equiv"],["crossOrigin","crossorigin"],["accentHeight","accent-height"],["alignmentBaseline","alignment-baseline"],["arabicForm","arabic-form"],["baselineShift","baseline-shift"],["capHeight","cap-height"],["clipPath","clip-path"],["clipRule","clip-rule"],["colorInterpolation","color-interpolation"],["colorInterpolationFilters","color-interpolation-filters"],["colorProfile","color-profile"],["colorRendering","color-rendering"],["dominantBaseline","dominant-baseline"],["enableBackground","enable-background"],["fillOpacity","fill-opacity"],["fillRule","fill-rule"],["floodColor","flood-color"],["floodOpacity","flood-opacity"],["fontFamily","font-family"],["fontSize","font-size"],["fontSizeAdjust","font-size-adjust"],["fontStretch","font-stretch"],["fontStyle","font-style"],["fontVariant","font-variant"],["fontWeight","font-weight"],["glyphName","glyph-name"],["glyphOrientationHorizontal","glyph-orientation-horizontal"],["glyphOrientationVertical","glyph-orientation-vertical"],["horizAdvX","horiz-adv-x"],["horizOriginX","horiz-origin-x"],["imageRendering","image-rendering"],["letterSpacing","letter-spacing"],["lightingColor","lighting-color"],["markerEnd","marker-end"],["markerMid","marker-mid"],["markerStart","marker-start"],["overlinePosition","overline-position"],["overlineThickness","overline-thickness"],["paintOrder","paint-order"],["panose-1","panose-1"],["pointerEvents","pointer-events"],["renderingIntent","rendering-intent"],["shapeRendering","shape-rendering"],["stopColor","stop-color"],["stopOpacity","stop-opacity"],["strikethroughPosition","strikethrough-position"],["strikethroughThickness","strikethrough-thickness"],["strokeDasharray","stroke-dasharray"],["strokeDashoffset","stroke-dashoffset"],["strokeLinecap","stroke-linecap"],["strokeLinejoin","stroke-linejoin"],["strokeMiterlimit","stroke-miterlimit"],["strokeOpacity","stroke-opacity"],["strokeWidth","stroke-width"],["textAnchor","text-anchor"],["textDecoration","text-decoration"],["textRendering","text-rendering"],["transformOrigin","transform-origin"],["underlinePosition","underline-position"],["underlineThickness","underline-thickness"],["unicodeBidi","unicode-bidi"],["unicodeRange","unicode-range"],["unitsPerEm","units-per-em"],["vAlphabetic","v-alphabetic"],["vHanging","v-hanging"],["vIdeographic","v-ideographic"],["vMathematical","v-mathematical"],["vectorEffect","vector-effect"],["vertAdvY","vert-adv-y"],["vertOriginX","vert-origin-x"],["vertOriginY","vert-origin-y"],["wordSpacing","word-spacing"],["writingMode","writing-mode"],["xmlnsXlink","xmlns:xlink"],["xHeight","x-height"]]),_v=/^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;function Go(t){return _v.test(""+t)?"javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')":t}function zi(){}var Bc=null;function Fc(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Cr=null,wr=null;function zh(t){var n=ot(t);if(n&&(t=n.stateNode)){var a=t[_n]||null;t:switch(t=n.stateNode,n.type){case"input":if(En(t,a.value,a.defaultValue,a.defaultValue,a.checked,a.defaultChecked,a.type,a.name),n=a.name,a.type==="radio"&&n!=null){for(a=t;a.parentNode;)a=a.parentNode;for(a=a.querySelectorAll('input[name="'+ve(""+n)+'"][type="radio"]'),n=0;n<a.length;n++){var o=a[n];if(o!==t&&o.form===t.form){var u=o[_n]||null;if(!u)throw Error(r(90));En(o,u.value,u.defaultValue,u.defaultValue,u.checked,u.defaultChecked,u.type,u.name)}}for(n=0;n<a.length;n++)o=a[n],o.form===t.form&&Oi(o)}break t;case"textarea":Ar(t,a.value,a.defaultValue);break t;case"select":n=a.value,n!=null&&tn(t,!!a.multiple,n,!1)}}}var Ic=!1;function Ph(t,n,a){if(Ic)return t(n,a);Ic=!0;try{var o=t(n);return o}finally{if(Ic=!1,(Cr!==null||wr!==null)&&(Cl(),Cr&&(n=Cr,t=wr,wr=Cr=null,zh(n),t)))for(n=0;n<t.length;n++)zh(t[n])}}function zs(t,n){var a=t.stateNode;if(a===null)return null;var o=a[_n]||null;if(o===null)return null;a=o[n];t:switch(n){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(o=!o.disabled)||(t=t.type,o=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!o;break t;default:t=!1}if(t)return null;if(a&&typeof a!="function")throw Error(r(231,n,typeof a));return a}var Pi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Hc=!1;if(Pi)try{var Ps={};Object.defineProperty(Ps,"passive",{get:function(){Hc=!0}}),window.addEventListener("test",Ps,Ps),window.removeEventListener("test",Ps,Ps)}catch{Hc=!1}var la=null,Gc=null,Vo=null;function Bh(){if(Vo)return Vo;var t,n=Gc,a=n.length,o,u="value"in la?la.value:la.textContent,f=u.length;for(t=0;t<a&&n[t]===u[t];t++);var x=a-t;for(o=1;o<=x&&n[a-o]===u[f-o];o++);return Vo=u.slice(t,1<o?1-o:void 0)}function ko(t){var n=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&n===13&&(t=13)):t=n,t===10&&(t=13),32<=t||t===13?t:0}function Xo(){return!0}function Fh(){return!1}function On(t){function n(a,o,u,f,x){this._reactName=a,this._targetInst=u,this.type=o,this.nativeEvent=f,this.target=x,this.currentTarget=null;for(var b in t)t.hasOwnProperty(b)&&(a=t[b],this[b]=a?a(f):f[b]);return this.isDefaultPrevented=(f.defaultPrevented!=null?f.defaultPrevented:f.returnValue===!1)?Xo:Fh,this.isPropagationStopped=Fh,this}return g(n.prototype,{preventDefault:function(){this.defaultPrevented=!0;var a=this.nativeEvent;a&&(a.preventDefault?a.preventDefault():typeof a.returnValue!="unknown"&&(a.returnValue=!1),this.isDefaultPrevented=Xo)},stopPropagation:function(){var a=this.nativeEvent;a&&(a.stopPropagation?a.stopPropagation():typeof a.cancelBubble!="unknown"&&(a.cancelBubble=!0),this.isPropagationStopped=Xo)},persist:function(){},isPersistent:Xo}),n}var Wa={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Wo=On(Wa),Bs=g({},Wa,{view:0,detail:0}),vv=On(Bs),Vc,kc,Fs,qo=g({},Bs,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Wc,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Fs&&(Fs&&t.type==="mousemove"?(Vc=t.screenX-Fs.screenX,kc=t.screenY-Fs.screenY):kc=Vc=0,Fs=t),Vc)},movementY:function(t){return"movementY"in t?t.movementY:kc}}),Ih=On(qo),xv=g({},qo,{dataTransfer:0}),Sv=On(xv),yv=g({},Bs,{relatedTarget:0}),Xc=On(yv),Mv=g({},Wa,{animationName:0,elapsedTime:0,pseudoElement:0}),Ev=On(Mv),Tv=g({},Wa,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),bv=On(Tv),Av=g({},Wa,{data:0}),Hh=On(Av),Rv={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},Cv={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},wv={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function Dv(t){var n=this.nativeEvent;return n.getModifierState?n.getModifierState(t):(t=wv[t])?!!n[t]:!1}function Wc(){return Dv}var Uv=g({},Bs,{key:function(t){if(t.key){var n=Rv[t.key]||t.key;if(n!=="Unidentified")return n}return t.type==="keypress"?(t=ko(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?Cv[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Wc,charCode:function(t){return t.type==="keypress"?ko(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?ko(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),Lv=On(Uv),Nv=g({},qo,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),Gh=On(Nv),Ov=g({},Bs,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Wc}),zv=On(Ov),Pv=g({},Wa,{propertyName:0,elapsedTime:0,pseudoElement:0}),Bv=On(Pv),Fv=g({},qo,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),Iv=On(Fv),Hv=g({},Wa,{newState:0,oldState:0}),Gv=On(Hv),Vv=[9,13,27,32],qc=Pi&&"CompositionEvent"in window,Is=null;Pi&&"documentMode"in document&&(Is=document.documentMode);var kv=Pi&&"TextEvent"in window&&!Is,Vh=Pi&&(!qc||Is&&8<Is&&11>=Is),kh=" ",Xh=!1;function Wh(t,n){switch(t){case"keyup":return Vv.indexOf(n.keyCode)!==-1;case"keydown":return n.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function qh(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var Dr=!1;function Xv(t,n){switch(t){case"compositionend":return qh(n);case"keypress":return n.which!==32?null:(Xh=!0,kh);case"textInput":return t=n.data,t===kh&&Xh?null:t;default:return null}}function Wv(t,n){if(Dr)return t==="compositionend"||!qc&&Wh(t,n)?(t=Bh(),Vo=Gc=la=null,Dr=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(n.ctrlKey||n.altKey||n.metaKey)||n.ctrlKey&&n.altKey){if(n.char&&1<n.char.length)return n.char;if(n.which)return String.fromCharCode(n.which)}return null;case"compositionend":return Vh&&n.locale!=="ko"?null:n.data;default:return null}}var qv={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function Yh(t){var n=t&&t.nodeName&&t.nodeName.toLowerCase();return n==="input"?!!qv[t.type]:n==="textarea"}function Zh(t,n,a,o){Cr?wr?wr.push(o):wr=[o]:Cr=o,n=zl(n,"onChange"),0<n.length&&(a=new Wo("onChange","change",null,a,o),t.push({event:a,listeners:n}))}var Hs=null,Gs=null;function Yv(t){Dg(t,0)}function Yo(t){var n=lt(t);if(Oi(n))return t}function jh(t,n){if(t==="change")return n}var Kh=!1;if(Pi){var Yc;if(Pi){var Zc="oninput"in document;if(!Zc){var Qh=document.createElement("div");Qh.setAttribute("oninput","return;"),Zc=typeof Qh.oninput=="function"}Yc=Zc}else Yc=!1;Kh=Yc&&(!document.documentMode||9<document.documentMode)}function Jh(){Hs&&(Hs.detachEvent("onpropertychange",$h),Gs=Hs=null)}function $h(t){if(t.propertyName==="value"&&Yo(Gs)){var n=[];Zh(n,Gs,t,Fc(t)),Ph(Yv,n)}}function Zv(t,n,a){t==="focusin"?(Jh(),Hs=n,Gs=a,Hs.attachEvent("onpropertychange",$h)):t==="focusout"&&Jh()}function jv(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return Yo(Gs)}function Kv(t,n){if(t==="click")return Yo(n)}function Qv(t,n){if(t==="input"||t==="change")return Yo(n)}function Jv(t,n){return t===n&&(t!==0||1/t===1/n)||t!==t&&n!==n}var Xn=typeof Object.is=="function"?Object.is:Jv;function Vs(t,n){if(Xn(t,n))return!0;if(typeof t!="object"||t===null||typeof n!="object"||n===null)return!1;var a=Object.keys(t),o=Object.keys(n);if(a.length!==o.length)return!1;for(o=0;o<a.length;o++){var u=a[o];if(!Bt.call(n,u)||!Xn(t[u],n[u]))return!1}return!0}function tp(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function ep(t,n){var a=tp(t);t=0;for(var o;a;){if(a.nodeType===3){if(o=t+a.textContent.length,t<=n&&o>=n)return{node:a,offset:n-t};t=o}t:{for(;a;){if(a.nextSibling){a=a.nextSibling;break t}a=a.parentNode}a=void 0}a=tp(a)}}function np(t,n){return t&&n?t===n?!0:t&&t.nodeType===3?!1:n&&n.nodeType===3?np(t,n.parentNode):"contains"in t?t.contains(n):t.compareDocumentPosition?!!(t.compareDocumentPosition(n)&16):!1:!1}function ip(t){t=t!=null&&t.ownerDocument!=null&&t.ownerDocument.defaultView!=null?t.ownerDocument.defaultView:window;for(var n=pn(t.document);n instanceof t.HTMLIFrameElement;){try{var a=typeof n.contentWindow.location.href=="string"}catch{a=!1}if(a)t=n.contentWindow;else break;n=pn(t.document)}return n}function jc(t){var n=t&&t.nodeName&&t.nodeName.toLowerCase();return n&&(n==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||n==="textarea"||t.contentEditable==="true")}var $v=Pi&&"documentMode"in document&&11>=document.documentMode,Ur=null,Kc=null,ks=null,Qc=!1;function ap(t,n,a){var o=a.window===a?a.document:a.nodeType===9?a:a.ownerDocument;Qc||Ur==null||Ur!==pn(o)||(o=Ur,"selectionStart"in o&&jc(o)?o={start:o.selectionStart,end:o.selectionEnd}:(o=(o.ownerDocument&&o.ownerDocument.defaultView||window).getSelection(),o={anchorNode:o.anchorNode,anchorOffset:o.anchorOffset,focusNode:o.focusNode,focusOffset:o.focusOffset}),ks&&Vs(ks,o)||(ks=o,o=zl(Kc,"onSelect"),0<o.length&&(n=new Wo("onSelect","select",null,n,a),t.push({event:n,listeners:o}),n.target=Ur)))}function qa(t,n){var a={};return a[t.toLowerCase()]=n.toLowerCase(),a["Webkit"+t]="webkit"+n,a["Moz"+t]="moz"+n,a}var Lr={animationend:qa("Animation","AnimationEnd"),animationiteration:qa("Animation","AnimationIteration"),animationstart:qa("Animation","AnimationStart"),transitionrun:qa("Transition","TransitionRun"),transitionstart:qa("Transition","TransitionStart"),transitioncancel:qa("Transition","TransitionCancel"),transitionend:qa("Transition","TransitionEnd")},Jc={},rp={};Pi&&(rp=document.createElement("div").style,"AnimationEvent"in window||(delete Lr.animationend.animation,delete Lr.animationiteration.animation,delete Lr.animationstart.animation),"TransitionEvent"in window||delete Lr.transitionend.transition);function Ya(t){if(Jc[t])return Jc[t];if(!Lr[t])return t;var n=Lr[t],a;for(a in n)if(n.hasOwnProperty(a)&&a in rp)return Jc[t]=n[a];return t}var sp=Ya("animationend"),op=Ya("animationiteration"),lp=Ya("animationstart"),tx=Ya("transitionrun"),ex=Ya("transitionstart"),nx=Ya("transitioncancel"),cp=Ya("transitionend"),up=new Map,$c="abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");$c.push("scrollEnd");function di(t,n){up.set(t,n),zt(n,[t])}var Zo=typeof reportError=="function"?reportError:function(t){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var n=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof t=="object"&&t!==null&&typeof t.message=="string"?String(t.message):String(t),error:t});if(!window.dispatchEvent(n))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",t);return}console.error(t)},ei=[],Nr=0,tu=0;function jo(){for(var t=Nr,n=tu=Nr=0;n<t;){var a=ei[n];ei[n++]=null;var o=ei[n];ei[n++]=null;var u=ei[n];ei[n++]=null;var f=ei[n];if(ei[n++]=null,o!==null&&u!==null){var x=o.pending;x===null?u.next=u:(u.next=x.next,x.next=u),o.pending=u}f!==0&&fp(a,u,f)}}function Ko(t,n,a,o){ei[Nr++]=t,ei[Nr++]=n,ei[Nr++]=a,ei[Nr++]=o,tu|=o,t.lanes|=o,t=t.alternate,t!==null&&(t.lanes|=o)}function eu(t,n,a,o){return Ko(t,n,a,o),Qo(t)}function Za(t,n){return Ko(t,null,null,n),Qo(t)}function fp(t,n,a){t.lanes|=a;var o=t.alternate;o!==null&&(o.lanes|=a);for(var u=!1,f=t.return;f!==null;)f.childLanes|=a,o=f.alternate,o!==null&&(o.childLanes|=a),f.tag===22&&(t=f.stateNode,t===null||t._visibility&1||(u=!0)),t=f,f=f.return;return t.tag===3?(f=t.stateNode,u&&n!==null&&(u=31-Pt(a),t=f.hiddenUpdates,o=t[u],o===null?t[u]=[n]:o.push(n),n.lane=a|536870912),f):null}function Qo(t){if(50<fo)throw fo=0,ff=null,Error(r(185));for(var n=t.return;n!==null;)t=n,n=t.return;return t.tag===3?t.stateNode:null}var Or={};function ix(t,n,a,o){this.tag=t,this.key=a,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.refCleanup=this.ref=null,this.pendingProps=n,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=o,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Wn(t,n,a,o){return new ix(t,n,a,o)}function nu(t){return t=t.prototype,!(!t||!t.isReactComponent)}function Bi(t,n){var a=t.alternate;return a===null?(a=Wn(t.tag,n,t.key,t.mode),a.elementType=t.elementType,a.type=t.type,a.stateNode=t.stateNode,a.alternate=t,t.alternate=a):(a.pendingProps=n,a.type=t.type,a.flags=0,a.subtreeFlags=0,a.deletions=null),a.flags=t.flags&65011712,a.childLanes=t.childLanes,a.lanes=t.lanes,a.child=t.child,a.memoizedProps=t.memoizedProps,a.memoizedState=t.memoizedState,a.updateQueue=t.updateQueue,n=t.dependencies,a.dependencies=n===null?null:{lanes:n.lanes,firstContext:n.firstContext},a.sibling=t.sibling,a.index=t.index,a.ref=t.ref,a.refCleanup=t.refCleanup,a}function dp(t,n){t.flags&=65011714;var a=t.alternate;return a===null?(t.childLanes=0,t.lanes=n,t.child=null,t.subtreeFlags=0,t.memoizedProps=null,t.memoizedState=null,t.updateQueue=null,t.dependencies=null,t.stateNode=null):(t.childLanes=a.childLanes,t.lanes=a.lanes,t.child=a.child,t.subtreeFlags=0,t.deletions=null,t.memoizedProps=a.memoizedProps,t.memoizedState=a.memoizedState,t.updateQueue=a.updateQueue,t.type=a.type,n=a.dependencies,t.dependencies=n===null?null:{lanes:n.lanes,firstContext:n.firstContext}),t}function Jo(t,n,a,o,u,f){var x=0;if(o=t,typeof t=="function")nu(t)&&(x=1);else if(typeof t=="string")x=lS(t,a,pt.current)?26:t==="html"||t==="head"||t==="body"?27:5;else t:switch(t){case A:return t=Wn(31,a,n,u),t.elementType=A,t.lanes=f,t;case R:return ja(a.children,u,f,n);case y:x=8,u|=24;break;case _:return t=Wn(12,a,n,u|2),t.elementType=_,t.lanes=f,t;case H:return t=Wn(13,a,n,u),t.elementType=H,t.lanes=f,t;case L:return t=Wn(19,a,n,u),t.elementType=L,t.lanes=f,t;default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case z:x=10;break t;case I:x=9;break t;case D:x=11;break t;case U:x=14;break t;case V:x=16,o=null;break t}x=29,a=Error(r(130,t===null?"null":typeof t,"")),o=null}return n=Wn(x,a,n,u),n.elementType=t,n.type=o,n.lanes=f,n}function ja(t,n,a,o){return t=Wn(7,t,o,n),t.lanes=a,t}function iu(t,n,a){return t=Wn(6,t,null,n),t.lanes=a,t}function hp(t){var n=Wn(18,null,null,0);return n.stateNode=t,n}function au(t,n,a){return n=Wn(4,t.children!==null?t.children:[],t.key,n),n.lanes=a,n.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},n}var pp=new WeakMap;function ni(t,n){if(typeof t=="object"&&t!==null){var a=pp.get(t);return a!==void 0?a:(n={value:t,source:n,stack:Ne(n)},pp.set(t,n),n)}return{value:t,source:n,stack:Ne(n)}}var zr=[],Pr=0,$o=null,Xs=0,ii=[],ai=0,ca=null,Ti=1,bi="";function Fi(t,n){zr[Pr++]=Xs,zr[Pr++]=$o,$o=t,Xs=n}function mp(t,n,a){ii[ai++]=Ti,ii[ai++]=bi,ii[ai++]=ca,ca=t;var o=Ti;t=bi;var u=32-Pt(o)-1;o&=~(1<<u),a+=1;var f=32-Pt(n)+u;if(30<f){var x=u-u%5;f=(o&(1<<x)-1).toString(32),o>>=x,u-=x,Ti=1<<32-Pt(n)+u|a<<u|o,bi=f+t}else Ti=1<<f|a<<u|o,bi=t}function ru(t){t.return!==null&&(Fi(t,1),mp(t,1,0))}function su(t){for(;t===$o;)$o=zr[--Pr],zr[Pr]=null,Xs=zr[--Pr],zr[Pr]=null;for(;t===ca;)ca=ii[--ai],ii[ai]=null,bi=ii[--ai],ii[ai]=null,Ti=ii[--ai],ii[ai]=null}function gp(t,n){ii[ai++]=Ti,ii[ai++]=bi,ii[ai++]=ca,Ti=n.id,bi=n.overflow,ca=t}var xn=null,qe=null,Me=!1,ua=null,ri=!1,ou=Error(r(519));function fa(t){var n=Error(r(418,1<arguments.length&&arguments[1]!==void 0&&arguments[1]?"text":"HTML",""));throw Ws(ni(n,t)),ou}function _p(t){var n=t.stateNode,a=t.type,o=t.memoizedProps;switch(n[an]=t,n[_n]=o,a){case"dialog":_e("cancel",n),_e("close",n);break;case"iframe":case"object":case"embed":_e("load",n);break;case"video":case"audio":for(a=0;a<po.length;a++)_e(po[a],n);break;case"source":_e("error",n);break;case"img":case"image":case"link":_e("error",n),_e("load",n);break;case"details":_e("toggle",n);break;case"input":_e("invalid",n),Dn(n,o.value,o.defaultValue,o.checked,o.defaultChecked,o.type,o.name,!0);break;case"select":_e("invalid",n);break;case"textarea":_e("invalid",n),Ei(n,o.value,o.defaultValue,o.children)}a=o.children,typeof a!="string"&&typeof a!="number"&&typeof a!="bigint"||n.textContent===""+a||o.suppressHydrationWarning===!0||Og(n.textContent,a)?(o.popover!=null&&(_e("beforetoggle",n),_e("toggle",n)),o.onScroll!=null&&_e("scroll",n),o.onScrollEnd!=null&&_e("scrollend",n),o.onClick!=null&&(n.onclick=zi),n=!0):n=!1,n||fa(t,!0)}function vp(t){for(xn=t.return;xn;)switch(xn.tag){case 5:case 31:case 13:ri=!1;return;case 27:case 3:ri=!0;return;default:xn=xn.return}}function Br(t){if(t!==xn)return!1;if(!Me)return vp(t),Me=!0,!1;var n=t.tag,a;if((a=n!==3&&n!==27)&&((a=n===5)&&(a=t.type,a=!(a!=="form"&&a!=="button")||Af(t.type,t.memoizedProps)),a=!a),a&&qe&&fa(t),vp(t),n===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(r(317));qe=kg(t)}else if(n===31){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(r(317));qe=kg(t)}else n===27?(n=qe,ba(t.type)?(t=Uf,Uf=null,qe=t):qe=n):qe=xn?oi(t.stateNode.nextSibling):null;return!0}function Ka(){qe=xn=null,Me=!1}function lu(){var t=ua;return t!==null&&(Fn===null?Fn=t:Fn.push.apply(Fn,t),ua=null),t}function Ws(t){ua===null?ua=[t]:ua.push(t)}var cu=P(null),Qa=null,Ii=null;function da(t,n,a){X(cu,n._currentValue),n._currentValue=a}function Hi(t){t._currentValue=cu.current,et(cu)}function uu(t,n,a){for(;t!==null;){var o=t.alternate;if((t.childLanes&n)!==n?(t.childLanes|=n,o!==null&&(o.childLanes|=n)):o!==null&&(o.childLanes&n)!==n&&(o.childLanes|=n),t===a)break;t=t.return}}function fu(t,n,a,o){var u=t.child;for(u!==null&&(u.return=t);u!==null;){var f=u.dependencies;if(f!==null){var x=u.child;f=f.firstContext;t:for(;f!==null;){var b=f;f=u;for(var F=0;F<n.length;F++)if(b.context===n[F]){f.lanes|=a,b=f.alternate,b!==null&&(b.lanes|=a),uu(f.return,a,t),o||(x=null);break t}f=b.next}}else if(u.tag===18){if(x=u.return,x===null)throw Error(r(341));x.lanes|=a,f=x.alternate,f!==null&&(f.lanes|=a),uu(x,a,t),x=null}else x=u.child;if(x!==null)x.return=u;else for(x=u;x!==null;){if(x===t){x=null;break}if(u=x.sibling,u!==null){u.return=x.return,x=u;break}x=x.return}u=x}}function Fr(t,n,a,o){t=null;for(var u=n,f=!1;u!==null;){if(!f){if((u.flags&524288)!==0)f=!0;else if((u.flags&262144)!==0)break}if(u.tag===10){var x=u.alternate;if(x===null)throw Error(r(387));if(x=x.memoizedProps,x!==null){var b=u.type;Xn(u.pendingProps.value,x.value)||(t!==null?t.push(b):t=[b])}}else if(u===ft.current){if(x=u.alternate,x===null)throw Error(r(387));x.memoizedState.memoizedState!==u.memoizedState.memoizedState&&(t!==null?t.push(xo):t=[xo])}u=u.return}t!==null&&fu(n,t,a,o),n.flags|=262144}function tl(t){for(t=t.firstContext;t!==null;){if(!Xn(t.context._currentValue,t.memoizedValue))return!0;t=t.next}return!1}function Ja(t){Qa=t,Ii=null,t=t.dependencies,t!==null&&(t.firstContext=null)}function Sn(t){return xp(Qa,t)}function el(t,n){return Qa===null&&Ja(t),xp(t,n)}function xp(t,n){var a=n._currentValue;if(n={context:n,memoizedValue:a,next:null},Ii===null){if(t===null)throw Error(r(308));Ii=n,t.dependencies={lanes:0,firstContext:n},t.flags|=524288}else Ii=Ii.next=n;return a}var ax=typeof AbortController<"u"?AbortController:function(){var t=[],n=this.signal={aborted:!1,addEventListener:function(a,o){t.push(o)}};this.abort=function(){n.aborted=!0,t.forEach(function(a){return a()})}},rx=s.unstable_scheduleCallback,sx=s.unstable_NormalPriority,rn={$$typeof:z,Consumer:null,Provider:null,_currentValue:null,_currentValue2:null,_threadCount:0};function du(){return{controller:new ax,data:new Map,refCount:0}}function qs(t){t.refCount--,t.refCount===0&&rx(sx,function(){t.controller.abort()})}var Ys=null,hu=0,Ir=0,Hr=null;function ox(t,n){if(Ys===null){var a=Ys=[];hu=0,Ir=_f(),Hr={status:"pending",value:void 0,then:function(o){a.push(o)}}}return hu++,n.then(Sp,Sp),n}function Sp(){if(--hu===0&&Ys!==null){Hr!==null&&(Hr.status="fulfilled");var t=Ys;Ys=null,Ir=0,Hr=null;for(var n=0;n<t.length;n++)(0,t[n])()}}function lx(t,n){var a=[],o={status:"pending",value:null,reason:null,then:function(u){a.push(u)}};return t.then(function(){o.status="fulfilled",o.value=n;for(var u=0;u<a.length;u++)(0,a[u])(n)},function(u){for(o.status="rejected",o.reason=u,u=0;u<a.length;u++)(0,a[u])(void 0)}),o}var yp=B.S;B.S=function(t,n){ag=E(),typeof n=="object"&&n!==null&&typeof n.then=="function"&&ox(t,n),yp!==null&&yp(t,n)};var $a=P(null);function pu(){var t=$a.current;return t!==null?t:ke.pooledCache}function nl(t,n){n===null?X($a,$a.current):X($a,n.pool)}function Mp(){var t=pu();return t===null?null:{parent:rn._currentValue,pool:t}}var Gr=Error(r(460)),mu=Error(r(474)),il=Error(r(542)),al={then:function(){}};function Ep(t){return t=t.status,t==="fulfilled"||t==="rejected"}function Tp(t,n,a){switch(a=t[a],a===void 0?t.push(n):a!==n&&(n.then(zi,zi),n=a),n.status){case"fulfilled":return n.value;case"rejected":throw t=n.reason,Ap(t),t;default:if(typeof n.status=="string")n.then(zi,zi);else{if(t=ke,t!==null&&100<t.shellSuspendCounter)throw Error(r(482));t=n,t.status="pending",t.then(function(o){if(n.status==="pending"){var u=n;u.status="fulfilled",u.value=o}},function(o){if(n.status==="pending"){var u=n;u.status="rejected",u.reason=o}})}switch(n.status){case"fulfilled":return n.value;case"rejected":throw t=n.reason,Ap(t),t}throw er=n,Gr}}function tr(t){try{var n=t._init;return n(t._payload)}catch(a){throw a!==null&&typeof a=="object"&&typeof a.then=="function"?(er=a,Gr):a}}var er=null;function bp(){if(er===null)throw Error(r(459));var t=er;return er=null,t}function Ap(t){if(t===Gr||t===il)throw Error(r(483))}var Vr=null,Zs=0;function rl(t){var n=Zs;return Zs+=1,Vr===null&&(Vr=[]),Tp(Vr,t,n)}function js(t,n){n=n.props.ref,t.ref=n!==void 0?n:null}function sl(t,n){throw n.$$typeof===S?Error(r(525)):(t=Object.prototype.toString.call(n),Error(r(31,t==="[object Object]"?"object with keys {"+Object.keys(n).join(", ")+"}":t)))}function Rp(t){function n(Q,k){if(t){var nt=Q.deletions;nt===null?(Q.deletions=[k],Q.flags|=16):nt.push(k)}}function a(Q,k){if(!t)return null;for(;k!==null;)n(Q,k),k=k.sibling;return null}function o(Q){for(var k=new Map;Q!==null;)Q.key!==null?k.set(Q.key,Q):k.set(Q.index,Q),Q=Q.sibling;return k}function u(Q,k){return Q=Bi(Q,k),Q.index=0,Q.sibling=null,Q}function f(Q,k,nt){return Q.index=nt,t?(nt=Q.alternate,nt!==null?(nt=nt.index,nt<k?(Q.flags|=67108866,k):nt):(Q.flags|=67108866,k)):(Q.flags|=1048576,k)}function x(Q){return t&&Q.alternate===null&&(Q.flags|=67108866),Q}function b(Q,k,nt,_t){return k===null||k.tag!==6?(k=iu(nt,Q.mode,_t),k.return=Q,k):(k=u(k,nt),k.return=Q,k)}function F(Q,k,nt,_t){var Jt=nt.type;return Jt===R?ht(Q,k,nt.props.children,_t,nt.key):k!==null&&(k.elementType===Jt||typeof Jt=="object"&&Jt!==null&&Jt.$$typeof===V&&tr(Jt)===k.type)?(k=u(k,nt.props),js(k,nt),k.return=Q,k):(k=Jo(nt.type,nt.key,nt.props,null,Q.mode,_t),js(k,nt),k.return=Q,k)}function it(Q,k,nt,_t){return k===null||k.tag!==4||k.stateNode.containerInfo!==nt.containerInfo||k.stateNode.implementation!==nt.implementation?(k=au(nt,Q.mode,_t),k.return=Q,k):(k=u(k,nt.children||[]),k.return=Q,k)}function ht(Q,k,nt,_t,Jt){return k===null||k.tag!==7?(k=ja(nt,Q.mode,_t,Jt),k.return=Q,k):(k=u(k,nt),k.return=Q,k)}function vt(Q,k,nt){if(typeof k=="string"&&k!==""||typeof k=="number"||typeof k=="bigint")return k=iu(""+k,Q.mode,nt),k.return=Q,k;if(typeof k=="object"&&k!==null){switch(k.$$typeof){case M:return nt=Jo(k.type,k.key,k.props,null,Q.mode,nt),js(nt,k),nt.return=Q,nt;case T:return k=au(k,Q.mode,nt),k.return=Q,k;case V:return k=tr(k),vt(Q,k,nt)}if(ct(k)||J(k))return k=ja(k,Q.mode,nt,null),k.return=Q,k;if(typeof k.then=="function")return vt(Q,rl(k),nt);if(k.$$typeof===z)return vt(Q,el(Q,k),nt);sl(Q,k)}return null}function st(Q,k,nt,_t){var Jt=k!==null?k.key:null;if(typeof nt=="string"&&nt!==""||typeof nt=="number"||typeof nt=="bigint")return Jt!==null?null:b(Q,k,""+nt,_t);if(typeof nt=="object"&&nt!==null){switch(nt.$$typeof){case M:return nt.key===Jt?F(Q,k,nt,_t):null;case T:return nt.key===Jt?it(Q,k,nt,_t):null;case V:return nt=tr(nt),st(Q,k,nt,_t)}if(ct(nt)||J(nt))return Jt!==null?null:ht(Q,k,nt,_t,null);if(typeof nt.then=="function")return st(Q,k,rl(nt),_t);if(nt.$$typeof===z)return st(Q,k,el(Q,nt),_t);sl(Q,nt)}return null}function ut(Q,k,nt,_t,Jt){if(typeof _t=="string"&&_t!==""||typeof _t=="number"||typeof _t=="bigint")return Q=Q.get(nt)||null,b(k,Q,""+_t,Jt);if(typeof _t=="object"&&_t!==null){switch(_t.$$typeof){case M:return Q=Q.get(_t.key===null?nt:_t.key)||null,F(k,Q,_t,Jt);case T:return Q=Q.get(_t.key===null?nt:_t.key)||null,it(k,Q,_t,Jt);case V:return _t=tr(_t),ut(Q,k,nt,_t,Jt)}if(ct(_t)||J(_t))return Q=Q.get(nt)||null,ht(k,Q,_t,Jt,null);if(typeof _t.then=="function")return ut(Q,k,nt,rl(_t),Jt);if(_t.$$typeof===z)return ut(Q,k,nt,el(k,_t),Jt);sl(k,_t)}return null}function Ht(Q,k,nt,_t){for(var Jt=null,Re=null,kt=k,le=k=0,Se=null;kt!==null&&le<nt.length;le++){kt.index>le?(Se=kt,kt=null):Se=kt.sibling;var Ce=st(Q,kt,nt[le],_t);if(Ce===null){kt===null&&(kt=Se);break}t&&kt&&Ce.alternate===null&&n(Q,kt),k=f(Ce,k,le),Re===null?Jt=Ce:Re.sibling=Ce,Re=Ce,kt=Se}if(le===nt.length)return a(Q,kt),Me&&Fi(Q,le),Jt;if(kt===null){for(;le<nt.length;le++)kt=vt(Q,nt[le],_t),kt!==null&&(k=f(kt,k,le),Re===null?Jt=kt:Re.sibling=kt,Re=kt);return Me&&Fi(Q,le),Jt}for(kt=o(kt);le<nt.length;le++)Se=ut(kt,Q,le,nt[le],_t),Se!==null&&(t&&Se.alternate!==null&&kt.delete(Se.key===null?le:Se.key),k=f(Se,k,le),Re===null?Jt=Se:Re.sibling=Se,Re=Se);return t&&kt.forEach(function(Da){return n(Q,Da)}),Me&&Fi(Q,le),Jt}function te(Q,k,nt,_t){if(nt==null)throw Error(r(151));for(var Jt=null,Re=null,kt=k,le=k=0,Se=null,Ce=nt.next();kt!==null&&!Ce.done;le++,Ce=nt.next()){kt.index>le?(Se=kt,kt=null):Se=kt.sibling;var Da=st(Q,kt,Ce.value,_t);if(Da===null){kt===null&&(kt=Se);break}t&&kt&&Da.alternate===null&&n(Q,kt),k=f(Da,k,le),Re===null?Jt=Da:Re.sibling=Da,Re=Da,kt=Se}if(Ce.done)return a(Q,kt),Me&&Fi(Q,le),Jt;if(kt===null){for(;!Ce.done;le++,Ce=nt.next())Ce=vt(Q,Ce.value,_t),Ce!==null&&(k=f(Ce,k,le),Re===null?Jt=Ce:Re.sibling=Ce,Re=Ce);return Me&&Fi(Q,le),Jt}for(kt=o(kt);!Ce.done;le++,Ce=nt.next())Ce=ut(kt,Q,le,Ce.value,_t),Ce!==null&&(t&&Ce.alternate!==null&&kt.delete(Ce.key===null?le:Ce.key),k=f(Ce,k,le),Re===null?Jt=Ce:Re.sibling=Ce,Re=Ce);return t&&kt.forEach(function(xS){return n(Q,xS)}),Me&&Fi(Q,le),Jt}function He(Q,k,nt,_t){if(typeof nt=="object"&&nt!==null&&nt.type===R&&nt.key===null&&(nt=nt.props.children),typeof nt=="object"&&nt!==null){switch(nt.$$typeof){case M:t:{for(var Jt=nt.key;k!==null;){if(k.key===Jt){if(Jt=nt.type,Jt===R){if(k.tag===7){a(Q,k.sibling),_t=u(k,nt.props.children),_t.return=Q,Q=_t;break t}}else if(k.elementType===Jt||typeof Jt=="object"&&Jt!==null&&Jt.$$typeof===V&&tr(Jt)===k.type){a(Q,k.sibling),_t=u(k,nt.props),js(_t,nt),_t.return=Q,Q=_t;break t}a(Q,k);break}else n(Q,k);k=k.sibling}nt.type===R?(_t=ja(nt.props.children,Q.mode,_t,nt.key),_t.return=Q,Q=_t):(_t=Jo(nt.type,nt.key,nt.props,null,Q.mode,_t),js(_t,nt),_t.return=Q,Q=_t)}return x(Q);case T:t:{for(Jt=nt.key;k!==null;){if(k.key===Jt)if(k.tag===4&&k.stateNode.containerInfo===nt.containerInfo&&k.stateNode.implementation===nt.implementation){a(Q,k.sibling),_t=u(k,nt.children||[]),_t.return=Q,Q=_t;break t}else{a(Q,k);break}else n(Q,k);k=k.sibling}_t=au(nt,Q.mode,_t),_t.return=Q,Q=_t}return x(Q);case V:return nt=tr(nt),He(Q,k,nt,_t)}if(ct(nt))return Ht(Q,k,nt,_t);if(J(nt)){if(Jt=J(nt),typeof Jt!="function")throw Error(r(150));return nt=Jt.call(nt),te(Q,k,nt,_t)}if(typeof nt.then=="function")return He(Q,k,rl(nt),_t);if(nt.$$typeof===z)return He(Q,k,el(Q,nt),_t);sl(Q,nt)}return typeof nt=="string"&&nt!==""||typeof nt=="number"||typeof nt=="bigint"?(nt=""+nt,k!==null&&k.tag===6?(a(Q,k.sibling),_t=u(k,nt),_t.return=Q,Q=_t):(a(Q,k),_t=iu(nt,Q.mode,_t),_t.return=Q,Q=_t),x(Q)):a(Q,k)}return function(Q,k,nt,_t){try{Zs=0;var Jt=He(Q,k,nt,_t);return Vr=null,Jt}catch(kt){if(kt===Gr||kt===il)throw kt;var Re=Wn(29,kt,null,Q.mode);return Re.lanes=_t,Re.return=Q,Re}}}var nr=Rp(!0),Cp=Rp(!1),ha=!1;function gu(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,lanes:0,hiddenCallbacks:null},callbacks:null}}function _u(t,n){t=t.updateQueue,n.updateQueue===t&&(n.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,callbacks:null})}function pa(t){return{lane:t,tag:0,payload:null,callback:null,next:null}}function ma(t,n,a){var o=t.updateQueue;if(o===null)return null;if(o=o.shared,(De&2)!==0){var u=o.pending;return u===null?n.next=n:(n.next=u.next,u.next=n),o.pending=n,n=Qo(t),fp(t,null,a),n}return Ko(t,o,n,a),Qo(t)}function Ks(t,n,a){if(n=n.updateQueue,n!==null&&(n=n.shared,(a&4194048)!==0)){var o=n.lanes;o&=t.pendingLanes,a|=o,n.lanes=a,Mi(t,a)}}function vu(t,n){var a=t.updateQueue,o=t.alternate;if(o!==null&&(o=o.updateQueue,a===o)){var u=null,f=null;if(a=a.firstBaseUpdate,a!==null){do{var x={lane:a.lane,tag:a.tag,payload:a.payload,callback:null,next:null};f===null?u=f=x:f=f.next=x,a=a.next}while(a!==null);f===null?u=f=n:f=f.next=n}else u=f=n;a={baseState:o.baseState,firstBaseUpdate:u,lastBaseUpdate:f,shared:o.shared,callbacks:o.callbacks},t.updateQueue=a;return}t=a.lastBaseUpdate,t===null?a.firstBaseUpdate=n:t.next=n,a.lastBaseUpdate=n}var xu=!1;function Qs(){if(xu){var t=Hr;if(t!==null)throw t}}function Js(t,n,a,o){xu=!1;var u=t.updateQueue;ha=!1;var f=u.firstBaseUpdate,x=u.lastBaseUpdate,b=u.shared.pending;if(b!==null){u.shared.pending=null;var F=b,it=F.next;F.next=null,x===null?f=it:x.next=it,x=F;var ht=t.alternate;ht!==null&&(ht=ht.updateQueue,b=ht.lastBaseUpdate,b!==x&&(b===null?ht.firstBaseUpdate=it:b.next=it,ht.lastBaseUpdate=F))}if(f!==null){var vt=u.baseState;x=0,ht=it=F=null,b=f;do{var st=b.lane&-536870913,ut=st!==b.lane;if(ut?(xe&st)===st:(o&st)===st){st!==0&&st===Ir&&(xu=!0),ht!==null&&(ht=ht.next={lane:0,tag:b.tag,payload:b.payload,callback:null,next:null});t:{var Ht=t,te=b;st=n;var He=a;switch(te.tag){case 1:if(Ht=te.payload,typeof Ht=="function"){vt=Ht.call(He,vt,st);break t}vt=Ht;break t;case 3:Ht.flags=Ht.flags&-65537|128;case 0:if(Ht=te.payload,st=typeof Ht=="function"?Ht.call(He,vt,st):Ht,st==null)break t;vt=g({},vt,st);break t;case 2:ha=!0}}st=b.callback,st!==null&&(t.flags|=64,ut&&(t.flags|=8192),ut=u.callbacks,ut===null?u.callbacks=[st]:ut.push(st))}else ut={lane:st,tag:b.tag,payload:b.payload,callback:b.callback,next:null},ht===null?(it=ht=ut,F=vt):ht=ht.next=ut,x|=st;if(b=b.next,b===null){if(b=u.shared.pending,b===null)break;ut=b,b=ut.next,ut.next=null,u.lastBaseUpdate=ut,u.shared.pending=null}}while(!0);ht===null&&(F=vt),u.baseState=F,u.firstBaseUpdate=it,u.lastBaseUpdate=ht,f===null&&(u.shared.lanes=0),Sa|=x,t.lanes=x,t.memoizedState=vt}}function wp(t,n){if(typeof t!="function")throw Error(r(191,t));t.call(n)}function Dp(t,n){var a=t.callbacks;if(a!==null)for(t.callbacks=null,t=0;t<a.length;t++)wp(a[t],n)}var kr=P(null),ol=P(0);function Up(t,n){t=ji,X(ol,t),X(kr,n),ji=t|n.baseLanes}function Su(){X(ol,ji),X(kr,kr.current)}function yu(){ji=ol.current,et(kr),et(ol)}var qn=P(null),si=null;function ga(t){var n=t.alternate;X(en,en.current&1),X(qn,t),si===null&&(n===null||kr.current!==null||n.memoizedState!==null)&&(si=t)}function Mu(t){X(en,en.current),X(qn,t),si===null&&(si=t)}function Lp(t){t.tag===22?(X(en,en.current),X(qn,t),si===null&&(si=t)):_a()}function _a(){X(en,en.current),X(qn,qn.current)}function Yn(t){et(qn),si===t&&(si=null),et(en)}var en=P(0);function ll(t){for(var n=t;n!==null;){if(n.tag===13){var a=n.memoizedState;if(a!==null&&(a=a.dehydrated,a===null||wf(a)||Df(a)))return n}else if(n.tag===19&&(n.memoizedProps.revealOrder==="forwards"||n.memoizedProps.revealOrder==="backwards"||n.memoizedProps.revealOrder==="unstable_legacy-backwards"||n.memoizedProps.revealOrder==="together")){if((n.flags&128)!==0)return n}else if(n.child!==null){n.child.return=n,n=n.child;continue}if(n===t)break;for(;n.sibling===null;){if(n.return===null||n.return===t)return null;n=n.return}n.sibling.return=n.return,n=n.sibling}return null}var Gi=0,se=null,Fe=null,sn=null,cl=!1,Xr=!1,ir=!1,ul=0,$s=0,Wr=null,cx=0;function Ke(){throw Error(r(321))}function Eu(t,n){if(n===null)return!1;for(var a=0;a<n.length&&a<t.length;a++)if(!Xn(t[a],n[a]))return!1;return!0}function Tu(t,n,a,o,u,f){return Gi=f,se=n,n.memoizedState=null,n.updateQueue=null,n.lanes=0,B.H=t===null||t.memoizedState===null?mm:Iu,ir=!1,f=a(o,u),ir=!1,Xr&&(f=Op(n,a,o,u)),Np(t),f}function Np(t){B.H=no;var n=Fe!==null&&Fe.next!==null;if(Gi=0,sn=Fe=se=null,cl=!1,$s=0,Wr=null,n)throw Error(r(300));t===null||on||(t=t.dependencies,t!==null&&tl(t)&&(on=!0))}function Op(t,n,a,o){se=t;var u=0;do{if(Xr&&(Wr=null),$s=0,Xr=!1,25<=u)throw Error(r(301));if(u+=1,sn=Fe=null,t.updateQueue!=null){var f=t.updateQueue;f.lastEffect=null,f.events=null,f.stores=null,f.memoCache!=null&&(f.memoCache.index=0)}B.H=gm,f=n(a,o)}while(Xr);return f}function ux(){var t=B.H,n=t.useState()[0];return n=typeof n.then=="function"?to(n):n,t=t.useState()[0],(Fe!==null?Fe.memoizedState:null)!==t&&(se.flags|=1024),n}function bu(){var t=ul!==0;return ul=0,t}function Au(t,n,a){n.updateQueue=t.updateQueue,n.flags&=-2053,t.lanes&=~a}function Ru(t){if(cl){for(t=t.memoizedState;t!==null;){var n=t.queue;n!==null&&(n.pending=null),t=t.next}cl=!1}Gi=0,sn=Fe=se=null,Xr=!1,$s=ul=0,Wr=null}function Un(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return sn===null?se.memoizedState=sn=t:sn=sn.next=t,sn}function nn(){if(Fe===null){var t=se.alternate;t=t!==null?t.memoizedState:null}else t=Fe.next;var n=sn===null?se.memoizedState:sn.next;if(n!==null)sn=n,Fe=t;else{if(t===null)throw se.alternate===null?Error(r(467)):Error(r(310));Fe=t,t={memoizedState:Fe.memoizedState,baseState:Fe.baseState,baseQueue:Fe.baseQueue,queue:Fe.queue,next:null},sn===null?se.memoizedState=sn=t:sn=sn.next=t}return sn}function fl(){return{lastEffect:null,events:null,stores:null,memoCache:null}}function to(t){var n=$s;return $s+=1,Wr===null&&(Wr=[]),t=Tp(Wr,t,n),n=se,(sn===null?n.memoizedState:sn.next)===null&&(n=n.alternate,B.H=n===null||n.memoizedState===null?mm:Iu),t}function dl(t){if(t!==null&&typeof t=="object"){if(typeof t.then=="function")return to(t);if(t.$$typeof===z)return Sn(t)}throw Error(r(438,String(t)))}function Cu(t){var n=null,a=se.updateQueue;if(a!==null&&(n=a.memoCache),n==null){var o=se.alternate;o!==null&&(o=o.updateQueue,o!==null&&(o=o.memoCache,o!=null&&(n={data:o.data.map(function(u){return u.slice()}),index:0})))}if(n==null&&(n={data:[],index:0}),a===null&&(a=fl(),se.updateQueue=a),a.memoCache=n,a=n.data[n.index],a===void 0)for(a=n.data[n.index]=Array(t),o=0;o<t;o++)a[o]=w;return n.index++,a}function Vi(t,n){return typeof n=="function"?n(t):n}function hl(t){var n=nn();return wu(n,Fe,t)}function wu(t,n,a){var o=t.queue;if(o===null)throw Error(r(311));o.lastRenderedReducer=a;var u=t.baseQueue,f=o.pending;if(f!==null){if(u!==null){var x=u.next;u.next=f.next,f.next=x}n.baseQueue=u=f,o.pending=null}if(f=t.baseState,u===null)t.memoizedState=f;else{n=u.next;var b=x=null,F=null,it=n,ht=!1;do{var vt=it.lane&-536870913;if(vt!==it.lane?(xe&vt)===vt:(Gi&vt)===vt){var st=it.revertLane;if(st===0)F!==null&&(F=F.next={lane:0,revertLane:0,gesture:null,action:it.action,hasEagerState:it.hasEagerState,eagerState:it.eagerState,next:null}),vt===Ir&&(ht=!0);else if((Gi&st)===st){it=it.next,st===Ir&&(ht=!0);continue}else vt={lane:0,revertLane:it.revertLane,gesture:null,action:it.action,hasEagerState:it.hasEagerState,eagerState:it.eagerState,next:null},F===null?(b=F=vt,x=f):F=F.next=vt,se.lanes|=st,Sa|=st;vt=it.action,ir&&a(f,vt),f=it.hasEagerState?it.eagerState:a(f,vt)}else st={lane:vt,revertLane:it.revertLane,gesture:it.gesture,action:it.action,hasEagerState:it.hasEagerState,eagerState:it.eagerState,next:null},F===null?(b=F=st,x=f):F=F.next=st,se.lanes|=vt,Sa|=vt;it=it.next}while(it!==null&&it!==n);if(F===null?x=f:F.next=b,!Xn(f,t.memoizedState)&&(on=!0,ht&&(a=Hr,a!==null)))throw a;t.memoizedState=f,t.baseState=x,t.baseQueue=F,o.lastRenderedState=f}return u===null&&(o.lanes=0),[t.memoizedState,o.dispatch]}function Du(t){var n=nn(),a=n.queue;if(a===null)throw Error(r(311));a.lastRenderedReducer=t;var o=a.dispatch,u=a.pending,f=n.memoizedState;if(u!==null){a.pending=null;var x=u=u.next;do f=t(f,x.action),x=x.next;while(x!==u);Xn(f,n.memoizedState)||(on=!0),n.memoizedState=f,n.baseQueue===null&&(n.baseState=f),a.lastRenderedState=f}return[f,o]}function zp(t,n,a){var o=se,u=nn(),f=Me;if(f){if(a===void 0)throw Error(r(407));a=a()}else a=n();var x=!Xn((Fe||u).memoizedState,a);if(x&&(u.memoizedState=a,on=!0),u=u.queue,Nu(Fp.bind(null,o,u,t),[t]),u.getSnapshot!==n||x||sn!==null&&sn.memoizedState.tag&1){if(o.flags|=2048,qr(9,{destroy:void 0},Bp.bind(null,o,u,a,n),null),ke===null)throw Error(r(349));f||(Gi&127)!==0||Pp(o,n,a)}return a}function Pp(t,n,a){t.flags|=16384,t={getSnapshot:n,value:a},n=se.updateQueue,n===null?(n=fl(),se.updateQueue=n,n.stores=[t]):(a=n.stores,a===null?n.stores=[t]:a.push(t))}function Bp(t,n,a,o){n.value=a,n.getSnapshot=o,Ip(n)&&Hp(t)}function Fp(t,n,a){return a(function(){Ip(n)&&Hp(t)})}function Ip(t){var n=t.getSnapshot;t=t.value;try{var a=n();return!Xn(t,a)}catch{return!0}}function Hp(t){var n=Za(t,2);n!==null&&In(n,t,2)}function Uu(t){var n=Un();if(typeof t=="function"){var a=t;if(t=a(),ir){jt(!0);try{a()}finally{jt(!1)}}}return n.memoizedState=n.baseState=t,n.queue={pending:null,lanes:0,dispatch:null,lastRenderedReducer:Vi,lastRenderedState:t},n}function Gp(t,n,a,o){return t.baseState=a,wu(t,Fe,typeof o=="function"?o:Vi)}function fx(t,n,a,o,u){if(gl(t))throw Error(r(485));if(t=n.action,t!==null){var f={payload:u,action:t,next:null,isTransition:!0,status:"pending",value:null,reason:null,listeners:[],then:function(x){f.listeners.push(x)}};B.T!==null?a(!0):f.isTransition=!1,o(f),a=n.pending,a===null?(f.next=n.pending=f,Vp(n,f)):(f.next=a.next,n.pending=a.next=f)}}function Vp(t,n){var a=n.action,o=n.payload,u=t.state;if(n.isTransition){var f=B.T,x={};B.T=x;try{var b=a(u,o),F=B.S;F!==null&&F(x,b),kp(t,n,b)}catch(it){Lu(t,n,it)}finally{f!==null&&x.types!==null&&(f.types=x.types),B.T=f}}else try{f=a(u,o),kp(t,n,f)}catch(it){Lu(t,n,it)}}function kp(t,n,a){a!==null&&typeof a=="object"&&typeof a.then=="function"?a.then(function(o){Xp(t,n,o)},function(o){return Lu(t,n,o)}):Xp(t,n,a)}function Xp(t,n,a){n.status="fulfilled",n.value=a,Wp(n),t.state=a,n=t.pending,n!==null&&(a=n.next,a===n?t.pending=null:(a=a.next,n.next=a,Vp(t,a)))}function Lu(t,n,a){var o=t.pending;if(t.pending=null,o!==null){o=o.next;do n.status="rejected",n.reason=a,Wp(n),n=n.next;while(n!==o)}t.action=null}function Wp(t){t=t.listeners;for(var n=0;n<t.length;n++)(0,t[n])()}function qp(t,n){return n}function Yp(t,n){if(Me){var a=ke.formState;if(a!==null){t:{var o=se;if(Me){if(qe){e:{for(var u=qe,f=ri;u.nodeType!==8;){if(!f){u=null;break e}if(u=oi(u.nextSibling),u===null){u=null;break e}}f=u.data,u=f==="F!"||f==="F"?u:null}if(u){qe=oi(u.nextSibling),o=u.data==="F!";break t}}fa(o)}o=!1}o&&(n=a[0])}}return a=Un(),a.memoizedState=a.baseState=n,o={pending:null,lanes:0,dispatch:null,lastRenderedReducer:qp,lastRenderedState:n},a.queue=o,a=dm.bind(null,se,o),o.dispatch=a,o=Uu(!1),f=Fu.bind(null,se,!1,o.queue),o=Un(),u={state:n,dispatch:null,action:t,pending:null},o.queue=u,a=fx.bind(null,se,u,f,a),u.dispatch=a,o.memoizedState=t,[n,a,!1]}function Zp(t){var n=nn();return jp(n,Fe,t)}function jp(t,n,a){if(n=wu(t,n,qp)[0],t=hl(Vi)[0],typeof n=="object"&&n!==null&&typeof n.then=="function")try{var o=to(n)}catch(x){throw x===Gr?il:x}else o=n;n=nn();var u=n.queue,f=u.dispatch;return a!==n.memoizedState&&(se.flags|=2048,qr(9,{destroy:void 0},dx.bind(null,u,a),null)),[o,f,t]}function dx(t,n){t.action=n}function Kp(t){var n=nn(),a=Fe;if(a!==null)return jp(n,a,t);nn(),n=n.memoizedState,a=nn();var o=a.queue.dispatch;return a.memoizedState=t,[n,o,!1]}function qr(t,n,a,o){return t={tag:t,create:a,deps:o,inst:n,next:null},n=se.updateQueue,n===null&&(n=fl(),se.updateQueue=n),a=n.lastEffect,a===null?n.lastEffect=t.next=t:(o=a.next,a.next=t,t.next=o,n.lastEffect=t),t}function Qp(){return nn().memoizedState}function pl(t,n,a,o){var u=Un();se.flags|=t,u.memoizedState=qr(1|n,{destroy:void 0},a,o===void 0?null:o)}function ml(t,n,a,o){var u=nn();o=o===void 0?null:o;var f=u.memoizedState.inst;Fe!==null&&o!==null&&Eu(o,Fe.memoizedState.deps)?u.memoizedState=qr(n,f,a,o):(se.flags|=t,u.memoizedState=qr(1|n,f,a,o))}function Jp(t,n){pl(8390656,8,t,n)}function Nu(t,n){ml(2048,8,t,n)}function hx(t){se.flags|=4;var n=se.updateQueue;if(n===null)n=fl(),se.updateQueue=n,n.events=[t];else{var a=n.events;a===null?n.events=[t]:a.push(t)}}function $p(t){var n=nn().memoizedState;return hx({ref:n,nextImpl:t}),function(){if((De&2)!==0)throw Error(r(440));return n.impl.apply(void 0,arguments)}}function tm(t,n){return ml(4,2,t,n)}function em(t,n){return ml(4,4,t,n)}function nm(t,n){if(typeof n=="function"){t=t();var a=n(t);return function(){typeof a=="function"?a():n(null)}}if(n!=null)return t=t(),n.current=t,function(){n.current=null}}function im(t,n,a){a=a!=null?a.concat([t]):null,ml(4,4,nm.bind(null,n,t),a)}function Ou(){}function am(t,n){var a=nn();n=n===void 0?null:n;var o=a.memoizedState;return n!==null&&Eu(n,o[1])?o[0]:(a.memoizedState=[t,n],t)}function rm(t,n){var a=nn();n=n===void 0?null:n;var o=a.memoizedState;if(n!==null&&Eu(n,o[1]))return o[0];if(o=t(),ir){jt(!0);try{t()}finally{jt(!1)}}return a.memoizedState=[o,n],o}function zu(t,n,a){return a===void 0||(Gi&1073741824)!==0&&(xe&261930)===0?t.memoizedState=n:(t.memoizedState=a,t=sg(),se.lanes|=t,Sa|=t,a)}function sm(t,n,a,o){return Xn(a,n)?a:kr.current!==null?(t=zu(t,a,o),Xn(t,n)||(on=!0),t):(Gi&42)===0||(Gi&1073741824)!==0&&(xe&261930)===0?(on=!0,t.memoizedState=a):(t=sg(),se.lanes|=t,Sa|=t,n)}function om(t,n,a,o,u){var f=q.p;q.p=f!==0&&8>f?f:8;var x=B.T,b={};B.T=b,Fu(t,!1,n,a);try{var F=u(),it=B.S;if(it!==null&&it(b,F),F!==null&&typeof F=="object"&&typeof F.then=="function"){var ht=lx(F,o);eo(t,n,ht,Kn(t))}else eo(t,n,o,Kn(t))}catch(vt){eo(t,n,{then:function(){},status:"rejected",reason:vt},Kn())}finally{q.p=f,x!==null&&b.types!==null&&(x.types=b.types),B.T=x}}function px(){}function Pu(t,n,a,o){if(t.tag!==5)throw Error(r(476));var u=lm(t).queue;om(t,u,n,j,a===null?px:function(){return cm(t),a(o)})}function lm(t){var n=t.memoizedState;if(n!==null)return n;n={memoizedState:j,baseState:j,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:Vi,lastRenderedState:j},next:null};var a={};return n.next={memoizedState:a,baseState:a,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:Vi,lastRenderedState:a},next:null},t.memoizedState=n,t=t.alternate,t!==null&&(t.memoizedState=n),n}function cm(t){var n=lm(t);n.next===null&&(n=t.alternate.memoizedState),eo(t,n.next.queue,{},Kn())}function Bu(){return Sn(xo)}function um(){return nn().memoizedState}function fm(){return nn().memoizedState}function mx(t){for(var n=t.return;n!==null;){switch(n.tag){case 24:case 3:var a=Kn();t=pa(a);var o=ma(n,t,a);o!==null&&(In(o,n,a),Ks(o,n,a)),n={cache:du()},t.payload=n;return}n=n.return}}function gx(t,n,a){var o=Kn();a={lane:o,revertLane:0,gesture:null,action:a,hasEagerState:!1,eagerState:null,next:null},gl(t)?hm(n,a):(a=eu(t,n,a,o),a!==null&&(In(a,t,o),pm(a,n,o)))}function dm(t,n,a){var o=Kn();eo(t,n,a,o)}function eo(t,n,a,o){var u={lane:o,revertLane:0,gesture:null,action:a,hasEagerState:!1,eagerState:null,next:null};if(gl(t))hm(n,u);else{var f=t.alternate;if(t.lanes===0&&(f===null||f.lanes===0)&&(f=n.lastRenderedReducer,f!==null))try{var x=n.lastRenderedState,b=f(x,a);if(u.hasEagerState=!0,u.eagerState=b,Xn(b,x))return Ko(t,n,u,0),ke===null&&jo(),!1}catch{}if(a=eu(t,n,u,o),a!==null)return In(a,t,o),pm(a,n,o),!0}return!1}function Fu(t,n,a,o){if(o={lane:2,revertLane:_f(),gesture:null,action:o,hasEagerState:!1,eagerState:null,next:null},gl(t)){if(n)throw Error(r(479))}else n=eu(t,a,o,2),n!==null&&In(n,t,2)}function gl(t){var n=t.alternate;return t===se||n!==null&&n===se}function hm(t,n){Xr=cl=!0;var a=t.pending;a===null?n.next=n:(n.next=a.next,a.next=n),t.pending=n}function pm(t,n,a){if((a&4194048)!==0){var o=n.lanes;o&=t.pendingLanes,a|=o,n.lanes=a,Mi(t,a)}}var no={readContext:Sn,use:dl,useCallback:Ke,useContext:Ke,useEffect:Ke,useImperativeHandle:Ke,useLayoutEffect:Ke,useInsertionEffect:Ke,useMemo:Ke,useReducer:Ke,useRef:Ke,useState:Ke,useDebugValue:Ke,useDeferredValue:Ke,useTransition:Ke,useSyncExternalStore:Ke,useId:Ke,useHostTransitionStatus:Ke,useFormState:Ke,useActionState:Ke,useOptimistic:Ke,useMemoCache:Ke,useCacheRefresh:Ke};no.useEffectEvent=Ke;var mm={readContext:Sn,use:dl,useCallback:function(t,n){return Un().memoizedState=[t,n===void 0?null:n],t},useContext:Sn,useEffect:Jp,useImperativeHandle:function(t,n,a){a=a!=null?a.concat([t]):null,pl(4194308,4,nm.bind(null,n,t),a)},useLayoutEffect:function(t,n){return pl(4194308,4,t,n)},useInsertionEffect:function(t,n){pl(4,2,t,n)},useMemo:function(t,n){var a=Un();n=n===void 0?null:n;var o=t();if(ir){jt(!0);try{t()}finally{jt(!1)}}return a.memoizedState=[o,n],o},useReducer:function(t,n,a){var o=Un();if(a!==void 0){var u=a(n);if(ir){jt(!0);try{a(n)}finally{jt(!1)}}}else u=n;return o.memoizedState=o.baseState=u,t={pending:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:u},o.queue=t,t=t.dispatch=gx.bind(null,se,t),[o.memoizedState,t]},useRef:function(t){var n=Un();return t={current:t},n.memoizedState=t},useState:function(t){t=Uu(t);var n=t.queue,a=dm.bind(null,se,n);return n.dispatch=a,[t.memoizedState,a]},useDebugValue:Ou,useDeferredValue:function(t,n){var a=Un();return zu(a,t,n)},useTransition:function(){var t=Uu(!1);return t=om.bind(null,se,t.queue,!0,!1),Un().memoizedState=t,[!1,t]},useSyncExternalStore:function(t,n,a){var o=se,u=Un();if(Me){if(a===void 0)throw Error(r(407));a=a()}else{if(a=n(),ke===null)throw Error(r(349));(xe&127)!==0||Pp(o,n,a)}u.memoizedState=a;var f={value:a,getSnapshot:n};return u.queue=f,Jp(Fp.bind(null,o,f,t),[t]),o.flags|=2048,qr(9,{destroy:void 0},Bp.bind(null,o,f,a,n),null),a},useId:function(){var t=Un(),n=ke.identifierPrefix;if(Me){var a=bi,o=Ti;a=(o&~(1<<32-Pt(o)-1)).toString(32)+a,n="_"+n+"R_"+a,a=ul++,0<a&&(n+="H"+a.toString(32)),n+="_"}else a=cx++,n="_"+n+"r_"+a.toString(32)+"_";return t.memoizedState=n},useHostTransitionStatus:Bu,useFormState:Yp,useActionState:Yp,useOptimistic:function(t){var n=Un();n.memoizedState=n.baseState=t;var a={pending:null,lanes:0,dispatch:null,lastRenderedReducer:null,lastRenderedState:null};return n.queue=a,n=Fu.bind(null,se,!0,a),a.dispatch=n,[t,n]},useMemoCache:Cu,useCacheRefresh:function(){return Un().memoizedState=mx.bind(null,se)},useEffectEvent:function(t){var n=Un(),a={impl:t};return n.memoizedState=a,function(){if((De&2)!==0)throw Error(r(440));return a.impl.apply(void 0,arguments)}}},Iu={readContext:Sn,use:dl,useCallback:am,useContext:Sn,useEffect:Nu,useImperativeHandle:im,useInsertionEffect:tm,useLayoutEffect:em,useMemo:rm,useReducer:hl,useRef:Qp,useState:function(){return hl(Vi)},useDebugValue:Ou,useDeferredValue:function(t,n){var a=nn();return sm(a,Fe.memoizedState,t,n)},useTransition:function(){var t=hl(Vi)[0],n=nn().memoizedState;return[typeof t=="boolean"?t:to(t),n]},useSyncExternalStore:zp,useId:um,useHostTransitionStatus:Bu,useFormState:Zp,useActionState:Zp,useOptimistic:function(t,n){var a=nn();return Gp(a,Fe,t,n)},useMemoCache:Cu,useCacheRefresh:fm};Iu.useEffectEvent=$p;var gm={readContext:Sn,use:dl,useCallback:am,useContext:Sn,useEffect:Nu,useImperativeHandle:im,useInsertionEffect:tm,useLayoutEffect:em,useMemo:rm,useReducer:Du,useRef:Qp,useState:function(){return Du(Vi)},useDebugValue:Ou,useDeferredValue:function(t,n){var a=nn();return Fe===null?zu(a,t,n):sm(a,Fe.memoizedState,t,n)},useTransition:function(){var t=Du(Vi)[0],n=nn().memoizedState;return[typeof t=="boolean"?t:to(t),n]},useSyncExternalStore:zp,useId:um,useHostTransitionStatus:Bu,useFormState:Kp,useActionState:Kp,useOptimistic:function(t,n){var a=nn();return Fe!==null?Gp(a,Fe,t,n):(a.baseState=t,[t,a.queue.dispatch])},useMemoCache:Cu,useCacheRefresh:fm};gm.useEffectEvent=$p;function Hu(t,n,a,o){n=t.memoizedState,a=a(o,n),a=a==null?n:g({},n,a),t.memoizedState=a,t.lanes===0&&(t.updateQueue.baseState=a)}var Gu={enqueueSetState:function(t,n,a){t=t._reactInternals;var o=Kn(),u=pa(o);u.payload=n,a!=null&&(u.callback=a),n=ma(t,u,o),n!==null&&(In(n,t,o),Ks(n,t,o))},enqueueReplaceState:function(t,n,a){t=t._reactInternals;var o=Kn(),u=pa(o);u.tag=1,u.payload=n,a!=null&&(u.callback=a),n=ma(t,u,o),n!==null&&(In(n,t,o),Ks(n,t,o))},enqueueForceUpdate:function(t,n){t=t._reactInternals;var a=Kn(),o=pa(a);o.tag=2,n!=null&&(o.callback=n),n=ma(t,o,a),n!==null&&(In(n,t,a),Ks(n,t,a))}};function _m(t,n,a,o,u,f,x){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(o,f,x):n.prototype&&n.prototype.isPureReactComponent?!Vs(a,o)||!Vs(u,f):!0}function vm(t,n,a,o){t=n.state,typeof n.componentWillReceiveProps=="function"&&n.componentWillReceiveProps(a,o),typeof n.UNSAFE_componentWillReceiveProps=="function"&&n.UNSAFE_componentWillReceiveProps(a,o),n.state!==t&&Gu.enqueueReplaceState(n,n.state,null)}function ar(t,n){var a=n;if("ref"in n){a={};for(var o in n)o!=="ref"&&(a[o]=n[o])}if(t=t.defaultProps){a===n&&(a=g({},a));for(var u in t)a[u]===void 0&&(a[u]=t[u])}return a}function xm(t){Zo(t)}function Sm(t){console.error(t)}function ym(t){Zo(t)}function _l(t,n){try{var a=t.onUncaughtError;a(n.value,{componentStack:n.stack})}catch(o){setTimeout(function(){throw o})}}function Mm(t,n,a){try{var o=t.onCaughtError;o(a.value,{componentStack:a.stack,errorBoundary:n.tag===1?n.stateNode:null})}catch(u){setTimeout(function(){throw u})}}function Vu(t,n,a){return a=pa(a),a.tag=3,a.payload={element:null},a.callback=function(){_l(t,n)},a}function Em(t){return t=pa(t),t.tag=3,t}function Tm(t,n,a,o){var u=a.type.getDerivedStateFromError;if(typeof u=="function"){var f=o.value;t.payload=function(){return u(f)},t.callback=function(){Mm(n,a,o)}}var x=a.stateNode;x!==null&&typeof x.componentDidCatch=="function"&&(t.callback=function(){Mm(n,a,o),typeof u!="function"&&(ya===null?ya=new Set([this]):ya.add(this));var b=o.stack;this.componentDidCatch(o.value,{componentStack:b!==null?b:""})})}function _x(t,n,a,o,u){if(a.flags|=32768,o!==null&&typeof o=="object"&&typeof o.then=="function"){if(n=a.alternate,n!==null&&Fr(n,a,u,!0),a=qn.current,a!==null){switch(a.tag){case 31:case 13:return si===null?wl():a.alternate===null&&Qe===0&&(Qe=3),a.flags&=-257,a.flags|=65536,a.lanes=u,o===al?a.flags|=16384:(n=a.updateQueue,n===null?a.updateQueue=new Set([o]):n.add(o),pf(t,o,u)),!1;case 22:return a.flags|=65536,o===al?a.flags|=16384:(n=a.updateQueue,n===null?(n={transitions:null,markerInstances:null,retryQueue:new Set([o])},a.updateQueue=n):(a=n.retryQueue,a===null?n.retryQueue=new Set([o]):a.add(o)),pf(t,o,u)),!1}throw Error(r(435,a.tag))}return pf(t,o,u),wl(),!1}if(Me)return n=qn.current,n!==null?((n.flags&65536)===0&&(n.flags|=256),n.flags|=65536,n.lanes=u,o!==ou&&(t=Error(r(422),{cause:o}),Ws(ni(t,a)))):(o!==ou&&(n=Error(r(423),{cause:o}),Ws(ni(n,a))),t=t.current.alternate,t.flags|=65536,u&=-u,t.lanes|=u,o=ni(o,a),u=Vu(t.stateNode,o,u),vu(t,u),Qe!==4&&(Qe=2)),!1;var f=Error(r(520),{cause:o});if(f=ni(f,a),uo===null?uo=[f]:uo.push(f),Qe!==4&&(Qe=2),n===null)return!0;o=ni(o,a),a=n;do{switch(a.tag){case 3:return a.flags|=65536,t=u&-u,a.lanes|=t,t=Vu(a.stateNode,o,t),vu(a,t),!1;case 1:if(n=a.type,f=a.stateNode,(a.flags&128)===0&&(typeof n.getDerivedStateFromError=="function"||f!==null&&typeof f.componentDidCatch=="function"&&(ya===null||!ya.has(f))))return a.flags|=65536,u&=-u,a.lanes|=u,u=Em(u),Tm(u,t,a,o),vu(a,u),!1}a=a.return}while(a!==null);return!1}var ku=Error(r(461)),on=!1;function yn(t,n,a,o){n.child=t===null?Cp(n,null,a,o):nr(n,t.child,a,o)}function bm(t,n,a,o,u){a=a.render;var f=n.ref;if("ref"in o){var x={};for(var b in o)b!=="ref"&&(x[b]=o[b])}else x=o;return Ja(n),o=Tu(t,n,a,x,f,u),b=bu(),t!==null&&!on?(Au(t,n,u),ki(t,n,u)):(Me&&b&&ru(n),n.flags|=1,yn(t,n,o,u),n.child)}function Am(t,n,a,o,u){if(t===null){var f=a.type;return typeof f=="function"&&!nu(f)&&f.defaultProps===void 0&&a.compare===null?(n.tag=15,n.type=f,Rm(t,n,f,o,u)):(t=Jo(a.type,null,o,n,n.mode,u),t.ref=n.ref,t.return=n,n.child=t)}if(f=t.child,!Qu(t,u)){var x=f.memoizedProps;if(a=a.compare,a=a!==null?a:Vs,a(x,o)&&t.ref===n.ref)return ki(t,n,u)}return n.flags|=1,t=Bi(f,o),t.ref=n.ref,t.return=n,n.child=t}function Rm(t,n,a,o,u){if(t!==null){var f=t.memoizedProps;if(Vs(f,o)&&t.ref===n.ref)if(on=!1,n.pendingProps=o=f,Qu(t,u))(t.flags&131072)!==0&&(on=!0);else return n.lanes=t.lanes,ki(t,n,u)}return Xu(t,n,a,o,u)}function Cm(t,n,a,o){var u=o.children,f=t!==null?t.memoizedState:null;if(t===null&&n.stateNode===null&&(n.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null}),o.mode==="hidden"){if((n.flags&128)!==0){if(f=f!==null?f.baseLanes|a:a,t!==null){for(o=n.child=t.child,u=0;o!==null;)u=u|o.lanes|o.childLanes,o=o.sibling;o=u&~f}else o=0,n.child=null;return wm(t,n,f,a,o)}if((a&536870912)!==0)n.memoizedState={baseLanes:0,cachePool:null},t!==null&&nl(n,f!==null?f.cachePool:null),f!==null?Up(n,f):Su(),Lp(n);else return o=n.lanes=536870912,wm(t,n,f!==null?f.baseLanes|a:a,a,o)}else f!==null?(nl(n,f.cachePool),Up(n,f),_a(),n.memoizedState=null):(t!==null&&nl(n,null),Su(),_a());return yn(t,n,u,a),n.child}function io(t,n){return t!==null&&t.tag===22||n.stateNode!==null||(n.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null}),n.sibling}function wm(t,n,a,o,u){var f=pu();return f=f===null?null:{parent:rn._currentValue,pool:f},n.memoizedState={baseLanes:a,cachePool:f},t!==null&&nl(n,null),Su(),Lp(n),t!==null&&Fr(t,n,o,!0),n.childLanes=u,null}function vl(t,n){return n=Sl({mode:n.mode,children:n.children},t.mode),n.ref=t.ref,t.child=n,n.return=t,n}function Dm(t,n,a){return nr(n,t.child,null,a),t=vl(n,n.pendingProps),t.flags|=2,Yn(n),n.memoizedState=null,t}function vx(t,n,a){var o=n.pendingProps,u=(n.flags&128)!==0;if(n.flags&=-129,t===null){if(Me){if(o.mode==="hidden")return t=vl(n,o),n.lanes=536870912,io(null,t);if(Mu(n),(t=qe)?(t=Vg(t,ri),t=t!==null&&t.data==="&"?t:null,t!==null&&(n.memoizedState={dehydrated:t,treeContext:ca!==null?{id:Ti,overflow:bi}:null,retryLane:536870912,hydrationErrors:null},a=hp(t),a.return=n,n.child=a,xn=n,qe=null)):t=null,t===null)throw fa(n);return n.lanes=536870912,null}return vl(n,o)}var f=t.memoizedState;if(f!==null){var x=f.dehydrated;if(Mu(n),u)if(n.flags&256)n.flags&=-257,n=Dm(t,n,a);else if(n.memoizedState!==null)n.child=t.child,n.flags|=128,n=null;else throw Error(r(558));else if(on||Fr(t,n,a,!1),u=(a&t.childLanes)!==0,on||u){if(o=ke,o!==null&&(x=Er(o,a),x!==0&&x!==f.retryLane))throw f.retryLane=x,Za(t,x),In(o,t,x),ku;wl(),n=Dm(t,n,a)}else t=f.treeContext,qe=oi(x.nextSibling),xn=n,Me=!0,ua=null,ri=!1,t!==null&&gp(n,t),n=vl(n,o),n.flags|=4096;return n}return t=Bi(t.child,{mode:o.mode,children:o.children}),t.ref=n.ref,n.child=t,t.return=n,t}function xl(t,n){var a=n.ref;if(a===null)t!==null&&t.ref!==null&&(n.flags|=4194816);else{if(typeof a!="function"&&typeof a!="object")throw Error(r(284));(t===null||t.ref!==a)&&(n.flags|=4194816)}}function Xu(t,n,a,o,u){return Ja(n),a=Tu(t,n,a,o,void 0,u),o=bu(),t!==null&&!on?(Au(t,n,u),ki(t,n,u)):(Me&&o&&ru(n),n.flags|=1,yn(t,n,a,u),n.child)}function Um(t,n,a,o,u,f){return Ja(n),n.updateQueue=null,a=Op(n,o,a,u),Np(t),o=bu(),t!==null&&!on?(Au(t,n,f),ki(t,n,f)):(Me&&o&&ru(n),n.flags|=1,yn(t,n,a,f),n.child)}function Lm(t,n,a,o,u){if(Ja(n),n.stateNode===null){var f=Or,x=a.contextType;typeof x=="object"&&x!==null&&(f=Sn(x)),f=new a(o,f),n.memoizedState=f.state!==null&&f.state!==void 0?f.state:null,f.updater=Gu,n.stateNode=f,f._reactInternals=n,f=n.stateNode,f.props=o,f.state=n.memoizedState,f.refs={},gu(n),x=a.contextType,f.context=typeof x=="object"&&x!==null?Sn(x):Or,f.state=n.memoizedState,x=a.getDerivedStateFromProps,typeof x=="function"&&(Hu(n,a,x,o),f.state=n.memoizedState),typeof a.getDerivedStateFromProps=="function"||typeof f.getSnapshotBeforeUpdate=="function"||typeof f.UNSAFE_componentWillMount!="function"&&typeof f.componentWillMount!="function"||(x=f.state,typeof f.componentWillMount=="function"&&f.componentWillMount(),typeof f.UNSAFE_componentWillMount=="function"&&f.UNSAFE_componentWillMount(),x!==f.state&&Gu.enqueueReplaceState(f,f.state,null),Js(n,o,f,u),Qs(),f.state=n.memoizedState),typeof f.componentDidMount=="function"&&(n.flags|=4194308),o=!0}else if(t===null){f=n.stateNode;var b=n.memoizedProps,F=ar(a,b);f.props=F;var it=f.context,ht=a.contextType;x=Or,typeof ht=="object"&&ht!==null&&(x=Sn(ht));var vt=a.getDerivedStateFromProps;ht=typeof vt=="function"||typeof f.getSnapshotBeforeUpdate=="function",b=n.pendingProps!==b,ht||typeof f.UNSAFE_componentWillReceiveProps!="function"&&typeof f.componentWillReceiveProps!="function"||(b||it!==x)&&vm(n,f,o,x),ha=!1;var st=n.memoizedState;f.state=st,Js(n,o,f,u),Qs(),it=n.memoizedState,b||st!==it||ha?(typeof vt=="function"&&(Hu(n,a,vt,o),it=n.memoizedState),(F=ha||_m(n,a,F,o,st,it,x))?(ht||typeof f.UNSAFE_componentWillMount!="function"&&typeof f.componentWillMount!="function"||(typeof f.componentWillMount=="function"&&f.componentWillMount(),typeof f.UNSAFE_componentWillMount=="function"&&f.UNSAFE_componentWillMount()),typeof f.componentDidMount=="function"&&(n.flags|=4194308)):(typeof f.componentDidMount=="function"&&(n.flags|=4194308),n.memoizedProps=o,n.memoizedState=it),f.props=o,f.state=it,f.context=x,o=F):(typeof f.componentDidMount=="function"&&(n.flags|=4194308),o=!1)}else{f=n.stateNode,_u(t,n),x=n.memoizedProps,ht=ar(a,x),f.props=ht,vt=n.pendingProps,st=f.context,it=a.contextType,F=Or,typeof it=="object"&&it!==null&&(F=Sn(it)),b=a.getDerivedStateFromProps,(it=typeof b=="function"||typeof f.getSnapshotBeforeUpdate=="function")||typeof f.UNSAFE_componentWillReceiveProps!="function"&&typeof f.componentWillReceiveProps!="function"||(x!==vt||st!==F)&&vm(n,f,o,F),ha=!1,st=n.memoizedState,f.state=st,Js(n,o,f,u),Qs();var ut=n.memoizedState;x!==vt||st!==ut||ha||t!==null&&t.dependencies!==null&&tl(t.dependencies)?(typeof b=="function"&&(Hu(n,a,b,o),ut=n.memoizedState),(ht=ha||_m(n,a,ht,o,st,ut,F)||t!==null&&t.dependencies!==null&&tl(t.dependencies))?(it||typeof f.UNSAFE_componentWillUpdate!="function"&&typeof f.componentWillUpdate!="function"||(typeof f.componentWillUpdate=="function"&&f.componentWillUpdate(o,ut,F),typeof f.UNSAFE_componentWillUpdate=="function"&&f.UNSAFE_componentWillUpdate(o,ut,F)),typeof f.componentDidUpdate=="function"&&(n.flags|=4),typeof f.getSnapshotBeforeUpdate=="function"&&(n.flags|=1024)):(typeof f.componentDidUpdate!="function"||x===t.memoizedProps&&st===t.memoizedState||(n.flags|=4),typeof f.getSnapshotBeforeUpdate!="function"||x===t.memoizedProps&&st===t.memoizedState||(n.flags|=1024),n.memoizedProps=o,n.memoizedState=ut),f.props=o,f.state=ut,f.context=F,o=ht):(typeof f.componentDidUpdate!="function"||x===t.memoizedProps&&st===t.memoizedState||(n.flags|=4),typeof f.getSnapshotBeforeUpdate!="function"||x===t.memoizedProps&&st===t.memoizedState||(n.flags|=1024),o=!1)}return f=o,xl(t,n),o=(n.flags&128)!==0,f||o?(f=n.stateNode,a=o&&typeof a.getDerivedStateFromError!="function"?null:f.render(),n.flags|=1,t!==null&&o?(n.child=nr(n,t.child,null,u),n.child=nr(n,null,a,u)):yn(t,n,a,u),n.memoizedState=f.state,t=n.child):t=ki(t,n,u),t}function Nm(t,n,a,o){return Ka(),n.flags|=256,yn(t,n,a,o),n.child}var Wu={dehydrated:null,treeContext:null,retryLane:0,hydrationErrors:null};function qu(t){return{baseLanes:t,cachePool:Mp()}}function Yu(t,n,a){return t=t!==null?t.childLanes&~a:0,n&&(t|=jn),t}function Om(t,n,a){var o=n.pendingProps,u=!1,f=(n.flags&128)!==0,x;if((x=f)||(x=t!==null&&t.memoizedState===null?!1:(en.current&2)!==0),x&&(u=!0,n.flags&=-129),x=(n.flags&32)!==0,n.flags&=-33,t===null){if(Me){if(u?ga(n):_a(),(t=qe)?(t=Vg(t,ri),t=t!==null&&t.data!=="&"?t:null,t!==null&&(n.memoizedState={dehydrated:t,treeContext:ca!==null?{id:Ti,overflow:bi}:null,retryLane:536870912,hydrationErrors:null},a=hp(t),a.return=n,n.child=a,xn=n,qe=null)):t=null,t===null)throw fa(n);return Df(t)?n.lanes=32:n.lanes=536870912,null}var b=o.children;return o=o.fallback,u?(_a(),u=n.mode,b=Sl({mode:"hidden",children:b},u),o=ja(o,u,a,null),b.return=n,o.return=n,b.sibling=o,n.child=b,o=n.child,o.memoizedState=qu(a),o.childLanes=Yu(t,x,a),n.memoizedState=Wu,io(null,o)):(ga(n),Zu(n,b))}var F=t.memoizedState;if(F!==null&&(b=F.dehydrated,b!==null)){if(f)n.flags&256?(ga(n),n.flags&=-257,n=ju(t,n,a)):n.memoizedState!==null?(_a(),n.child=t.child,n.flags|=128,n=null):(_a(),b=o.fallback,u=n.mode,o=Sl({mode:"visible",children:o.children},u),b=ja(b,u,a,null),b.flags|=2,o.return=n,b.return=n,o.sibling=b,n.child=o,nr(n,t.child,null,a),o=n.child,o.memoizedState=qu(a),o.childLanes=Yu(t,x,a),n.memoizedState=Wu,n=io(null,o));else if(ga(n),Df(b)){if(x=b.nextSibling&&b.nextSibling.dataset,x)var it=x.dgst;x=it,o=Error(r(419)),o.stack="",o.digest=x,Ws({value:o,source:null,stack:null}),n=ju(t,n,a)}else if(on||Fr(t,n,a,!1),x=(a&t.childLanes)!==0,on||x){if(x=ke,x!==null&&(o=Er(x,a),o!==0&&o!==F.retryLane))throw F.retryLane=o,Za(t,o),In(x,t,o),ku;wf(b)||wl(),n=ju(t,n,a)}else wf(b)?(n.flags|=192,n.child=t.child,n=null):(t=F.treeContext,qe=oi(b.nextSibling),xn=n,Me=!0,ua=null,ri=!1,t!==null&&gp(n,t),n=Zu(n,o.children),n.flags|=4096);return n}return u?(_a(),b=o.fallback,u=n.mode,F=t.child,it=F.sibling,o=Bi(F,{mode:"hidden",children:o.children}),o.subtreeFlags=F.subtreeFlags&65011712,it!==null?b=Bi(it,b):(b=ja(b,u,a,null),b.flags|=2),b.return=n,o.return=n,o.sibling=b,n.child=o,io(null,o),o=n.child,b=t.child.memoizedState,b===null?b=qu(a):(u=b.cachePool,u!==null?(F=rn._currentValue,u=u.parent!==F?{parent:F,pool:F}:u):u=Mp(),b={baseLanes:b.baseLanes|a,cachePool:u}),o.memoizedState=b,o.childLanes=Yu(t,x,a),n.memoizedState=Wu,io(t.child,o)):(ga(n),a=t.child,t=a.sibling,a=Bi(a,{mode:"visible",children:o.children}),a.return=n,a.sibling=null,t!==null&&(x=n.deletions,x===null?(n.deletions=[t],n.flags|=16):x.push(t)),n.child=a,n.memoizedState=null,a)}function Zu(t,n){return n=Sl({mode:"visible",children:n},t.mode),n.return=t,t.child=n}function Sl(t,n){return t=Wn(22,t,null,n),t.lanes=0,t}function ju(t,n,a){return nr(n,t.child,null,a),t=Zu(n,n.pendingProps.children),t.flags|=2,n.memoizedState=null,t}function zm(t,n,a){t.lanes|=n;var o=t.alternate;o!==null&&(o.lanes|=n),uu(t.return,n,a)}function Ku(t,n,a,o,u,f){var x=t.memoizedState;x===null?t.memoizedState={isBackwards:n,rendering:null,renderingStartTime:0,last:o,tail:a,tailMode:u,treeForkCount:f}:(x.isBackwards=n,x.rendering=null,x.renderingStartTime=0,x.last=o,x.tail=a,x.tailMode=u,x.treeForkCount=f)}function Pm(t,n,a){var o=n.pendingProps,u=o.revealOrder,f=o.tail;o=o.children;var x=en.current,b=(x&2)!==0;if(b?(x=x&1|2,n.flags|=128):x&=1,X(en,x),yn(t,n,o,a),o=Me?Xs:0,!b&&t!==null&&(t.flags&128)!==0)t:for(t=n.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&zm(t,a,n);else if(t.tag===19)zm(t,a,n);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===n)break t;for(;t.sibling===null;){if(t.return===null||t.return===n)break t;t=t.return}t.sibling.return=t.return,t=t.sibling}switch(u){case"forwards":for(a=n.child,u=null;a!==null;)t=a.alternate,t!==null&&ll(t)===null&&(u=a),a=a.sibling;a=u,a===null?(u=n.child,n.child=null):(u=a.sibling,a.sibling=null),Ku(n,!1,u,a,f,o);break;case"backwards":case"unstable_legacy-backwards":for(a=null,u=n.child,n.child=null;u!==null;){if(t=u.alternate,t!==null&&ll(t)===null){n.child=u;break}t=u.sibling,u.sibling=a,a=u,u=t}Ku(n,!0,a,null,f,o);break;case"together":Ku(n,!1,null,null,void 0,o);break;default:n.memoizedState=null}return n.child}function ki(t,n,a){if(t!==null&&(n.dependencies=t.dependencies),Sa|=n.lanes,(a&n.childLanes)===0)if(t!==null){if(Fr(t,n,a,!1),(a&n.childLanes)===0)return null}else return null;if(t!==null&&n.child!==t.child)throw Error(r(153));if(n.child!==null){for(t=n.child,a=Bi(t,t.pendingProps),n.child=a,a.return=n;t.sibling!==null;)t=t.sibling,a=a.sibling=Bi(t,t.pendingProps),a.return=n;a.sibling=null}return n.child}function Qu(t,n){return(t.lanes&n)!==0?!0:(t=t.dependencies,!!(t!==null&&tl(t)))}function xx(t,n,a){switch(n.tag){case 3:Ut(n,n.stateNode.containerInfo),da(n,rn,t.memoizedState.cache),Ka();break;case 27:case 5:$t(n);break;case 4:Ut(n,n.stateNode.containerInfo);break;case 10:da(n,n.type,n.memoizedProps.value);break;case 31:if(n.memoizedState!==null)return n.flags|=128,Mu(n),null;break;case 13:var o=n.memoizedState;if(o!==null)return o.dehydrated!==null?(ga(n),n.flags|=128,null):(a&n.child.childLanes)!==0?Om(t,n,a):(ga(n),t=ki(t,n,a),t!==null?t.sibling:null);ga(n);break;case 19:var u=(t.flags&128)!==0;if(o=(a&n.childLanes)!==0,o||(Fr(t,n,a,!1),o=(a&n.childLanes)!==0),u){if(o)return Pm(t,n,a);n.flags|=128}if(u=n.memoizedState,u!==null&&(u.rendering=null,u.tail=null,u.lastEffect=null),X(en,en.current),o)break;return null;case 22:return n.lanes=0,Cm(t,n,a,n.pendingProps);case 24:da(n,rn,t.memoizedState.cache)}return ki(t,n,a)}function Bm(t,n,a){if(t!==null)if(t.memoizedProps!==n.pendingProps)on=!0;else{if(!Qu(t,a)&&(n.flags&128)===0)return on=!1,xx(t,n,a);on=(t.flags&131072)!==0}else on=!1,Me&&(n.flags&1048576)!==0&&mp(n,Xs,n.index);switch(n.lanes=0,n.tag){case 16:t:{var o=n.pendingProps;if(t=tr(n.elementType),n.type=t,typeof t=="function")nu(t)?(o=ar(t,o),n.tag=1,n=Lm(null,n,t,o,a)):(n.tag=0,n=Xu(null,n,t,o,a));else{if(t!=null){var u=t.$$typeof;if(u===D){n.tag=11,n=bm(null,n,t,o,a);break t}else if(u===U){n.tag=14,n=Am(null,n,t,o,a);break t}}throw n=rt(t)||t,Error(r(306,n,""))}}return n;case 0:return Xu(t,n,n.type,n.pendingProps,a);case 1:return o=n.type,u=ar(o,n.pendingProps),Lm(t,n,o,u,a);case 3:t:{if(Ut(n,n.stateNode.containerInfo),t===null)throw Error(r(387));o=n.pendingProps;var f=n.memoizedState;u=f.element,_u(t,n),Js(n,o,null,a);var x=n.memoizedState;if(o=x.cache,da(n,rn,o),o!==f.cache&&fu(n,[rn],a,!0),Qs(),o=x.element,f.isDehydrated)if(f={element:o,isDehydrated:!1,cache:x.cache},n.updateQueue.baseState=f,n.memoizedState=f,n.flags&256){n=Nm(t,n,o,a);break t}else if(o!==u){u=ni(Error(r(424)),n),Ws(u),n=Nm(t,n,o,a);break t}else for(t=n.stateNode.containerInfo,t.nodeType===9?t=t.body:t=t.nodeName==="HTML"?t.ownerDocument.body:t,qe=oi(t.firstChild),xn=n,Me=!0,ua=null,ri=!0,a=Cp(n,null,o,a),n.child=a;a;)a.flags=a.flags&-3|4096,a=a.sibling;else{if(Ka(),o===u){n=ki(t,n,a);break t}yn(t,n,o,a)}n=n.child}return n;case 26:return xl(t,n),t===null?(a=Zg(n.type,null,n.pendingProps,null))?n.memoizedState=a:Me||(a=n.type,t=n.pendingProps,o=Pl(mt.current).createElement(a),o[an]=n,o[_n]=t,Mn(o,a,t),Mt(o),n.stateNode=o):n.memoizedState=Zg(n.type,t.memoizedProps,n.pendingProps,t.memoizedState),null;case 27:return $t(n),t===null&&Me&&(o=n.stateNode=Wg(n.type,n.pendingProps,mt.current),xn=n,ri=!0,u=qe,ba(n.type)?(Uf=u,qe=oi(o.firstChild)):qe=u),yn(t,n,n.pendingProps.children,a),xl(t,n),t===null&&(n.flags|=4194304),n.child;case 5:return t===null&&Me&&((u=o=qe)&&(o=jx(o,n.type,n.pendingProps,ri),o!==null?(n.stateNode=o,xn=n,qe=oi(o.firstChild),ri=!1,u=!0):u=!1),u||fa(n)),$t(n),u=n.type,f=n.pendingProps,x=t!==null?t.memoizedProps:null,o=f.children,Af(u,f)?o=null:x!==null&&Af(u,x)&&(n.flags|=32),n.memoizedState!==null&&(u=Tu(t,n,ux,null,null,a),xo._currentValue=u),xl(t,n),yn(t,n,o,a),n.child;case 6:return t===null&&Me&&((t=a=qe)&&(a=Kx(a,n.pendingProps,ri),a!==null?(n.stateNode=a,xn=n,qe=null,t=!0):t=!1),t||fa(n)),null;case 13:return Om(t,n,a);case 4:return Ut(n,n.stateNode.containerInfo),o=n.pendingProps,t===null?n.child=nr(n,null,o,a):yn(t,n,o,a),n.child;case 11:return bm(t,n,n.type,n.pendingProps,a);case 7:return yn(t,n,n.pendingProps,a),n.child;case 8:return yn(t,n,n.pendingProps.children,a),n.child;case 12:return yn(t,n,n.pendingProps.children,a),n.child;case 10:return o=n.pendingProps,da(n,n.type,o.value),yn(t,n,o.children,a),n.child;case 9:return u=n.type._context,o=n.pendingProps.children,Ja(n),u=Sn(u),o=o(u),n.flags|=1,yn(t,n,o,a),n.child;case 14:return Am(t,n,n.type,n.pendingProps,a);case 15:return Rm(t,n,n.type,n.pendingProps,a);case 19:return Pm(t,n,a);case 31:return vx(t,n,a);case 22:return Cm(t,n,a,n.pendingProps);case 24:return Ja(n),o=Sn(rn),t===null?(u=pu(),u===null&&(u=ke,f=du(),u.pooledCache=f,f.refCount++,f!==null&&(u.pooledCacheLanes|=a),u=f),n.memoizedState={parent:o,cache:u},gu(n),da(n,rn,u)):((t.lanes&a)!==0&&(_u(t,n),Js(n,null,null,a),Qs()),u=t.memoizedState,f=n.memoizedState,u.parent!==o?(u={parent:o,cache:o},n.memoizedState=u,n.lanes===0&&(n.memoizedState=n.updateQueue.baseState=u),da(n,rn,o)):(o=f.cache,da(n,rn,o),o!==u.cache&&fu(n,[rn],a,!0))),yn(t,n,n.pendingProps.children,a),n.child;case 29:throw n.pendingProps}throw Error(r(156,n.tag))}function Xi(t){t.flags|=4}function Ju(t,n,a,o,u){if((n=(t.mode&32)!==0)&&(n=!1),n){if(t.flags|=16777216,(u&335544128)===u)if(t.stateNode.complete)t.flags|=8192;else if(ug())t.flags|=8192;else throw er=al,mu}else t.flags&=-16777217}function Fm(t,n){if(n.type!=="stylesheet"||(n.state.loading&4)!==0)t.flags&=-16777217;else if(t.flags|=16777216,!$g(n))if(ug())t.flags|=8192;else throw er=al,mu}function yl(t,n){n!==null&&(t.flags|=4),t.flags&16384&&(n=t.tag!==22?Oe():536870912,t.lanes|=n,Kr|=n)}function ao(t,n){if(!Me)switch(t.tailMode){case"hidden":n=t.tail;for(var a=null;n!==null;)n.alternate!==null&&(a=n),n=n.sibling;a===null?t.tail=null:a.sibling=null;break;case"collapsed":a=t.tail;for(var o=null;a!==null;)a.alternate!==null&&(o=a),a=a.sibling;o===null?n||t.tail===null?t.tail=null:t.tail.sibling=null:o.sibling=null}}function Ye(t){var n=t.alternate!==null&&t.alternate.child===t.child,a=0,o=0;if(n)for(var u=t.child;u!==null;)a|=u.lanes|u.childLanes,o|=u.subtreeFlags&65011712,o|=u.flags&65011712,u.return=t,u=u.sibling;else for(u=t.child;u!==null;)a|=u.lanes|u.childLanes,o|=u.subtreeFlags,o|=u.flags,u.return=t,u=u.sibling;return t.subtreeFlags|=o,t.childLanes=a,n}function Sx(t,n,a){var o=n.pendingProps;switch(su(n),n.tag){case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Ye(n),null;case 1:return Ye(n),null;case 3:return a=n.stateNode,o=null,t!==null&&(o=t.memoizedState.cache),n.memoizedState.cache!==o&&(n.flags|=2048),Hi(rn),Dt(),a.pendingContext&&(a.context=a.pendingContext,a.pendingContext=null),(t===null||t.child===null)&&(Br(n)?Xi(n):t===null||t.memoizedState.isDehydrated&&(n.flags&256)===0||(n.flags|=1024,lu())),Ye(n),null;case 26:var u=n.type,f=n.memoizedState;return t===null?(Xi(n),f!==null?(Ye(n),Fm(n,f)):(Ye(n),Ju(n,u,null,o,a))):f?f!==t.memoizedState?(Xi(n),Ye(n),Fm(n,f)):(Ye(n),n.flags&=-16777217):(t=t.memoizedProps,t!==o&&Xi(n),Ye(n),Ju(n,u,t,o,a)),null;case 27:if(Be(n),a=mt.current,u=n.type,t!==null&&n.stateNode!=null)t.memoizedProps!==o&&Xi(n);else{if(!o){if(n.stateNode===null)throw Error(r(166));return Ye(n),null}t=pt.current,Br(n)?_p(n):(t=Wg(u,o,a),n.stateNode=t,Xi(n))}return Ye(n),null;case 5:if(Be(n),u=n.type,t!==null&&n.stateNode!=null)t.memoizedProps!==o&&Xi(n);else{if(!o){if(n.stateNode===null)throw Error(r(166));return Ye(n),null}if(f=pt.current,Br(n))_p(n);else{var x=Pl(mt.current);switch(f){case 1:f=x.createElementNS("http://www.w3.org/2000/svg",u);break;case 2:f=x.createElementNS("http://www.w3.org/1998/Math/MathML",u);break;default:switch(u){case"svg":f=x.createElementNS("http://www.w3.org/2000/svg",u);break;case"math":f=x.createElementNS("http://www.w3.org/1998/Math/MathML",u);break;case"script":f=x.createElement("div"),f.innerHTML="<script><\/script>",f=f.removeChild(f.firstChild);break;case"select":f=typeof o.is=="string"?x.createElement("select",{is:o.is}):x.createElement("select"),o.multiple?f.multiple=!0:o.size&&(f.size=o.size);break;default:f=typeof o.is=="string"?x.createElement(u,{is:o.is}):x.createElement(u)}}f[an]=n,f[_n]=o;t:for(x=n.child;x!==null;){if(x.tag===5||x.tag===6)f.appendChild(x.stateNode);else if(x.tag!==4&&x.tag!==27&&x.child!==null){x.child.return=x,x=x.child;continue}if(x===n)break t;for(;x.sibling===null;){if(x.return===null||x.return===n)break t;x=x.return}x.sibling.return=x.return,x=x.sibling}n.stateNode=f;t:switch(Mn(f,u,o),u){case"button":case"input":case"select":case"textarea":o=!!o.autoFocus;break t;case"img":o=!0;break t;default:o=!1}o&&Xi(n)}}return Ye(n),Ju(n,n.type,t===null?null:t.memoizedProps,n.pendingProps,a),null;case 6:if(t&&n.stateNode!=null)t.memoizedProps!==o&&Xi(n);else{if(typeof o!="string"&&n.stateNode===null)throw Error(r(166));if(t=mt.current,Br(n)){if(t=n.stateNode,a=n.memoizedProps,o=null,u=xn,u!==null)switch(u.tag){case 27:case 5:o=u.memoizedProps}t[an]=n,t=!!(t.nodeValue===a||o!==null&&o.suppressHydrationWarning===!0||Og(t.nodeValue,a)),t||fa(n,!0)}else t=Pl(t).createTextNode(o),t[an]=n,n.stateNode=t}return Ye(n),null;case 31:if(a=n.memoizedState,t===null||t.memoizedState!==null){if(o=Br(n),a!==null){if(t===null){if(!o)throw Error(r(318));if(t=n.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(r(557));t[an]=n}else Ka(),(n.flags&128)===0&&(n.memoizedState=null),n.flags|=4;Ye(n),t=!1}else a=lu(),t!==null&&t.memoizedState!==null&&(t.memoizedState.hydrationErrors=a),t=!0;if(!t)return n.flags&256?(Yn(n),n):(Yn(n),null);if((n.flags&128)!==0)throw Error(r(558))}return Ye(n),null;case 13:if(o=n.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(u=Br(n),o!==null&&o.dehydrated!==null){if(t===null){if(!u)throw Error(r(318));if(u=n.memoizedState,u=u!==null?u.dehydrated:null,!u)throw Error(r(317));u[an]=n}else Ka(),(n.flags&128)===0&&(n.memoizedState=null),n.flags|=4;Ye(n),u=!1}else u=lu(),t!==null&&t.memoizedState!==null&&(t.memoizedState.hydrationErrors=u),u=!0;if(!u)return n.flags&256?(Yn(n),n):(Yn(n),null)}return Yn(n),(n.flags&128)!==0?(n.lanes=a,n):(a=o!==null,t=t!==null&&t.memoizedState!==null,a&&(o=n.child,u=null,o.alternate!==null&&o.alternate.memoizedState!==null&&o.alternate.memoizedState.cachePool!==null&&(u=o.alternate.memoizedState.cachePool.pool),f=null,o.memoizedState!==null&&o.memoizedState.cachePool!==null&&(f=o.memoizedState.cachePool.pool),f!==u&&(o.flags|=2048)),a!==t&&a&&(n.child.flags|=8192),yl(n,n.updateQueue),Ye(n),null);case 4:return Dt(),t===null&&yf(n.stateNode.containerInfo),Ye(n),null;case 10:return Hi(n.type),Ye(n),null;case 19:if(et(en),o=n.memoizedState,o===null)return Ye(n),null;if(u=(n.flags&128)!==0,f=o.rendering,f===null)if(u)ao(o,!1);else{if(Qe!==0||t!==null&&(t.flags&128)!==0)for(t=n.child;t!==null;){if(f=ll(t),f!==null){for(n.flags|=128,ao(o,!1),t=f.updateQueue,n.updateQueue=t,yl(n,t),n.subtreeFlags=0,t=a,a=n.child;a!==null;)dp(a,t),a=a.sibling;return X(en,en.current&1|2),Me&&Fi(n,o.treeForkCount),n.child}t=t.sibling}o.tail!==null&&E()>Al&&(n.flags|=128,u=!0,ao(o,!1),n.lanes=4194304)}else{if(!u)if(t=ll(f),t!==null){if(n.flags|=128,u=!0,t=t.updateQueue,n.updateQueue=t,yl(n,t),ao(o,!0),o.tail===null&&o.tailMode==="hidden"&&!f.alternate&&!Me)return Ye(n),null}else 2*E()-o.renderingStartTime>Al&&a!==536870912&&(n.flags|=128,u=!0,ao(o,!1),n.lanes=4194304);o.isBackwards?(f.sibling=n.child,n.child=f):(t=o.last,t!==null?t.sibling=f:n.child=f,o.last=f)}return o.tail!==null?(t=o.tail,o.rendering=t,o.tail=t.sibling,o.renderingStartTime=E(),t.sibling=null,a=en.current,X(en,u?a&1|2:a&1),Me&&Fi(n,o.treeForkCount),t):(Ye(n),null);case 22:case 23:return Yn(n),yu(),o=n.memoizedState!==null,t!==null?t.memoizedState!==null!==o&&(n.flags|=8192):o&&(n.flags|=8192),o?(a&536870912)!==0&&(n.flags&128)===0&&(Ye(n),n.subtreeFlags&6&&(n.flags|=8192)):Ye(n),a=n.updateQueue,a!==null&&yl(n,a.retryQueue),a=null,t!==null&&t.memoizedState!==null&&t.memoizedState.cachePool!==null&&(a=t.memoizedState.cachePool.pool),o=null,n.memoizedState!==null&&n.memoizedState.cachePool!==null&&(o=n.memoizedState.cachePool.pool),o!==a&&(n.flags|=2048),t!==null&&et($a),null;case 24:return a=null,t!==null&&(a=t.memoizedState.cache),n.memoizedState.cache!==a&&(n.flags|=2048),Hi(rn),Ye(n),null;case 25:return null;case 30:return null}throw Error(r(156,n.tag))}function yx(t,n){switch(su(n),n.tag){case 1:return t=n.flags,t&65536?(n.flags=t&-65537|128,n):null;case 3:return Hi(rn),Dt(),t=n.flags,(t&65536)!==0&&(t&128)===0?(n.flags=t&-65537|128,n):null;case 26:case 27:case 5:return Be(n),null;case 31:if(n.memoizedState!==null){if(Yn(n),n.alternate===null)throw Error(r(340));Ka()}return t=n.flags,t&65536?(n.flags=t&-65537|128,n):null;case 13:if(Yn(n),t=n.memoizedState,t!==null&&t.dehydrated!==null){if(n.alternate===null)throw Error(r(340));Ka()}return t=n.flags,t&65536?(n.flags=t&-65537|128,n):null;case 19:return et(en),null;case 4:return Dt(),null;case 10:return Hi(n.type),null;case 22:case 23:return Yn(n),yu(),t!==null&&et($a),t=n.flags,t&65536?(n.flags=t&-65537|128,n):null;case 24:return Hi(rn),null;case 25:return null;default:return null}}function Im(t,n){switch(su(n),n.tag){case 3:Hi(rn),Dt();break;case 26:case 27:case 5:Be(n);break;case 4:Dt();break;case 31:n.memoizedState!==null&&Yn(n);break;case 13:Yn(n);break;case 19:et(en);break;case 10:Hi(n.type);break;case 22:case 23:Yn(n),yu(),t!==null&&et($a);break;case 24:Hi(rn)}}function ro(t,n){try{var a=n.updateQueue,o=a!==null?a.lastEffect:null;if(o!==null){var u=o.next;a=u;do{if((a.tag&t)===t){o=void 0;var f=a.create,x=a.inst;o=f(),x.destroy=o}a=a.next}while(a!==u)}}catch(b){Pe(n,n.return,b)}}function va(t,n,a){try{var o=n.updateQueue,u=o!==null?o.lastEffect:null;if(u!==null){var f=u.next;o=f;do{if((o.tag&t)===t){var x=o.inst,b=x.destroy;if(b!==void 0){x.destroy=void 0,u=n;var F=a,it=b;try{it()}catch(ht){Pe(u,F,ht)}}}o=o.next}while(o!==f)}}catch(ht){Pe(n,n.return,ht)}}function Hm(t){var n=t.updateQueue;if(n!==null){var a=t.stateNode;try{Dp(n,a)}catch(o){Pe(t,t.return,o)}}}function Gm(t,n,a){a.props=ar(t.type,t.memoizedProps),a.state=t.memoizedState;try{a.componentWillUnmount()}catch(o){Pe(t,n,o)}}function so(t,n){try{var a=t.ref;if(a!==null){switch(t.tag){case 26:case 27:case 5:var o=t.stateNode;break;case 30:o=t.stateNode;break;default:o=t.stateNode}typeof a=="function"?t.refCleanup=a(o):a.current=o}}catch(u){Pe(t,n,u)}}function Ai(t,n){var a=t.ref,o=t.refCleanup;if(a!==null)if(typeof o=="function")try{o()}catch(u){Pe(t,n,u)}finally{t.refCleanup=null,t=t.alternate,t!=null&&(t.refCleanup=null)}else if(typeof a=="function")try{a(null)}catch(u){Pe(t,n,u)}else a.current=null}function Vm(t){var n=t.type,a=t.memoizedProps,o=t.stateNode;try{t:switch(n){case"button":case"input":case"select":case"textarea":a.autoFocus&&o.focus();break t;case"img":a.src?o.src=a.src:a.srcSet&&(o.srcset=a.srcSet)}}catch(u){Pe(t,t.return,u)}}function $u(t,n,a){try{var o=t.stateNode;kx(o,t.type,a,n),o[_n]=n}catch(u){Pe(t,t.return,u)}}function km(t){return t.tag===5||t.tag===3||t.tag===26||t.tag===27&&ba(t.type)||t.tag===4}function tf(t){t:for(;;){for(;t.sibling===null;){if(t.return===null||km(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.tag===27&&ba(t.type)||t.flags&2||t.child===null||t.tag===4)continue t;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function ef(t,n,a){var o=t.tag;if(o===5||o===6)t=t.stateNode,n?(a.nodeType===9?a.body:a.nodeName==="HTML"?a.ownerDocument.body:a).insertBefore(t,n):(n=a.nodeType===9?a.body:a.nodeName==="HTML"?a.ownerDocument.body:a,n.appendChild(t),a=a._reactRootContainer,a!=null||n.onclick!==null||(n.onclick=zi));else if(o!==4&&(o===27&&ba(t.type)&&(a=t.stateNode,n=null),t=t.child,t!==null))for(ef(t,n,a),t=t.sibling;t!==null;)ef(t,n,a),t=t.sibling}function Ml(t,n,a){var o=t.tag;if(o===5||o===6)t=t.stateNode,n?a.insertBefore(t,n):a.appendChild(t);else if(o!==4&&(o===27&&ba(t.type)&&(a=t.stateNode),t=t.child,t!==null))for(Ml(t,n,a),t=t.sibling;t!==null;)Ml(t,n,a),t=t.sibling}function Xm(t){var n=t.stateNode,a=t.memoizedProps;try{for(var o=t.type,u=n.attributes;u.length;)n.removeAttributeNode(u[0]);Mn(n,o,a),n[an]=t,n[_n]=a}catch(f){Pe(t,t.return,f)}}var Wi=!1,ln=!1,nf=!1,Wm=typeof WeakSet=="function"?WeakSet:Set,mn=null;function Mx(t,n){if(t=t.containerInfo,Tf=kl,t=ip(t),jc(t)){if("selectionStart"in t)var a={start:t.selectionStart,end:t.selectionEnd};else t:{a=(a=t.ownerDocument)&&a.defaultView||window;var o=a.getSelection&&a.getSelection();if(o&&o.rangeCount!==0){a=o.anchorNode;var u=o.anchorOffset,f=o.focusNode;o=o.focusOffset;try{a.nodeType,f.nodeType}catch{a=null;break t}var x=0,b=-1,F=-1,it=0,ht=0,vt=t,st=null;e:for(;;){for(var ut;vt!==a||u!==0&&vt.nodeType!==3||(b=x+u),vt!==f||o!==0&&vt.nodeType!==3||(F=x+o),vt.nodeType===3&&(x+=vt.nodeValue.length),(ut=vt.firstChild)!==null;)st=vt,vt=ut;for(;;){if(vt===t)break e;if(st===a&&++it===u&&(b=x),st===f&&++ht===o&&(F=x),(ut=vt.nextSibling)!==null)break;vt=st,st=vt.parentNode}vt=ut}a=b===-1||F===-1?null:{start:b,end:F}}else a=null}a=a||{start:0,end:0}}else a=null;for(bf={focusedElem:t,selectionRange:a},kl=!1,mn=n;mn!==null;)if(n=mn,t=n.child,(n.subtreeFlags&1028)!==0&&t!==null)t.return=n,mn=t;else for(;mn!==null;){switch(n=mn,f=n.alternate,t=n.flags,n.tag){case 0:if((t&4)!==0&&(t=n.updateQueue,t=t!==null?t.events:null,t!==null))for(a=0;a<t.length;a++)u=t[a],u.ref.impl=u.nextImpl;break;case 11:case 15:break;case 1:if((t&1024)!==0&&f!==null){t=void 0,a=n,u=f.memoizedProps,f=f.memoizedState,o=a.stateNode;try{var Ht=ar(a.type,u);t=o.getSnapshotBeforeUpdate(Ht,f),o.__reactInternalSnapshotBeforeUpdate=t}catch(te){Pe(a,a.return,te)}}break;case 3:if((t&1024)!==0){if(t=n.stateNode.containerInfo,a=t.nodeType,a===9)Cf(t);else if(a===1)switch(t.nodeName){case"HEAD":case"HTML":case"BODY":Cf(t);break;default:t.textContent=""}}break;case 5:case 26:case 27:case 6:case 4:case 17:break;default:if((t&1024)!==0)throw Error(r(163))}if(t=n.sibling,t!==null){t.return=n.return,mn=t;break}mn=n.return}}function qm(t,n,a){var o=a.flags;switch(a.tag){case 0:case 11:case 15:Yi(t,a),o&4&&ro(5,a);break;case 1:if(Yi(t,a),o&4)if(t=a.stateNode,n===null)try{t.componentDidMount()}catch(x){Pe(a,a.return,x)}else{var u=ar(a.type,n.memoizedProps);n=n.memoizedState;try{t.componentDidUpdate(u,n,t.__reactInternalSnapshotBeforeUpdate)}catch(x){Pe(a,a.return,x)}}o&64&&Hm(a),o&512&&so(a,a.return);break;case 3:if(Yi(t,a),o&64&&(t=a.updateQueue,t!==null)){if(n=null,a.child!==null)switch(a.child.tag){case 27:case 5:n=a.child.stateNode;break;case 1:n=a.child.stateNode}try{Dp(t,n)}catch(x){Pe(a,a.return,x)}}break;case 27:n===null&&o&4&&Xm(a);case 26:case 5:Yi(t,a),n===null&&o&4&&Vm(a),o&512&&so(a,a.return);break;case 12:Yi(t,a);break;case 31:Yi(t,a),o&4&&jm(t,a);break;case 13:Yi(t,a),o&4&&Km(t,a),o&64&&(t=a.memoizedState,t!==null&&(t=t.dehydrated,t!==null&&(a=Ux.bind(null,a),Qx(t,a))));break;case 22:if(o=a.memoizedState!==null||Wi,!o){n=n!==null&&n.memoizedState!==null||ln,u=Wi;var f=ln;Wi=o,(ln=n)&&!f?Zi(t,a,(a.subtreeFlags&8772)!==0):Yi(t,a),Wi=u,ln=f}break;case 30:break;default:Yi(t,a)}}function Ym(t){var n=t.alternate;n!==null&&(t.alternate=null,Ym(n)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(n=t.stateNode,n!==null&&C(n)),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}var Ze=null,zn=!1;function qi(t,n,a){for(a=a.child;a!==null;)Zm(t,n,a),a=a.sibling}function Zm(t,n,a){if(Ct&&typeof Ct.onCommitFiberUnmount=="function")try{Ct.onCommitFiberUnmount(bt,a)}catch{}switch(a.tag){case 26:ln||Ai(a,n),qi(t,n,a),a.memoizedState?a.memoizedState.count--:a.stateNode&&(a=a.stateNode,a.parentNode.removeChild(a));break;case 27:ln||Ai(a,n);var o=Ze,u=zn;ba(a.type)&&(Ze=a.stateNode,zn=!1),qi(t,n,a),go(a.stateNode),Ze=o,zn=u;break;case 5:ln||Ai(a,n);case 6:if(o=Ze,u=zn,Ze=null,qi(t,n,a),Ze=o,zn=u,Ze!==null)if(zn)try{(Ze.nodeType===9?Ze.body:Ze.nodeName==="HTML"?Ze.ownerDocument.body:Ze).removeChild(a.stateNode)}catch(f){Pe(a,n,f)}else try{Ze.removeChild(a.stateNode)}catch(f){Pe(a,n,f)}break;case 18:Ze!==null&&(zn?(t=Ze,Hg(t.nodeType===9?t.body:t.nodeName==="HTML"?t.ownerDocument.body:t,a.stateNode),as(t)):Hg(Ze,a.stateNode));break;case 4:o=Ze,u=zn,Ze=a.stateNode.containerInfo,zn=!0,qi(t,n,a),Ze=o,zn=u;break;case 0:case 11:case 14:case 15:va(2,a,n),ln||va(4,a,n),qi(t,n,a);break;case 1:ln||(Ai(a,n),o=a.stateNode,typeof o.componentWillUnmount=="function"&&Gm(a,n,o)),qi(t,n,a);break;case 21:qi(t,n,a);break;case 22:ln=(o=ln)||a.memoizedState!==null,qi(t,n,a),ln=o;break;default:qi(t,n,a)}}function jm(t,n){if(n.memoizedState===null&&(t=n.alternate,t!==null&&(t=t.memoizedState,t!==null))){t=t.dehydrated;try{as(t)}catch(a){Pe(n,n.return,a)}}}function Km(t,n){if(n.memoizedState===null&&(t=n.alternate,t!==null&&(t=t.memoizedState,t!==null&&(t=t.dehydrated,t!==null))))try{as(t)}catch(a){Pe(n,n.return,a)}}function Ex(t){switch(t.tag){case 31:case 13:case 19:var n=t.stateNode;return n===null&&(n=t.stateNode=new Wm),n;case 22:return t=t.stateNode,n=t._retryCache,n===null&&(n=t._retryCache=new Wm),n;default:throw Error(r(435,t.tag))}}function El(t,n){var a=Ex(t);n.forEach(function(o){if(!a.has(o)){a.add(o);var u=Lx.bind(null,t,o);o.then(u,u)}})}function Pn(t,n){var a=n.deletions;if(a!==null)for(var o=0;o<a.length;o++){var u=a[o],f=t,x=n,b=x;t:for(;b!==null;){switch(b.tag){case 27:if(ba(b.type)){Ze=b.stateNode,zn=!1;break t}break;case 5:Ze=b.stateNode,zn=!1;break t;case 3:case 4:Ze=b.stateNode.containerInfo,zn=!0;break t}b=b.return}if(Ze===null)throw Error(r(160));Zm(f,x,u),Ze=null,zn=!1,f=u.alternate,f!==null&&(f.return=null),u.return=null}if(n.subtreeFlags&13886)for(n=n.child;n!==null;)Qm(n,t),n=n.sibling}var hi=null;function Qm(t,n){var a=t.alternate,o=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:Pn(n,t),Bn(t),o&4&&(va(3,t,t.return),ro(3,t),va(5,t,t.return));break;case 1:Pn(n,t),Bn(t),o&512&&(ln||a===null||Ai(a,a.return)),o&64&&Wi&&(t=t.updateQueue,t!==null&&(o=t.callbacks,o!==null&&(a=t.shared.hiddenCallbacks,t.shared.hiddenCallbacks=a===null?o:a.concat(o))));break;case 26:var u=hi;if(Pn(n,t),Bn(t),o&512&&(ln||a===null||Ai(a,a.return)),o&4){var f=a!==null?a.memoizedState:null;if(o=t.memoizedState,a===null)if(o===null)if(t.stateNode===null){t:{o=t.type,a=t.memoizedProps,u=u.ownerDocument||u;e:switch(o){case"title":f=u.getElementsByTagName("title")[0],(!f||f[ka]||f[an]||f.namespaceURI==="http://www.w3.org/2000/svg"||f.hasAttribute("itemprop"))&&(f=u.createElement(o),u.head.insertBefore(f,u.querySelector("head > title"))),Mn(f,o,a),f[an]=t,Mt(f),o=f;break t;case"link":var x=Qg("link","href",u).get(o+(a.href||""));if(x){for(var b=0;b<x.length;b++)if(f=x[b],f.getAttribute("href")===(a.href==null||a.href===""?null:a.href)&&f.getAttribute("rel")===(a.rel==null?null:a.rel)&&f.getAttribute("title")===(a.title==null?null:a.title)&&f.getAttribute("crossorigin")===(a.crossOrigin==null?null:a.crossOrigin)){x.splice(b,1);break e}}f=u.createElement(o),Mn(f,o,a),u.head.appendChild(f);break;case"meta":if(x=Qg("meta","content",u).get(o+(a.content||""))){for(b=0;b<x.length;b++)if(f=x[b],f.getAttribute("content")===(a.content==null?null:""+a.content)&&f.getAttribute("name")===(a.name==null?null:a.name)&&f.getAttribute("property")===(a.property==null?null:a.property)&&f.getAttribute("http-equiv")===(a.httpEquiv==null?null:a.httpEquiv)&&f.getAttribute("charset")===(a.charSet==null?null:a.charSet)){x.splice(b,1);break e}}f=u.createElement(o),Mn(f,o,a),u.head.appendChild(f);break;default:throw Error(r(468,o))}f[an]=t,Mt(f),o=f}t.stateNode=o}else Jg(u,t.type,t.stateNode);else t.stateNode=Kg(u,o,t.memoizedProps);else f!==o?(f===null?a.stateNode!==null&&(a=a.stateNode,a.parentNode.removeChild(a)):f.count--,o===null?Jg(u,t.type,t.stateNode):Kg(u,o,t.memoizedProps)):o===null&&t.stateNode!==null&&$u(t,t.memoizedProps,a.memoizedProps)}break;case 27:Pn(n,t),Bn(t),o&512&&(ln||a===null||Ai(a,a.return)),a!==null&&o&4&&$u(t,t.memoizedProps,a.memoizedProps);break;case 5:if(Pn(n,t),Bn(t),o&512&&(ln||a===null||Ai(a,a.return)),t.flags&32){u=t.stateNode;try{Rr(u,"")}catch(Ht){Pe(t,t.return,Ht)}}o&4&&t.stateNode!=null&&(u=t.memoizedProps,$u(t,u,a!==null?a.memoizedProps:u)),o&1024&&(nf=!0);break;case 6:if(Pn(n,t),Bn(t),o&4){if(t.stateNode===null)throw Error(r(162));o=t.memoizedProps,a=t.stateNode;try{a.nodeValue=o}catch(Ht){Pe(t,t.return,Ht)}}break;case 3:if(Il=null,u=hi,hi=Bl(n.containerInfo),Pn(n,t),hi=u,Bn(t),o&4&&a!==null&&a.memoizedState.isDehydrated)try{as(n.containerInfo)}catch(Ht){Pe(t,t.return,Ht)}nf&&(nf=!1,Jm(t));break;case 4:o=hi,hi=Bl(t.stateNode.containerInfo),Pn(n,t),Bn(t),hi=o;break;case 12:Pn(n,t),Bn(t);break;case 31:Pn(n,t),Bn(t),o&4&&(o=t.updateQueue,o!==null&&(t.updateQueue=null,El(t,o)));break;case 13:Pn(n,t),Bn(t),t.child.flags&8192&&t.memoizedState!==null!=(a!==null&&a.memoizedState!==null)&&(bl=E()),o&4&&(o=t.updateQueue,o!==null&&(t.updateQueue=null,El(t,o)));break;case 22:u=t.memoizedState!==null;var F=a!==null&&a.memoizedState!==null,it=Wi,ht=ln;if(Wi=it||u,ln=ht||F,Pn(n,t),ln=ht,Wi=it,Bn(t),o&8192)t:for(n=t.stateNode,n._visibility=u?n._visibility&-2:n._visibility|1,u&&(a===null||F||Wi||ln||rr(t)),a=null,n=t;;){if(n.tag===5||n.tag===26){if(a===null){F=a=n;try{if(f=F.stateNode,u)x=f.style,typeof x.setProperty=="function"?x.setProperty("display","none","important"):x.display="none";else{b=F.stateNode;var vt=F.memoizedProps.style,st=vt!=null&&vt.hasOwnProperty("display")?vt.display:null;b.style.display=st==null||typeof st=="boolean"?"":(""+st).trim()}}catch(Ht){Pe(F,F.return,Ht)}}}else if(n.tag===6){if(a===null){F=n;try{F.stateNode.nodeValue=u?"":F.memoizedProps}catch(Ht){Pe(F,F.return,Ht)}}}else if(n.tag===18){if(a===null){F=n;try{var ut=F.stateNode;u?Gg(ut,!0):Gg(F.stateNode,!1)}catch(Ht){Pe(F,F.return,Ht)}}}else if((n.tag!==22&&n.tag!==23||n.memoizedState===null||n===t)&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===t)break t;for(;n.sibling===null;){if(n.return===null||n.return===t)break t;a===n&&(a=null),n=n.return}a===n&&(a=null),n.sibling.return=n.return,n=n.sibling}o&4&&(o=t.updateQueue,o!==null&&(a=o.retryQueue,a!==null&&(o.retryQueue=null,El(t,a))));break;case 19:Pn(n,t),Bn(t),o&4&&(o=t.updateQueue,o!==null&&(t.updateQueue=null,El(t,o)));break;case 30:break;case 21:break;default:Pn(n,t),Bn(t)}}function Bn(t){var n=t.flags;if(n&2){try{for(var a,o=t.return;o!==null;){if(km(o)){a=o;break}o=o.return}if(a==null)throw Error(r(160));switch(a.tag){case 27:var u=a.stateNode,f=tf(t);Ml(t,f,u);break;case 5:var x=a.stateNode;a.flags&32&&(Rr(x,""),a.flags&=-33);var b=tf(t);Ml(t,b,x);break;case 3:case 4:var F=a.stateNode.containerInfo,it=tf(t);ef(t,it,F);break;default:throw Error(r(161))}}catch(ht){Pe(t,t.return,ht)}t.flags&=-3}n&4096&&(t.flags&=-4097)}function Jm(t){if(t.subtreeFlags&1024)for(t=t.child;t!==null;){var n=t;Jm(n),n.tag===5&&n.flags&1024&&n.stateNode.reset(),t=t.sibling}}function Yi(t,n){if(n.subtreeFlags&8772)for(n=n.child;n!==null;)qm(t,n.alternate,n),n=n.sibling}function rr(t){for(t=t.child;t!==null;){var n=t;switch(n.tag){case 0:case 11:case 14:case 15:va(4,n,n.return),rr(n);break;case 1:Ai(n,n.return);var a=n.stateNode;typeof a.componentWillUnmount=="function"&&Gm(n,n.return,a),rr(n);break;case 27:go(n.stateNode);case 26:case 5:Ai(n,n.return),rr(n);break;case 22:n.memoizedState===null&&rr(n);break;case 30:rr(n);break;default:rr(n)}t=t.sibling}}function Zi(t,n,a){for(a=a&&(n.subtreeFlags&8772)!==0,n=n.child;n!==null;){var o=n.alternate,u=t,f=n,x=f.flags;switch(f.tag){case 0:case 11:case 15:Zi(u,f,a),ro(4,f);break;case 1:if(Zi(u,f,a),o=f,u=o.stateNode,typeof u.componentDidMount=="function")try{u.componentDidMount()}catch(it){Pe(o,o.return,it)}if(o=f,u=o.updateQueue,u!==null){var b=o.stateNode;try{var F=u.shared.hiddenCallbacks;if(F!==null)for(u.shared.hiddenCallbacks=null,u=0;u<F.length;u++)wp(F[u],b)}catch(it){Pe(o,o.return,it)}}a&&x&64&&Hm(f),so(f,f.return);break;case 27:Xm(f);case 26:case 5:Zi(u,f,a),a&&o===null&&x&4&&Vm(f),so(f,f.return);break;case 12:Zi(u,f,a);break;case 31:Zi(u,f,a),a&&x&4&&jm(u,f);break;case 13:Zi(u,f,a),a&&x&4&&Km(u,f);break;case 22:f.memoizedState===null&&Zi(u,f,a),so(f,f.return);break;case 30:break;default:Zi(u,f,a)}n=n.sibling}}function af(t,n){var a=null;t!==null&&t.memoizedState!==null&&t.memoizedState.cachePool!==null&&(a=t.memoizedState.cachePool.pool),t=null,n.memoizedState!==null&&n.memoizedState.cachePool!==null&&(t=n.memoizedState.cachePool.pool),t!==a&&(t!=null&&t.refCount++,a!=null&&qs(a))}function rf(t,n){t=null,n.alternate!==null&&(t=n.alternate.memoizedState.cache),n=n.memoizedState.cache,n!==t&&(n.refCount++,t!=null&&qs(t))}function pi(t,n,a,o){if(n.subtreeFlags&10256)for(n=n.child;n!==null;)$m(t,n,a,o),n=n.sibling}function $m(t,n,a,o){var u=n.flags;switch(n.tag){case 0:case 11:case 15:pi(t,n,a,o),u&2048&&ro(9,n);break;case 1:pi(t,n,a,o);break;case 3:pi(t,n,a,o),u&2048&&(t=null,n.alternate!==null&&(t=n.alternate.memoizedState.cache),n=n.memoizedState.cache,n!==t&&(n.refCount++,t!=null&&qs(t)));break;case 12:if(u&2048){pi(t,n,a,o),t=n.stateNode;try{var f=n.memoizedProps,x=f.id,b=f.onPostCommit;typeof b=="function"&&b(x,n.alternate===null?"mount":"update",t.passiveEffectDuration,-0)}catch(F){Pe(n,n.return,F)}}else pi(t,n,a,o);break;case 31:pi(t,n,a,o);break;case 13:pi(t,n,a,o);break;case 23:break;case 22:f=n.stateNode,x=n.alternate,n.memoizedState!==null?f._visibility&2?pi(t,n,a,o):oo(t,n):f._visibility&2?pi(t,n,a,o):(f._visibility|=2,Yr(t,n,a,o,(n.subtreeFlags&10256)!==0||!1)),u&2048&&af(x,n);break;case 24:pi(t,n,a,o),u&2048&&rf(n.alternate,n);break;default:pi(t,n,a,o)}}function Yr(t,n,a,o,u){for(u=u&&((n.subtreeFlags&10256)!==0||!1),n=n.child;n!==null;){var f=t,x=n,b=a,F=o,it=x.flags;switch(x.tag){case 0:case 11:case 15:Yr(f,x,b,F,u),ro(8,x);break;case 23:break;case 22:var ht=x.stateNode;x.memoizedState!==null?ht._visibility&2?Yr(f,x,b,F,u):oo(f,x):(ht._visibility|=2,Yr(f,x,b,F,u)),u&&it&2048&&af(x.alternate,x);break;case 24:Yr(f,x,b,F,u),u&&it&2048&&rf(x.alternate,x);break;default:Yr(f,x,b,F,u)}n=n.sibling}}function oo(t,n){if(n.subtreeFlags&10256)for(n=n.child;n!==null;){var a=t,o=n,u=o.flags;switch(o.tag){case 22:oo(a,o),u&2048&&af(o.alternate,o);break;case 24:oo(a,o),u&2048&&rf(o.alternate,o);break;default:oo(a,o)}n=n.sibling}}var lo=8192;function Zr(t,n,a){if(t.subtreeFlags&lo)for(t=t.child;t!==null;)tg(t,n,a),t=t.sibling}function tg(t,n,a){switch(t.tag){case 26:Zr(t,n,a),t.flags&lo&&t.memoizedState!==null&&cS(a,hi,t.memoizedState,t.memoizedProps);break;case 5:Zr(t,n,a);break;case 3:case 4:var o=hi;hi=Bl(t.stateNode.containerInfo),Zr(t,n,a),hi=o;break;case 22:t.memoizedState===null&&(o=t.alternate,o!==null&&o.memoizedState!==null?(o=lo,lo=16777216,Zr(t,n,a),lo=o):Zr(t,n,a));break;default:Zr(t,n,a)}}function eg(t){var n=t.alternate;if(n!==null&&(t=n.child,t!==null)){n.child=null;do n=t.sibling,t.sibling=null,t=n;while(t!==null)}}function co(t){var n=t.deletions;if((t.flags&16)!==0){if(n!==null)for(var a=0;a<n.length;a++){var o=n[a];mn=o,ig(o,t)}eg(t)}if(t.subtreeFlags&10256)for(t=t.child;t!==null;)ng(t),t=t.sibling}function ng(t){switch(t.tag){case 0:case 11:case 15:co(t),t.flags&2048&&va(9,t,t.return);break;case 3:co(t);break;case 12:co(t);break;case 22:var n=t.stateNode;t.memoizedState!==null&&n._visibility&2&&(t.return===null||t.return.tag!==13)?(n._visibility&=-3,Tl(t)):co(t);break;default:co(t)}}function Tl(t){var n=t.deletions;if((t.flags&16)!==0){if(n!==null)for(var a=0;a<n.length;a++){var o=n[a];mn=o,ig(o,t)}eg(t)}for(t=t.child;t!==null;){switch(n=t,n.tag){case 0:case 11:case 15:va(8,n,n.return),Tl(n);break;case 22:a=n.stateNode,a._visibility&2&&(a._visibility&=-3,Tl(n));break;default:Tl(n)}t=t.sibling}}function ig(t,n){for(;mn!==null;){var a=mn;switch(a.tag){case 0:case 11:case 15:va(8,a,n);break;case 23:case 22:if(a.memoizedState!==null&&a.memoizedState.cachePool!==null){var o=a.memoizedState.cachePool.pool;o!=null&&o.refCount++}break;case 24:qs(a.memoizedState.cache)}if(o=a.child,o!==null)o.return=a,mn=o;else t:for(a=t;mn!==null;){o=mn;var u=o.sibling,f=o.return;if(Ym(o),o===a){mn=null;break t}if(u!==null){u.return=f,mn=u;break t}mn=f}}}var Tx={getCacheForType:function(t){var n=Sn(rn),a=n.data.get(t);return a===void 0&&(a=t(),n.data.set(t,a)),a},cacheSignal:function(){return Sn(rn).controller.signal}},bx=typeof WeakMap=="function"?WeakMap:Map,De=0,ke=null,ge=null,xe=0,ze=0,Zn=null,xa=!1,jr=!1,sf=!1,ji=0,Qe=0,Sa=0,sr=0,of=0,jn=0,Kr=0,uo=null,Fn=null,lf=!1,bl=0,ag=0,Al=1/0,Rl=null,ya=null,fn=0,Ma=null,Qr=null,Ki=0,cf=0,uf=null,rg=null,fo=0,ff=null;function Kn(){return(De&2)!==0&&xe!==0?xe&-xe:B.T!==null?_f():Va()}function sg(){if(jn===0)if((xe&536870912)===0||Me){var t=wt;wt<<=1,(wt&3932160)===0&&(wt=262144),jn=t}else jn=536870912;return t=qn.current,t!==null&&(t.flags|=32),jn}function In(t,n,a){(t===ke&&(ze===2||ze===9)||t.cancelPendingCommit!==null)&&(Jr(t,0),Ea(t,xe,jn,!1)),wn(t,a),((De&2)===0||t!==ke)&&(t===ke&&((De&2)===0&&(sr|=a),Qe===4&&Ea(t,xe,jn,!1)),Ri(t))}function og(t,n,a){if((De&6)!==0)throw Error(r(327));var o=!a&&(n&127)===0&&(n&t.expiredLanes)===0||It(t,n),u=o?Cx(t,n):hf(t,n,!0),f=o;do{if(u===0){jr&&!o&&Ea(t,n,0,!1);break}else{if(a=t.current.alternate,f&&!Ax(a)){u=hf(t,n,!1),f=!1;continue}if(u===2){if(f=n,t.errorRecoveryDisabledLanes&f)var x=0;else x=t.pendingLanes&-536870913,x=x!==0?x:x&536870912?536870912:0;if(x!==0){n=x;t:{var b=t;u=uo;var F=b.current.memoizedState.isDehydrated;if(F&&(Jr(b,x).flags|=256),x=hf(b,x,!1),x!==2){if(sf&&!F){b.errorRecoveryDisabledLanes|=f,sr|=f,u=4;break t}f=Fn,Fn=u,f!==null&&(Fn===null?Fn=f:Fn.push.apply(Fn,f))}u=x}if(f=!1,u!==2)continue}}if(u===1){Jr(t,0),Ea(t,n,0,!0);break}t:{switch(o=t,f=u,f){case 0:case 1:throw Error(r(345));case 4:if((n&4194048)!==n)break;case 6:Ea(o,n,jn,!xa);break t;case 2:Fn=null;break;case 3:case 5:break;default:throw Error(r(329))}if((n&62914560)===n&&(u=bl+300-E(),10<u)){if(Ea(o,n,jn,!xa),xt(o,0,!0)!==0)break t;Ki=n,o.timeoutHandle=Fg(lg.bind(null,o,a,Fn,Rl,lf,n,jn,sr,Kr,xa,f,"Throttled",-0,0),u);break t}lg(o,a,Fn,Rl,lf,n,jn,sr,Kr,xa,f,null,-0,0)}}break}while(!0);Ri(t)}function lg(t,n,a,o,u,f,x,b,F,it,ht,vt,st,ut){if(t.timeoutHandle=-1,vt=n.subtreeFlags,vt&8192||(vt&16785408)===16785408){vt={stylesheets:null,count:0,imgCount:0,imgBytes:0,suspenseyImages:[],waitingForImages:!0,waitingForViewTransition:!1,unsuspend:zi},tg(n,f,vt);var Ht=(f&62914560)===f?bl-E():(f&4194048)===f?ag-E():0;if(Ht=uS(vt,Ht),Ht!==null){Ki=f,t.cancelPendingCommit=Ht(gg.bind(null,t,n,f,a,o,u,x,b,F,ht,vt,null,st,ut)),Ea(t,f,x,!it);return}}gg(t,n,f,a,o,u,x,b,F)}function Ax(t){for(var n=t;;){var a=n.tag;if((a===0||a===11||a===15)&&n.flags&16384&&(a=n.updateQueue,a!==null&&(a=a.stores,a!==null)))for(var o=0;o<a.length;o++){var u=a[o],f=u.getSnapshot;u=u.value;try{if(!Xn(f(),u))return!1}catch{return!1}}if(a=n.child,n.subtreeFlags&16384&&a!==null)a.return=n,n=a;else{if(n===t)break;for(;n.sibling===null;){if(n.return===null||n.return===t)return!0;n=n.return}n.sibling.return=n.return,n=n.sibling}}return!0}function Ea(t,n,a,o){n&=~of,n&=~sr,t.suspendedLanes|=n,t.pingedLanes&=~n,o&&(t.warmLanes|=n),o=t.expirationTimes;for(var u=n;0<u;){var f=31-Pt(u),x=1<<f;o[f]=-1,u&=~x}a!==0&&Ls(t,a,n)}function Cl(){return(De&6)===0?(ho(0),!1):!0}function df(){if(ge!==null){if(ze===0)var t=ge.return;else t=ge,Ii=Qa=null,Ru(t),Vr=null,Zs=0,t=ge;for(;t!==null;)Im(t.alternate,t),t=t.return;ge=null}}function Jr(t,n){var a=t.timeoutHandle;a!==-1&&(t.timeoutHandle=-1,qx(a)),a=t.cancelPendingCommit,a!==null&&(t.cancelPendingCommit=null,a()),Ki=0,df(),ke=t,ge=a=Bi(t.current,null),xe=n,ze=0,Zn=null,xa=!1,jr=It(t,n),sf=!1,Kr=jn=of=sr=Sa=Qe=0,Fn=uo=null,lf=!1,(n&8)!==0&&(n|=n&32);var o=t.entangledLanes;if(o!==0)for(t=t.entanglements,o&=n;0<o;){var u=31-Pt(o),f=1<<u;n|=t[u],o&=~f}return ji=n,jo(),a}function cg(t,n){se=null,B.H=no,n===Gr||n===il?(n=bp(),ze=3):n===mu?(n=bp(),ze=4):ze=n===ku?8:n!==null&&typeof n=="object"&&typeof n.then=="function"?6:1,Zn=n,ge===null&&(Qe=1,_l(t,ni(n,t.current)))}function ug(){var t=qn.current;return t===null?!0:(xe&4194048)===xe?si===null:(xe&62914560)===xe||(xe&536870912)!==0?t===si:!1}function fg(){var t=B.H;return B.H=no,t===null?no:t}function dg(){var t=B.A;return B.A=Tx,t}function wl(){Qe=4,xa||(xe&4194048)!==xe&&qn.current!==null||(jr=!0),(Sa&134217727)===0&&(sr&134217727)===0||ke===null||Ea(ke,xe,jn,!1)}function hf(t,n,a){var o=De;De|=2;var u=fg(),f=dg();(ke!==t||xe!==n)&&(Rl=null,Jr(t,n)),n=!1;var x=Qe;t:do try{if(ze!==0&&ge!==null){var b=ge,F=Zn;switch(ze){case 8:df(),x=6;break t;case 3:case 2:case 9:case 6:qn.current===null&&(n=!0);var it=ze;if(ze=0,Zn=null,$r(t,b,F,it),a&&jr){x=0;break t}break;default:it=ze,ze=0,Zn=null,$r(t,b,F,it)}}Rx(),x=Qe;break}catch(ht){cg(t,ht)}while(!0);return n&&t.shellSuspendCounter++,Ii=Qa=null,De=o,B.H=u,B.A=f,ge===null&&(ke=null,xe=0,jo()),x}function Rx(){for(;ge!==null;)hg(ge)}function Cx(t,n){var a=De;De|=2;var o=fg(),u=dg();ke!==t||xe!==n?(Rl=null,Al=E()+500,Jr(t,n)):jr=It(t,n);t:do try{if(ze!==0&&ge!==null){n=ge;var f=Zn;e:switch(ze){case 1:ze=0,Zn=null,$r(t,n,f,1);break;case 2:case 9:if(Ep(f)){ze=0,Zn=null,pg(n);break}n=function(){ze!==2&&ze!==9||ke!==t||(ze=7),Ri(t)},f.then(n,n);break t;case 3:ze=7;break t;case 4:ze=5;break t;case 7:Ep(f)?(ze=0,Zn=null,pg(n)):(ze=0,Zn=null,$r(t,n,f,7));break;case 5:var x=null;switch(ge.tag){case 26:x=ge.memoizedState;case 5:case 27:var b=ge;if(x?$g(x):b.stateNode.complete){ze=0,Zn=null;var F=b.sibling;if(F!==null)ge=F;else{var it=b.return;it!==null?(ge=it,Dl(it)):ge=null}break e}}ze=0,Zn=null,$r(t,n,f,5);break;case 6:ze=0,Zn=null,$r(t,n,f,6);break;case 8:df(),Qe=6;break t;default:throw Error(r(462))}}wx();break}catch(ht){cg(t,ht)}while(!0);return Ii=Qa=null,B.H=o,B.A=u,De=a,ge!==null?0:(ke=null,xe=0,jo(),Qe)}function wx(){for(;ge!==null&&!je();)hg(ge)}function hg(t){var n=Bm(t.alternate,t,ji);t.memoizedProps=t.pendingProps,n===null?Dl(t):ge=n}function pg(t){var n=t,a=n.alternate;switch(n.tag){case 15:case 0:n=Um(a,n,n.pendingProps,n.type,void 0,xe);break;case 11:n=Um(a,n,n.pendingProps,n.type.render,n.ref,xe);break;case 5:Ru(n);default:Im(a,n),n=ge=dp(n,ji),n=Bm(a,n,ji)}t.memoizedProps=t.pendingProps,n===null?Dl(t):ge=n}function $r(t,n,a,o){Ii=Qa=null,Ru(n),Vr=null,Zs=0;var u=n.return;try{if(_x(t,u,n,a,xe)){Qe=1,_l(t,ni(a,t.current)),ge=null;return}}catch(f){if(u!==null)throw ge=u,f;Qe=1,_l(t,ni(a,t.current)),ge=null;return}n.flags&32768?(Me||o===1?t=!0:jr||(xe&536870912)!==0?t=!1:(xa=t=!0,(o===2||o===9||o===3||o===6)&&(o=qn.current,o!==null&&o.tag===13&&(o.flags|=16384))),mg(n,t)):Dl(n)}function Dl(t){var n=t;do{if((n.flags&32768)!==0){mg(n,xa);return}t=n.return;var a=Sx(n.alternate,n,ji);if(a!==null){ge=a;return}if(n=n.sibling,n!==null){ge=n;return}ge=n=t}while(n!==null);Qe===0&&(Qe=5)}function mg(t,n){do{var a=yx(t.alternate,t);if(a!==null){a.flags&=32767,ge=a;return}if(a=t.return,a!==null&&(a.flags|=32768,a.subtreeFlags=0,a.deletions=null),!n&&(t=t.sibling,t!==null)){ge=t;return}ge=t=a}while(t!==null);Qe=6,ge=null}function gg(t,n,a,o,u,f,x,b,F){t.cancelPendingCommit=null;do Ul();while(fn!==0);if((De&6)!==0)throw Error(r(327));if(n!==null){if(n===t.current)throw Error(r(177));if(f=n.lanes|n.childLanes,f|=tu,ti(t,a,f,x,b,F),t===ke&&(ge=ke=null,xe=0),Qr=n,Ma=t,Ki=a,cf=f,uf=u,rg=o,(n.subtreeFlags&10256)!==0||(n.flags&10256)!==0?(t.callbackNode=null,t.callbackPriority=0,Nx(dt,function(){return yg(),null})):(t.callbackNode=null,t.callbackPriority=0),o=(n.flags&13878)!==0,(n.subtreeFlags&13878)!==0||o){o=B.T,B.T=null,u=q.p,q.p=2,x=De,De|=4;try{Mx(t,n,a)}finally{De=x,q.p=u,B.T=o}}fn=1,_g(),vg(),xg()}}function _g(){if(fn===1){fn=0;var t=Ma,n=Qr,a=(n.flags&13878)!==0;if((n.subtreeFlags&13878)!==0||a){a=B.T,B.T=null;var o=q.p;q.p=2;var u=De;De|=4;try{Qm(n,t);var f=bf,x=ip(t.containerInfo),b=f.focusedElem,F=f.selectionRange;if(x!==b&&b&&b.ownerDocument&&np(b.ownerDocument.documentElement,b)){if(F!==null&&jc(b)){var it=F.start,ht=F.end;if(ht===void 0&&(ht=it),"selectionStart"in b)b.selectionStart=it,b.selectionEnd=Math.min(ht,b.value.length);else{var vt=b.ownerDocument||document,st=vt&&vt.defaultView||window;if(st.getSelection){var ut=st.getSelection(),Ht=b.textContent.length,te=Math.min(F.start,Ht),He=F.end===void 0?te:Math.min(F.end,Ht);!ut.extend&&te>He&&(x=He,He=te,te=x);var Q=ep(b,te),k=ep(b,He);if(Q&&k&&(ut.rangeCount!==1||ut.anchorNode!==Q.node||ut.anchorOffset!==Q.offset||ut.focusNode!==k.node||ut.focusOffset!==k.offset)){var nt=vt.createRange();nt.setStart(Q.node,Q.offset),ut.removeAllRanges(),te>He?(ut.addRange(nt),ut.extend(k.node,k.offset)):(nt.setEnd(k.node,k.offset),ut.addRange(nt))}}}}for(vt=[],ut=b;ut=ut.parentNode;)ut.nodeType===1&&vt.push({element:ut,left:ut.scrollLeft,top:ut.scrollTop});for(typeof b.focus=="function"&&b.focus(),b=0;b<vt.length;b++){var _t=vt[b];_t.element.scrollLeft=_t.left,_t.element.scrollTop=_t.top}}kl=!!Tf,bf=Tf=null}finally{De=u,q.p=o,B.T=a}}t.current=n,fn=2}}function vg(){if(fn===2){fn=0;var t=Ma,n=Qr,a=(n.flags&8772)!==0;if((n.subtreeFlags&8772)!==0||a){a=B.T,B.T=null;var o=q.p;q.p=2;var u=De;De|=4;try{qm(t,n.alternate,n)}finally{De=u,q.p=o,B.T=a}}fn=3}}function xg(){if(fn===4||fn===3){fn=0,O();var t=Ma,n=Qr,a=Ki,o=rg;(n.subtreeFlags&10256)!==0||(n.flags&10256)!==0?fn=5:(fn=0,Qr=Ma=null,Sg(t,t.pendingLanes));var u=t.pendingLanes;if(u===0&&(ya=null),br(a),n=n.stateNode,Ct&&typeof Ct.onCommitFiberRoot=="function")try{Ct.onCommitFiberRoot(bt,n,void 0,(n.current.flags&128)===128)}catch{}if(o!==null){n=B.T,u=q.p,q.p=2,B.T=null;try{for(var f=t.onRecoverableError,x=0;x<o.length;x++){var b=o[x];f(b.value,{componentStack:b.stack})}}finally{B.T=n,q.p=u}}(Ki&3)!==0&&Ul(),Ri(t),u=t.pendingLanes,(a&261930)!==0&&(u&42)!==0?t===ff?fo++:(fo=0,ff=t):fo=0,ho(0)}}function Sg(t,n){(t.pooledCacheLanes&=n)===0&&(n=t.pooledCache,n!=null&&(t.pooledCache=null,qs(n)))}function Ul(){return _g(),vg(),xg(),yg()}function yg(){if(fn!==5)return!1;var t=Ma,n=cf;cf=0;var a=br(Ki),o=B.T,u=q.p;try{q.p=32>a?32:a,B.T=null,a=uf,uf=null;var f=Ma,x=Ki;if(fn=0,Qr=Ma=null,Ki=0,(De&6)!==0)throw Error(r(331));var b=De;if(De|=4,ng(f.current),$m(f,f.current,x,a),De=b,ho(0,!1),Ct&&typeof Ct.onPostCommitFiberRoot=="function")try{Ct.onPostCommitFiberRoot(bt,f)}catch{}return!0}finally{q.p=u,B.T=o,Sg(t,n)}}function Mg(t,n,a){n=ni(a,n),n=Vu(t.stateNode,n,2),t=ma(t,n,2),t!==null&&(wn(t,2),Ri(t))}function Pe(t,n,a){if(t.tag===3)Mg(t,t,a);else for(;n!==null;){if(n.tag===3){Mg(n,t,a);break}else if(n.tag===1){var o=n.stateNode;if(typeof n.type.getDerivedStateFromError=="function"||typeof o.componentDidCatch=="function"&&(ya===null||!ya.has(o))){t=ni(a,t),a=Em(2),o=ma(n,a,2),o!==null&&(Tm(a,o,n,t),wn(o,2),Ri(o));break}}n=n.return}}function pf(t,n,a){var o=t.pingCache;if(o===null){o=t.pingCache=new bx;var u=new Set;o.set(n,u)}else u=o.get(n),u===void 0&&(u=new Set,o.set(n,u));u.has(a)||(sf=!0,u.add(a),t=Dx.bind(null,t,n,a),n.then(t,t))}function Dx(t,n,a){var o=t.pingCache;o!==null&&o.delete(n),t.pingedLanes|=t.suspendedLanes&a,t.warmLanes&=~a,ke===t&&(xe&a)===a&&(Qe===4||Qe===3&&(xe&62914560)===xe&&300>E()-bl?(De&2)===0&&Jr(t,0):of|=a,Kr===xe&&(Kr=0)),Ri(t)}function Eg(t,n){n===0&&(n=Oe()),t=Za(t,n),t!==null&&(wn(t,n),Ri(t))}function Ux(t){var n=t.memoizedState,a=0;n!==null&&(a=n.retryLane),Eg(t,a)}function Lx(t,n){var a=0;switch(t.tag){case 31:case 13:var o=t.stateNode,u=t.memoizedState;u!==null&&(a=u.retryLane);break;case 19:o=t.stateNode;break;case 22:o=t.stateNode._retryCache;break;default:throw Error(r(314))}o!==null&&o.delete(n),Eg(t,a)}function Nx(t,n){return ne(t,n)}var Ll=null,ts=null,mf=!1,Nl=!1,gf=!1,Ta=0;function Ri(t){t!==ts&&t.next===null&&(ts===null?Ll=ts=t:ts=ts.next=t),Nl=!0,mf||(mf=!0,zx())}function ho(t,n){if(!gf&&Nl){gf=!0;do for(var a=!1,o=Ll;o!==null;){if(t!==0){var u=o.pendingLanes;if(u===0)var f=0;else{var x=o.suspendedLanes,b=o.pingedLanes;f=(1<<31-Pt(42|t)+1)-1,f&=u&~(x&~b),f=f&201326741?f&201326741|1:f?f|2:0}f!==0&&(a=!0,Rg(o,f))}else f=xe,f=xt(o,o===ke?f:0,o.cancelPendingCommit!==null||o.timeoutHandle!==-1),(f&3)===0||It(o,f)||(a=!0,Rg(o,f));o=o.next}while(a);gf=!1}}function Ox(){Tg()}function Tg(){Nl=mf=!1;var t=0;Ta!==0&&Wx()&&(t=Ta);for(var n=E(),a=null,o=Ll;o!==null;){var u=o.next,f=bg(o,n);f===0?(o.next=null,a===null?Ll=u:a.next=u,u===null&&(ts=a)):(a=o,(t!==0||(f&3)!==0)&&(Nl=!0)),o=u}fn!==0&&fn!==5||ho(t),Ta!==0&&(Ta=0)}function bg(t,n){for(var a=t.suspendedLanes,o=t.pingedLanes,u=t.expirationTimes,f=t.pendingLanes&-62914561;0<f;){var x=31-Pt(f),b=1<<x,F=u[x];F===-1?((b&a)===0||(b&o)!==0)&&(u[x]=ie(b,n)):F<=n&&(t.expiredLanes|=b),f&=~b}if(n=ke,a=xe,a=xt(t,t===n?a:0,t.cancelPendingCommit!==null||t.timeoutHandle!==-1),o=t.callbackNode,a===0||t===n&&(ze===2||ze===9)||t.cancelPendingCommit!==null)return o!==null&&o!==null&&We(o),t.callbackNode=null,t.callbackPriority=0;if((a&3)===0||It(t,a)){if(n=a&-a,n===t.callbackPriority)return n;switch(o!==null&&We(o),br(a)){case 2:case 8:a=Et;break;case 32:a=dt;break;case 268435456:a=Rt;break;default:a=dt}return o=Ag.bind(null,t),a=ne(a,o),t.callbackPriority=n,t.callbackNode=a,n}return o!==null&&o!==null&&We(o),t.callbackPriority=2,t.callbackNode=null,2}function Ag(t,n){if(fn!==0&&fn!==5)return t.callbackNode=null,t.callbackPriority=0,null;var a=t.callbackNode;if(Ul()&&t.callbackNode!==a)return null;var o=xe;return o=xt(t,t===ke?o:0,t.cancelPendingCommit!==null||t.timeoutHandle!==-1),o===0?null:(og(t,o,n),bg(t,E()),t.callbackNode!=null&&t.callbackNode===a?Ag.bind(null,t):null)}function Rg(t,n){if(Ul())return null;og(t,n,!0)}function zx(){Yx(function(){(De&6)!==0?ne(gt,Ox):Tg()})}function _f(){if(Ta===0){var t=Ir;t===0&&(t=At,At<<=1,(At&261888)===0&&(At=256)),Ta=t}return Ta}function Cg(t){return t==null||typeof t=="symbol"||typeof t=="boolean"?null:typeof t=="function"?t:Go(""+t)}function wg(t,n){var a=n.ownerDocument.createElement("input");return a.name=n.name,a.value=n.value,t.id&&a.setAttribute("form",t.id),n.parentNode.insertBefore(a,n),t=new FormData(t),a.parentNode.removeChild(a),t}function Px(t,n,a,o,u){if(n==="submit"&&a&&a.stateNode===u){var f=Cg((u[_n]||null).action),x=o.submitter;x&&(n=(n=x[_n]||null)?Cg(n.formAction):x.getAttribute("formAction"),n!==null&&(f=n,x=null));var b=new Wo("action","action",null,o,u);t.push({event:b,listeners:[{instance:null,listener:function(){if(o.defaultPrevented){if(Ta!==0){var F=x?wg(u,x):new FormData(u);Pu(a,{pending:!0,data:F,method:u.method,action:f},null,F)}}else typeof f=="function"&&(b.preventDefault(),F=x?wg(u,x):new FormData(u),Pu(a,{pending:!0,data:F,method:u.method,action:f},f,F))},currentTarget:u}]})}}for(var vf=0;vf<$c.length;vf++){var xf=$c[vf],Bx=xf.toLowerCase(),Fx=xf[0].toUpperCase()+xf.slice(1);di(Bx,"on"+Fx)}di(sp,"onAnimationEnd"),di(op,"onAnimationIteration"),di(lp,"onAnimationStart"),di("dblclick","onDoubleClick"),di("focusin","onFocus"),di("focusout","onBlur"),di(tx,"onTransitionRun"),di(ex,"onTransitionStart"),di(nx,"onTransitionCancel"),di(cp,"onTransitionEnd"),Kt("onMouseEnter",["mouseout","mouseover"]),Kt("onMouseLeave",["mouseout","mouseover"]),Kt("onPointerEnter",["pointerout","pointerover"]),Kt("onPointerLeave",["pointerout","pointerover"]),zt("onChange","change click focusin focusout input keydown keyup selectionchange".split(" ")),zt("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")),zt("onBeforeInput",["compositionend","keypress","textInput","paste"]),zt("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" ")),zt("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" ")),zt("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var po="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),Ix=new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(po));function Dg(t,n){n=(n&4)!==0;for(var a=0;a<t.length;a++){var o=t[a],u=o.event;o=o.listeners;t:{var f=void 0;if(n)for(var x=o.length-1;0<=x;x--){var b=o[x],F=b.instance,it=b.currentTarget;if(b=b.listener,F!==f&&u.isPropagationStopped())break t;f=b,u.currentTarget=it;try{f(u)}catch(ht){Zo(ht)}u.currentTarget=null,f=F}else for(x=0;x<o.length;x++){if(b=o[x],F=b.instance,it=b.currentTarget,b=b.listener,F!==f&&u.isPropagationStopped())break t;f=b,u.currentTarget=it;try{f(u)}catch(ht){Zo(ht)}u.currentTarget=null,f=F}}}}function _e(t,n){var a=n[Os];a===void 0&&(a=n[Os]=new Set);var o=t+"__bubble";a.has(o)||(Ug(n,t,2,!1),a.add(o))}function Sf(t,n,a){var o=0;n&&(o|=4),Ug(a,t,o,n)}var Ol="_reactListening"+Math.random().toString(36).slice(2);function yf(t){if(!t[Ol]){t[Ol]=!0,Nt.forEach(function(a){a!=="selectionchange"&&(Ix.has(a)||Sf(a,!1,t),Sf(a,!0,t))});var n=t.nodeType===9?t:t.ownerDocument;n===null||n[Ol]||(n[Ol]=!0,Sf("selectionchange",!1,n))}}function Ug(t,n,a,o){switch(s0(n)){case 2:var u=hS;break;case 8:u=pS;break;default:u=Pf}a=u.bind(null,n,a,t),u=void 0,!Hc||n!=="touchstart"&&n!=="touchmove"&&n!=="wheel"||(u=!0),o?u!==void 0?t.addEventListener(n,a,{capture:!0,passive:u}):t.addEventListener(n,a,!0):u!==void 0?t.addEventListener(n,a,{passive:u}):t.addEventListener(n,a,!1)}function Mf(t,n,a,o,u){var f=o;if((n&1)===0&&(n&2)===0&&o!==null)t:for(;;){if(o===null)return;var x=o.tag;if(x===3||x===4){var b=o.stateNode.containerInfo;if(b===u)break;if(x===4)for(x=o.return;x!==null;){var F=x.tag;if((F===3||F===4)&&x.stateNode.containerInfo===u)return;x=x.return}for(;b!==null;){if(x=Z(b),x===null)return;if(F=x.tag,F===5||F===6||F===26||F===27){o=f=x;continue t}b=b.parentNode}}o=o.return}Ph(function(){var it=f,ht=Fc(a),vt=[];t:{var st=up.get(t);if(st!==void 0){var ut=Wo,Ht=t;switch(t){case"keypress":if(ko(a)===0)break t;case"keydown":case"keyup":ut=Lv;break;case"focusin":Ht="focus",ut=Xc;break;case"focusout":Ht="blur",ut=Xc;break;case"beforeblur":case"afterblur":ut=Xc;break;case"click":if(a.button===2)break t;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":ut=Ih;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":ut=Sv;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":ut=zv;break;case sp:case op:case lp:ut=Ev;break;case cp:ut=Bv;break;case"scroll":case"scrollend":ut=vv;break;case"wheel":ut=Iv;break;case"copy":case"cut":case"paste":ut=bv;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":ut=Gh;break;case"toggle":case"beforetoggle":ut=Gv}var te=(n&4)!==0,He=!te&&(t==="scroll"||t==="scrollend"),Q=te?st!==null?st+"Capture":null:st;te=[];for(var k=it,nt;k!==null;){var _t=k;if(nt=_t.stateNode,_t=_t.tag,_t!==5&&_t!==26&&_t!==27||nt===null||Q===null||(_t=zs(k,Q),_t!=null&&te.push(mo(k,_t,nt))),He)break;k=k.return}0<te.length&&(st=new ut(st,Ht,null,a,ht),vt.push({event:st,listeners:te}))}}if((n&7)===0){t:{if(st=t==="mouseover"||t==="pointerover",ut=t==="mouseout"||t==="pointerout",st&&a!==Bc&&(Ht=a.relatedTarget||a.fromElement)&&(Z(Ht)||Ht[oa]))break t;if((ut||st)&&(st=ht.window===ht?ht:(st=ht.ownerDocument)?st.defaultView||st.parentWindow:window,ut?(Ht=a.relatedTarget||a.toElement,ut=it,Ht=Ht?Z(Ht):null,Ht!==null&&(He=c(Ht),te=Ht.tag,Ht!==He||te!==5&&te!==27&&te!==6)&&(Ht=null)):(ut=null,Ht=it),ut!==Ht)){if(te=Ih,_t="onMouseLeave",Q="onMouseEnter",k="mouse",(t==="pointerout"||t==="pointerover")&&(te=Gh,_t="onPointerLeave",Q="onPointerEnter",k="pointer"),He=ut==null?st:lt(ut),nt=Ht==null?st:lt(Ht),st=new te(_t,k+"leave",ut,a,ht),st.target=He,st.relatedTarget=nt,_t=null,Z(ht)===it&&(te=new te(Q,k+"enter",Ht,a,ht),te.target=nt,te.relatedTarget=He,_t=te),He=_t,ut&&Ht)e:{for(te=Hx,Q=ut,k=Ht,nt=0,_t=Q;_t;_t=te(_t))nt++;_t=0;for(var Jt=k;Jt;Jt=te(Jt))_t++;for(;0<nt-_t;)Q=te(Q),nt--;for(;0<_t-nt;)k=te(k),_t--;for(;nt--;){if(Q===k||k!==null&&Q===k.alternate){te=Q;break e}Q=te(Q),k=te(k)}te=null}else te=null;ut!==null&&Lg(vt,st,ut,te,!1),Ht!==null&&He!==null&&Lg(vt,He,Ht,te,!0)}}t:{if(st=it?lt(it):window,ut=st.nodeName&&st.nodeName.toLowerCase(),ut==="select"||ut==="input"&&st.type==="file")var Re=jh;else if(Yh(st))if(Kh)Re=Qv;else{Re=jv;var kt=Zv}else ut=st.nodeName,!ut||ut.toLowerCase()!=="input"||st.type!=="checkbox"&&st.type!=="radio"?it&&Pc(it.elementType)&&(Re=jh):Re=Kv;if(Re&&(Re=Re(t,it))){Zh(vt,Re,a,ht);break t}kt&&kt(t,st,it),t==="focusout"&&it&&st.type==="number"&&it.memoizedProps.value!=null&&un(st,"number",st.value)}switch(kt=it?lt(it):window,t){case"focusin":(Yh(kt)||kt.contentEditable==="true")&&(Ur=kt,Kc=it,ks=null);break;case"focusout":ks=Kc=Ur=null;break;case"mousedown":Qc=!0;break;case"contextmenu":case"mouseup":case"dragend":Qc=!1,ap(vt,a,ht);break;case"selectionchange":if($v)break;case"keydown":case"keyup":ap(vt,a,ht)}var le;if(qc)t:{switch(t){case"compositionstart":var Se="onCompositionStart";break t;case"compositionend":Se="onCompositionEnd";break t;case"compositionupdate":Se="onCompositionUpdate";break t}Se=void 0}else Dr?Wh(t,a)&&(Se="onCompositionEnd"):t==="keydown"&&a.keyCode===229&&(Se="onCompositionStart");Se&&(Vh&&a.locale!=="ko"&&(Dr||Se!=="onCompositionStart"?Se==="onCompositionEnd"&&Dr&&(le=Bh()):(la=ht,Gc="value"in la?la.value:la.textContent,Dr=!0)),kt=zl(it,Se),0<kt.length&&(Se=new Hh(Se,t,null,a,ht),vt.push({event:Se,listeners:kt}),le?Se.data=le:(le=qh(a),le!==null&&(Se.data=le)))),(le=kv?Xv(t,a):Wv(t,a))&&(Se=zl(it,"onBeforeInput"),0<Se.length&&(kt=new Hh("onBeforeInput","beforeinput",null,a,ht),vt.push({event:kt,listeners:Se}),kt.data=le)),Px(vt,t,it,a,ht)}Dg(vt,n)})}function mo(t,n,a){return{instance:t,listener:n,currentTarget:a}}function zl(t,n){for(var a=n+"Capture",o=[];t!==null;){var u=t,f=u.stateNode;if(u=u.tag,u!==5&&u!==26&&u!==27||f===null||(u=zs(t,a),u!=null&&o.unshift(mo(t,u,f)),u=zs(t,n),u!=null&&o.push(mo(t,u,f))),t.tag===3)return o;t=t.return}return[]}function Hx(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5&&t.tag!==27);return t||null}function Lg(t,n,a,o,u){for(var f=n._reactName,x=[];a!==null&&a!==o;){var b=a,F=b.alternate,it=b.stateNode;if(b=b.tag,F!==null&&F===o)break;b!==5&&b!==26&&b!==27||it===null||(F=it,u?(it=zs(a,f),it!=null&&x.unshift(mo(a,it,F))):u||(it=zs(a,f),it!=null&&x.push(mo(a,it,F)))),a=a.return}x.length!==0&&t.push({event:n,listeners:x})}var Gx=/\r\n?/g,Vx=/\u0000|\uFFFD/g;function Ng(t){return(typeof t=="string"?t:""+t).replace(Gx,`
`).replace(Vx,"")}function Og(t,n){return n=Ng(n),Ng(t)===n}function Ie(t,n,a,o,u,f){switch(a){case"children":typeof o=="string"?n==="body"||n==="textarea"&&o===""||Rr(t,o):(typeof o=="number"||typeof o=="bigint")&&n!=="body"&&Rr(t,""+o);break;case"className":Le(t,"class",o);break;case"tabIndex":Le(t,"tabindex",o);break;case"dir":case"role":case"viewBox":case"width":case"height":Le(t,a,o);break;case"style":Oh(t,o,f);break;case"data":if(n!=="object"){Le(t,"data",o);break}case"src":case"href":if(o===""&&(n!=="a"||a!=="href")){t.removeAttribute(a);break}if(o==null||typeof o=="function"||typeof o=="symbol"||typeof o=="boolean"){t.removeAttribute(a);break}o=Go(""+o),t.setAttribute(a,o);break;case"action":case"formAction":if(typeof o=="function"){t.setAttribute(a,"javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");break}else typeof f=="function"&&(a==="formAction"?(n!=="input"&&Ie(t,n,"name",u.name,u,null),Ie(t,n,"formEncType",u.formEncType,u,null),Ie(t,n,"formMethod",u.formMethod,u,null),Ie(t,n,"formTarget",u.formTarget,u,null)):(Ie(t,n,"encType",u.encType,u,null),Ie(t,n,"method",u.method,u,null),Ie(t,n,"target",u.target,u,null)));if(o==null||typeof o=="symbol"||typeof o=="boolean"){t.removeAttribute(a);break}o=Go(""+o),t.setAttribute(a,o);break;case"onClick":o!=null&&(t.onclick=zi);break;case"onScroll":o!=null&&_e("scroll",t);break;case"onScrollEnd":o!=null&&_e("scrollend",t);break;case"dangerouslySetInnerHTML":if(o!=null){if(typeof o!="object"||!("__html"in o))throw Error(r(61));if(a=o.__html,a!=null){if(u.children!=null)throw Error(r(60));t.innerHTML=a}}break;case"multiple":t.multiple=o&&typeof o!="function"&&typeof o!="symbol";break;case"muted":t.muted=o&&typeof o!="function"&&typeof o!="symbol";break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"defaultValue":case"defaultChecked":case"innerHTML":case"ref":break;case"autoFocus":break;case"xlinkHref":if(o==null||typeof o=="function"||typeof o=="boolean"||typeof o=="symbol"){t.removeAttribute("xlink:href");break}a=Go(""+o),t.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",a);break;case"contentEditable":case"spellCheck":case"draggable":case"value":case"autoReverse":case"externalResourcesRequired":case"focusable":case"preserveAlpha":o!=null&&typeof o!="function"&&typeof o!="symbol"?t.setAttribute(a,""+o):t.removeAttribute(a);break;case"inert":case"allowFullScreen":case"async":case"autoPlay":case"controls":case"default":case"defer":case"disabled":case"disablePictureInPicture":case"disableRemotePlayback":case"formNoValidate":case"hidden":case"loop":case"noModule":case"noValidate":case"open":case"playsInline":case"readOnly":case"required":case"reversed":case"scoped":case"seamless":case"itemScope":o&&typeof o!="function"&&typeof o!="symbol"?t.setAttribute(a,""):t.removeAttribute(a);break;case"capture":case"download":o===!0?t.setAttribute(a,""):o!==!1&&o!=null&&typeof o!="function"&&typeof o!="symbol"?t.setAttribute(a,o):t.removeAttribute(a);break;case"cols":case"rows":case"size":case"span":o!=null&&typeof o!="function"&&typeof o!="symbol"&&!isNaN(o)&&1<=o?t.setAttribute(a,o):t.removeAttribute(a);break;case"rowSpan":case"start":o==null||typeof o=="function"||typeof o=="symbol"||isNaN(o)?t.removeAttribute(a):t.setAttribute(a,o);break;case"popover":_e("beforetoggle",t),_e("toggle",t),Ve(t,"popover",o);break;case"xlinkActuate":me(t,"http://www.w3.org/1999/xlink","xlink:actuate",o);break;case"xlinkArcrole":me(t,"http://www.w3.org/1999/xlink","xlink:arcrole",o);break;case"xlinkRole":me(t,"http://www.w3.org/1999/xlink","xlink:role",o);break;case"xlinkShow":me(t,"http://www.w3.org/1999/xlink","xlink:show",o);break;case"xlinkTitle":me(t,"http://www.w3.org/1999/xlink","xlink:title",o);break;case"xlinkType":me(t,"http://www.w3.org/1999/xlink","xlink:type",o);break;case"xmlBase":me(t,"http://www.w3.org/XML/1998/namespace","xml:base",o);break;case"xmlLang":me(t,"http://www.w3.org/XML/1998/namespace","xml:lang",o);break;case"xmlSpace":me(t,"http://www.w3.org/XML/1998/namespace","xml:space",o);break;case"is":Ve(t,"is",o);break;case"innerText":case"textContent":break;default:(!(2<a.length)||a[0]!=="o"&&a[0]!=="O"||a[1]!=="n"&&a[1]!=="N")&&(a=gv.get(a)||a,Ve(t,a,o))}}function Ef(t,n,a,o,u,f){switch(a){case"style":Oh(t,o,f);break;case"dangerouslySetInnerHTML":if(o!=null){if(typeof o!="object"||!("__html"in o))throw Error(r(61));if(a=o.__html,a!=null){if(u.children!=null)throw Error(r(60));t.innerHTML=a}}break;case"children":typeof o=="string"?Rr(t,o):(typeof o=="number"||typeof o=="bigint")&&Rr(t,""+o);break;case"onScroll":o!=null&&_e("scroll",t);break;case"onScrollEnd":o!=null&&_e("scrollend",t);break;case"onClick":o!=null&&(t.onclick=zi);break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"innerHTML":case"ref":break;case"innerText":case"textContent":break;default:if(!Gt.hasOwnProperty(a))t:{if(a[0]==="o"&&a[1]==="n"&&(u=a.endsWith("Capture"),n=a.slice(2,u?a.length-7:void 0),f=t[_n]||null,f=f!=null?f[a]:null,typeof f=="function"&&t.removeEventListener(n,f,u),typeof o=="function")){typeof f!="function"&&f!==null&&(a in t?t[a]=null:t.hasAttribute(a)&&t.removeAttribute(a)),t.addEventListener(n,o,u);break t}a in t?t[a]=o:o===!0?t.setAttribute(a,""):Ve(t,a,o)}}}function Mn(t,n,a){switch(n){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"img":_e("error",t),_e("load",t);var o=!1,u=!1,f;for(f in a)if(a.hasOwnProperty(f)){var x=a[f];if(x!=null)switch(f){case"src":o=!0;break;case"srcSet":u=!0;break;case"children":case"dangerouslySetInnerHTML":throw Error(r(137,n));default:Ie(t,n,f,x,a,null)}}u&&Ie(t,n,"srcSet",a.srcSet,a,null),o&&Ie(t,n,"src",a.src,a,null);return;case"input":_e("invalid",t);var b=f=x=u=null,F=null,it=null;for(o in a)if(a.hasOwnProperty(o)){var ht=a[o];if(ht!=null)switch(o){case"name":u=ht;break;case"type":x=ht;break;case"checked":F=ht;break;case"defaultChecked":it=ht;break;case"value":f=ht;break;case"defaultValue":b=ht;break;case"children":case"dangerouslySetInnerHTML":if(ht!=null)throw Error(r(137,n));break;default:Ie(t,n,o,ht,a,null)}}Dn(t,f,b,F,it,x,u,!1);return;case"select":_e("invalid",t),o=x=f=null;for(u in a)if(a.hasOwnProperty(u)&&(b=a[u],b!=null))switch(u){case"value":f=b;break;case"defaultValue":x=b;break;case"multiple":o=b;default:Ie(t,n,u,b,a,null)}n=f,a=x,t.multiple=!!o,n!=null?tn(t,!!o,n,!1):a!=null&&tn(t,!!o,a,!0);return;case"textarea":_e("invalid",t),f=u=o=null;for(x in a)if(a.hasOwnProperty(x)&&(b=a[x],b!=null))switch(x){case"value":o=b;break;case"defaultValue":u=b;break;case"children":f=b;break;case"dangerouslySetInnerHTML":if(b!=null)throw Error(r(91));break;default:Ie(t,n,x,b,a,null)}Ei(t,o,u,f);return;case"option":for(F in a)a.hasOwnProperty(F)&&(o=a[F],o!=null)&&(F==="selected"?t.selected=o&&typeof o!="function"&&typeof o!="symbol":Ie(t,n,F,o,a,null));return;case"dialog":_e("beforetoggle",t),_e("toggle",t),_e("cancel",t),_e("close",t);break;case"iframe":case"object":_e("load",t);break;case"video":case"audio":for(o=0;o<po.length;o++)_e(po[o],t);break;case"image":_e("error",t),_e("load",t);break;case"details":_e("toggle",t);break;case"embed":case"source":case"link":_e("error",t),_e("load",t);case"area":case"base":case"br":case"col":case"hr":case"keygen":case"meta":case"param":case"track":case"wbr":case"menuitem":for(it in a)if(a.hasOwnProperty(it)&&(o=a[it],o!=null))switch(it){case"children":case"dangerouslySetInnerHTML":throw Error(r(137,n));default:Ie(t,n,it,o,a,null)}return;default:if(Pc(n)){for(ht in a)a.hasOwnProperty(ht)&&(o=a[ht],o!==void 0&&Ef(t,n,ht,o,a,void 0));return}}for(b in a)a.hasOwnProperty(b)&&(o=a[b],o!=null&&Ie(t,n,b,o,a,null))}function kx(t,n,a,o){switch(n){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"input":var u=null,f=null,x=null,b=null,F=null,it=null,ht=null;for(ut in a){var vt=a[ut];if(a.hasOwnProperty(ut)&&vt!=null)switch(ut){case"checked":break;case"value":break;case"defaultValue":F=vt;default:o.hasOwnProperty(ut)||Ie(t,n,ut,null,o,vt)}}for(var st in o){var ut=o[st];if(vt=a[st],o.hasOwnProperty(st)&&(ut!=null||vt!=null))switch(st){case"type":f=ut;break;case"name":u=ut;break;case"checked":it=ut;break;case"defaultChecked":ht=ut;break;case"value":x=ut;break;case"defaultValue":b=ut;break;case"children":case"dangerouslySetInnerHTML":if(ut!=null)throw Error(r(137,n));break;default:ut!==vt&&Ie(t,n,st,ut,o,vt)}}En(t,x,b,F,it,ht,f,u);return;case"select":ut=x=b=st=null;for(f in a)if(F=a[f],a.hasOwnProperty(f)&&F!=null)switch(f){case"value":break;case"multiple":ut=F;default:o.hasOwnProperty(f)||Ie(t,n,f,null,o,F)}for(u in o)if(f=o[u],F=a[u],o.hasOwnProperty(u)&&(f!=null||F!=null))switch(u){case"value":st=f;break;case"defaultValue":b=f;break;case"multiple":x=f;default:f!==F&&Ie(t,n,u,f,o,F)}n=b,a=x,o=ut,st!=null?tn(t,!!a,st,!1):!!o!=!!a&&(n!=null?tn(t,!!a,n,!0):tn(t,!!a,a?[]:"",!1));return;case"textarea":ut=st=null;for(b in a)if(u=a[b],a.hasOwnProperty(b)&&u!=null&&!o.hasOwnProperty(b))switch(b){case"value":break;case"children":break;default:Ie(t,n,b,null,o,u)}for(x in o)if(u=o[x],f=a[x],o.hasOwnProperty(x)&&(u!=null||f!=null))switch(x){case"value":st=u;break;case"defaultValue":ut=u;break;case"children":break;case"dangerouslySetInnerHTML":if(u!=null)throw Error(r(91));break;default:u!==f&&Ie(t,n,x,u,o,f)}Ar(t,st,ut);return;case"option":for(var Ht in a)st=a[Ht],a.hasOwnProperty(Ht)&&st!=null&&!o.hasOwnProperty(Ht)&&(Ht==="selected"?t.selected=!1:Ie(t,n,Ht,null,o,st));for(F in o)st=o[F],ut=a[F],o.hasOwnProperty(F)&&st!==ut&&(st!=null||ut!=null)&&(F==="selected"?t.selected=st&&typeof st!="function"&&typeof st!="symbol":Ie(t,n,F,st,o,ut));return;case"img":case"link":case"area":case"base":case"br":case"col":case"embed":case"hr":case"keygen":case"meta":case"param":case"source":case"track":case"wbr":case"menuitem":for(var te in a)st=a[te],a.hasOwnProperty(te)&&st!=null&&!o.hasOwnProperty(te)&&Ie(t,n,te,null,o,st);for(it in o)if(st=o[it],ut=a[it],o.hasOwnProperty(it)&&st!==ut&&(st!=null||ut!=null))switch(it){case"children":case"dangerouslySetInnerHTML":if(st!=null)throw Error(r(137,n));break;default:Ie(t,n,it,st,o,ut)}return;default:if(Pc(n)){for(var He in a)st=a[He],a.hasOwnProperty(He)&&st!==void 0&&!o.hasOwnProperty(He)&&Ef(t,n,He,void 0,o,st);for(ht in o)st=o[ht],ut=a[ht],!o.hasOwnProperty(ht)||st===ut||st===void 0&&ut===void 0||Ef(t,n,ht,st,o,ut);return}}for(var Q in a)st=a[Q],a.hasOwnProperty(Q)&&st!=null&&!o.hasOwnProperty(Q)&&Ie(t,n,Q,null,o,st);for(vt in o)st=o[vt],ut=a[vt],!o.hasOwnProperty(vt)||st===ut||st==null&&ut==null||Ie(t,n,vt,st,o,ut)}function zg(t){switch(t){case"css":case"script":case"font":case"img":case"image":case"input":case"link":return!0;default:return!1}}function Xx(){if(typeof performance.getEntriesByType=="function"){for(var t=0,n=0,a=performance.getEntriesByType("resource"),o=0;o<a.length;o++){var u=a[o],f=u.transferSize,x=u.initiatorType,b=u.duration;if(f&&b&&zg(x)){for(x=0,b=u.responseEnd,o+=1;o<a.length;o++){var F=a[o],it=F.startTime;if(it>b)break;var ht=F.transferSize,vt=F.initiatorType;ht&&zg(vt)&&(F=F.responseEnd,x+=ht*(F<b?1:(b-it)/(F-it)))}if(--o,n+=8*(f+x)/(u.duration/1e3),t++,10<t)break}}if(0<t)return n/t/1e6}return navigator.connection&&(t=navigator.connection.downlink,typeof t=="number")?t:5}var Tf=null,bf=null;function Pl(t){return t.nodeType===9?t:t.ownerDocument}function Pg(t){switch(t){case"http://www.w3.org/2000/svg":return 1;case"http://www.w3.org/1998/Math/MathML":return 2;default:return 0}}function Bg(t,n){if(t===0)switch(n){case"svg":return 1;case"math":return 2;default:return 0}return t===1&&n==="foreignObject"?0:t}function Af(t,n){return t==="textarea"||t==="noscript"||typeof n.children=="string"||typeof n.children=="number"||typeof n.children=="bigint"||typeof n.dangerouslySetInnerHTML=="object"&&n.dangerouslySetInnerHTML!==null&&n.dangerouslySetInnerHTML.__html!=null}var Rf=null;function Wx(){var t=window.event;return t&&t.type==="popstate"?t===Rf?!1:(Rf=t,!0):(Rf=null,!1)}var Fg=typeof setTimeout=="function"?setTimeout:void 0,qx=typeof clearTimeout=="function"?clearTimeout:void 0,Ig=typeof Promise=="function"?Promise:void 0,Yx=typeof queueMicrotask=="function"?queueMicrotask:typeof Ig<"u"?function(t){return Ig.resolve(null).then(t).catch(Zx)}:Fg;function Zx(t){setTimeout(function(){throw t})}function ba(t){return t==="head"}function Hg(t,n){var a=n,o=0;do{var u=a.nextSibling;if(t.removeChild(a),u&&u.nodeType===8)if(a=u.data,a==="/$"||a==="/&"){if(o===0){t.removeChild(u),as(n);return}o--}else if(a==="$"||a==="$?"||a==="$~"||a==="$!"||a==="&")o++;else if(a==="html")go(t.ownerDocument.documentElement);else if(a==="head"){a=t.ownerDocument.head,go(a);for(var f=a.firstChild;f;){var x=f.nextSibling,b=f.nodeName;f[ka]||b==="SCRIPT"||b==="STYLE"||b==="LINK"&&f.rel.toLowerCase()==="stylesheet"||a.removeChild(f),f=x}}else a==="body"&&go(t.ownerDocument.body);a=u}while(a);as(n)}function Gg(t,n){var a=t;t=0;do{var o=a.nextSibling;if(a.nodeType===1?n?(a._stashedDisplay=a.style.display,a.style.display="none"):(a.style.display=a._stashedDisplay||"",a.getAttribute("style")===""&&a.removeAttribute("style")):a.nodeType===3&&(n?(a._stashedText=a.nodeValue,a.nodeValue=""):a.nodeValue=a._stashedText||""),o&&o.nodeType===8)if(a=o.data,a==="/$"){if(t===0)break;t--}else a!=="$"&&a!=="$?"&&a!=="$~"&&a!=="$!"||t++;a=o}while(a)}function Cf(t){var n=t.firstChild;for(n&&n.nodeType===10&&(n=n.nextSibling);n;){var a=n;switch(n=n.nextSibling,a.nodeName){case"HTML":case"HEAD":case"BODY":Cf(a),C(a);continue;case"SCRIPT":case"STYLE":continue;case"LINK":if(a.rel.toLowerCase()==="stylesheet")continue}t.removeChild(a)}}function jx(t,n,a,o){for(;t.nodeType===1;){var u=a;if(t.nodeName.toLowerCase()!==n.toLowerCase()){if(!o&&(t.nodeName!=="INPUT"||t.type!=="hidden"))break}else if(o){if(!t[ka])switch(n){case"meta":if(!t.hasAttribute("itemprop"))break;return t;case"link":if(f=t.getAttribute("rel"),f==="stylesheet"&&t.hasAttribute("data-precedence"))break;if(f!==u.rel||t.getAttribute("href")!==(u.href==null||u.href===""?null:u.href)||t.getAttribute("crossorigin")!==(u.crossOrigin==null?null:u.crossOrigin)||t.getAttribute("title")!==(u.title==null?null:u.title))break;return t;case"style":if(t.hasAttribute("data-precedence"))break;return t;case"script":if(f=t.getAttribute("src"),(f!==(u.src==null?null:u.src)||t.getAttribute("type")!==(u.type==null?null:u.type)||t.getAttribute("crossorigin")!==(u.crossOrigin==null?null:u.crossOrigin))&&f&&t.hasAttribute("async")&&!t.hasAttribute("itemprop"))break;return t;default:return t}}else if(n==="input"&&t.type==="hidden"){var f=u.name==null?null:""+u.name;if(u.type==="hidden"&&t.getAttribute("name")===f)return t}else return t;if(t=oi(t.nextSibling),t===null)break}return null}function Kx(t,n,a){if(n==="")return null;for(;t.nodeType!==3;)if((t.nodeType!==1||t.nodeName!=="INPUT"||t.type!=="hidden")&&!a||(t=oi(t.nextSibling),t===null))return null;return t}function Vg(t,n){for(;t.nodeType!==8;)if((t.nodeType!==1||t.nodeName!=="INPUT"||t.type!=="hidden")&&!n||(t=oi(t.nextSibling),t===null))return null;return t}function wf(t){return t.data==="$?"||t.data==="$~"}function Df(t){return t.data==="$!"||t.data==="$?"&&t.ownerDocument.readyState!=="loading"}function Qx(t,n){var a=t.ownerDocument;if(t.data==="$~")t._reactRetry=n;else if(t.data!=="$?"||a.readyState!=="loading")n();else{var o=function(){n(),a.removeEventListener("DOMContentLoaded",o)};a.addEventListener("DOMContentLoaded",o),t._reactRetry=o}}function oi(t){for(;t!=null;t=t.nextSibling){var n=t.nodeType;if(n===1||n===3)break;if(n===8){if(n=t.data,n==="$"||n==="$!"||n==="$?"||n==="$~"||n==="&"||n==="F!"||n==="F")break;if(n==="/$"||n==="/&")return null}}return t}var Uf=null;function kg(t){t=t.nextSibling;for(var n=0;t;){if(t.nodeType===8){var a=t.data;if(a==="/$"||a==="/&"){if(n===0)return oi(t.nextSibling);n--}else a!=="$"&&a!=="$!"&&a!=="$?"&&a!=="$~"&&a!=="&"||n++}t=t.nextSibling}return null}function Xg(t){t=t.previousSibling;for(var n=0;t;){if(t.nodeType===8){var a=t.data;if(a==="$"||a==="$!"||a==="$?"||a==="$~"||a==="&"){if(n===0)return t;n--}else a!=="/$"&&a!=="/&"||n++}t=t.previousSibling}return null}function Wg(t,n,a){switch(n=Pl(a),t){case"html":if(t=n.documentElement,!t)throw Error(r(452));return t;case"head":if(t=n.head,!t)throw Error(r(453));return t;case"body":if(t=n.body,!t)throw Error(r(454));return t;default:throw Error(r(451))}}function go(t){for(var n=t.attributes;n.length;)t.removeAttributeNode(n[0]);C(t)}var li=new Map,qg=new Set;function Bl(t){return typeof t.getRootNode=="function"?t.getRootNode():t.nodeType===9?t:t.ownerDocument}var Qi=q.d;q.d={f:Jx,r:$x,D:tS,C:eS,L:nS,m:iS,X:rS,S:aS,M:sS};function Jx(){var t=Qi.f(),n=Cl();return t||n}function $x(t){var n=ot(t);n!==null&&n.tag===5&&n.type==="form"?cm(n):Qi.r(t)}var es=typeof document>"u"?null:document;function Yg(t,n,a){var o=es;if(o&&typeof n=="string"&&n){var u=ve(n);u='link[rel="'+t+'"][href="'+u+'"]',typeof a=="string"&&(u+='[crossorigin="'+a+'"]'),qg.has(u)||(qg.add(u),t={rel:t,crossOrigin:a,href:n},o.querySelector(u)===null&&(n=o.createElement("link"),Mn(n,"link",t),Mt(n),o.head.appendChild(n)))}}function tS(t){Qi.D(t),Yg("dns-prefetch",t,null)}function eS(t,n){Qi.C(t,n),Yg("preconnect",t,n)}function nS(t,n,a){Qi.L(t,n,a);var o=es;if(o&&t&&n){var u='link[rel="preload"][as="'+ve(n)+'"]';n==="image"&&a&&a.imageSrcSet?(u+='[imagesrcset="'+ve(a.imageSrcSet)+'"]',typeof a.imageSizes=="string"&&(u+='[imagesizes="'+ve(a.imageSizes)+'"]')):u+='[href="'+ve(t)+'"]';var f=u;switch(n){case"style":f=ns(t);break;case"script":f=is(t)}li.has(f)||(t=g({rel:"preload",href:n==="image"&&a&&a.imageSrcSet?void 0:t,as:n},a),li.set(f,t),o.querySelector(u)!==null||n==="style"&&o.querySelector(_o(f))||n==="script"&&o.querySelector(vo(f))||(n=o.createElement("link"),Mn(n,"link",t),Mt(n),o.head.appendChild(n)))}}function iS(t,n){Qi.m(t,n);var a=es;if(a&&t){var o=n&&typeof n.as=="string"?n.as:"script",u='link[rel="modulepreload"][as="'+ve(o)+'"][href="'+ve(t)+'"]',f=u;switch(o){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":f=is(t)}if(!li.has(f)&&(t=g({rel:"modulepreload",href:t},n),li.set(f,t),a.querySelector(u)===null)){switch(o){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":if(a.querySelector(vo(f)))return}o=a.createElement("link"),Mn(o,"link",t),Mt(o),a.head.appendChild(o)}}}function aS(t,n,a){Qi.S(t,n,a);var o=es;if(o&&t){var u=K(o).hoistableStyles,f=ns(t);n=n||"default";var x=u.get(f);if(!x){var b={loading:0,preload:null};if(x=o.querySelector(_o(f)))b.loading=5;else{t=g({rel:"stylesheet",href:t,"data-precedence":n},a),(a=li.get(f))&&Lf(t,a);var F=x=o.createElement("link");Mt(F),Mn(F,"link",t),F._p=new Promise(function(it,ht){F.onload=it,F.onerror=ht}),F.addEventListener("load",function(){b.loading|=1}),F.addEventListener("error",function(){b.loading|=2}),b.loading|=4,Fl(x,n,o)}x={type:"stylesheet",instance:x,count:1,state:b},u.set(f,x)}}}function rS(t,n){Qi.X(t,n);var a=es;if(a&&t){var o=K(a).hoistableScripts,u=is(t),f=o.get(u);f||(f=a.querySelector(vo(u)),f||(t=g({src:t,async:!0},n),(n=li.get(u))&&Nf(t,n),f=a.createElement("script"),Mt(f),Mn(f,"link",t),a.head.appendChild(f)),f={type:"script",instance:f,count:1,state:null},o.set(u,f))}}function sS(t,n){Qi.M(t,n);var a=es;if(a&&t){var o=K(a).hoistableScripts,u=is(t),f=o.get(u);f||(f=a.querySelector(vo(u)),f||(t=g({src:t,async:!0,type:"module"},n),(n=li.get(u))&&Nf(t,n),f=a.createElement("script"),Mt(f),Mn(f,"link",t),a.head.appendChild(f)),f={type:"script",instance:f,count:1,state:null},o.set(u,f))}}function Zg(t,n,a,o){var u=(u=mt.current)?Bl(u):null;if(!u)throw Error(r(446));switch(t){case"meta":case"title":return null;case"style":return typeof a.precedence=="string"&&typeof a.href=="string"?(n=ns(a.href),a=K(u).hoistableStyles,o=a.get(n),o||(o={type:"style",instance:null,count:0,state:null},a.set(n,o)),o):{type:"void",instance:null,count:0,state:null};case"link":if(a.rel==="stylesheet"&&typeof a.href=="string"&&typeof a.precedence=="string"){t=ns(a.href);var f=K(u).hoistableStyles,x=f.get(t);if(x||(u=u.ownerDocument||u,x={type:"stylesheet",instance:null,count:0,state:{loading:0,preload:null}},f.set(t,x),(f=u.querySelector(_o(t)))&&!f._p&&(x.instance=f,x.state.loading=5),li.has(t)||(a={rel:"preload",as:"style",href:a.href,crossOrigin:a.crossOrigin,integrity:a.integrity,media:a.media,hrefLang:a.hrefLang,referrerPolicy:a.referrerPolicy},li.set(t,a),f||oS(u,t,a,x.state))),n&&o===null)throw Error(r(528,""));return x}if(n&&o!==null)throw Error(r(529,""));return null;case"script":return n=a.async,a=a.src,typeof a=="string"&&n&&typeof n!="function"&&typeof n!="symbol"?(n=is(a),a=K(u).hoistableScripts,o=a.get(n),o||(o={type:"script",instance:null,count:0,state:null},a.set(n,o)),o):{type:"void",instance:null,count:0,state:null};default:throw Error(r(444,t))}}function ns(t){return'href="'+ve(t)+'"'}function _o(t){return'link[rel="stylesheet"]['+t+"]"}function jg(t){return g({},t,{"data-precedence":t.precedence,precedence:null})}function oS(t,n,a,o){t.querySelector('link[rel="preload"][as="style"]['+n+"]")?o.loading=1:(n=t.createElement("link"),o.preload=n,n.addEventListener("load",function(){return o.loading|=1}),n.addEventListener("error",function(){return o.loading|=2}),Mn(n,"link",a),Mt(n),t.head.appendChild(n))}function is(t){return'[src="'+ve(t)+'"]'}function vo(t){return"script[async]"+t}function Kg(t,n,a){if(n.count++,n.instance===null)switch(n.type){case"style":var o=t.querySelector('style[data-href~="'+ve(a.href)+'"]');if(o)return n.instance=o,Mt(o),o;var u=g({},a,{"data-href":a.href,"data-precedence":a.precedence,href:null,precedence:null});return o=(t.ownerDocument||t).createElement("style"),Mt(o),Mn(o,"style",u),Fl(o,a.precedence,t),n.instance=o;case"stylesheet":u=ns(a.href);var f=t.querySelector(_o(u));if(f)return n.state.loading|=4,n.instance=f,Mt(f),f;o=jg(a),(u=li.get(u))&&Lf(o,u),f=(t.ownerDocument||t).createElement("link"),Mt(f);var x=f;return x._p=new Promise(function(b,F){x.onload=b,x.onerror=F}),Mn(f,"link",o),n.state.loading|=4,Fl(f,a.precedence,t),n.instance=f;case"script":return f=is(a.src),(u=t.querySelector(vo(f)))?(n.instance=u,Mt(u),u):(o=a,(u=li.get(f))&&(o=g({},a),Nf(o,u)),t=t.ownerDocument||t,u=t.createElement("script"),Mt(u),Mn(u,"link",o),t.head.appendChild(u),n.instance=u);case"void":return null;default:throw Error(r(443,n.type))}else n.type==="stylesheet"&&(n.state.loading&4)===0&&(o=n.instance,n.state.loading|=4,Fl(o,a.precedence,t));return n.instance}function Fl(t,n,a){for(var o=a.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'),u=o.length?o[o.length-1]:null,f=u,x=0;x<o.length;x++){var b=o[x];if(b.dataset.precedence===n)f=b;else if(f!==u)break}f?f.parentNode.insertBefore(t,f.nextSibling):(n=a.nodeType===9?a.head:a,n.insertBefore(t,n.firstChild))}function Lf(t,n){t.crossOrigin==null&&(t.crossOrigin=n.crossOrigin),t.referrerPolicy==null&&(t.referrerPolicy=n.referrerPolicy),t.title==null&&(t.title=n.title)}function Nf(t,n){t.crossOrigin==null&&(t.crossOrigin=n.crossOrigin),t.referrerPolicy==null&&(t.referrerPolicy=n.referrerPolicy),t.integrity==null&&(t.integrity=n.integrity)}var Il=null;function Qg(t,n,a){if(Il===null){var o=new Map,u=Il=new Map;u.set(a,o)}else u=Il,o=u.get(a),o||(o=new Map,u.set(a,o));if(o.has(t))return o;for(o.set(t,null),a=a.getElementsByTagName(t),u=0;u<a.length;u++){var f=a[u];if(!(f[ka]||f[an]||t==="link"&&f.getAttribute("rel")==="stylesheet")&&f.namespaceURI!=="http://www.w3.org/2000/svg"){var x=f.getAttribute(n)||"";x=t+x;var b=o.get(x);b?b.push(f):o.set(x,[f])}}return o}function Jg(t,n,a){t=t.ownerDocument||t,t.head.insertBefore(a,n==="title"?t.querySelector("head > title"):null)}function lS(t,n,a){if(a===1||n.itemProp!=null)return!1;switch(t){case"meta":case"title":return!0;case"style":if(typeof n.precedence!="string"||typeof n.href!="string"||n.href==="")break;return!0;case"link":if(typeof n.rel!="string"||typeof n.href!="string"||n.href===""||n.onLoad||n.onError)break;return n.rel==="stylesheet"?(t=n.disabled,typeof n.precedence=="string"&&t==null):!0;case"script":if(n.async&&typeof n.async!="function"&&typeof n.async!="symbol"&&!n.onLoad&&!n.onError&&n.src&&typeof n.src=="string")return!0}return!1}function $g(t){return!(t.type==="stylesheet"&&(t.state.loading&3)===0)}function cS(t,n,a,o){if(a.type==="stylesheet"&&(typeof o.media!="string"||matchMedia(o.media).matches!==!1)&&(a.state.loading&4)===0){if(a.instance===null){var u=ns(o.href),f=n.querySelector(_o(u));if(f){n=f._p,n!==null&&typeof n=="object"&&typeof n.then=="function"&&(t.count++,t=Hl.bind(t),n.then(t,t)),a.state.loading|=4,a.instance=f,Mt(f);return}f=n.ownerDocument||n,o=jg(o),(u=li.get(u))&&Lf(o,u),f=f.createElement("link"),Mt(f);var x=f;x._p=new Promise(function(b,F){x.onload=b,x.onerror=F}),Mn(f,"link",o),a.instance=f}t.stylesheets===null&&(t.stylesheets=new Map),t.stylesheets.set(a,n),(n=a.state.preload)&&(a.state.loading&3)===0&&(t.count++,a=Hl.bind(t),n.addEventListener("load",a),n.addEventListener("error",a))}}var Of=0;function uS(t,n){return t.stylesheets&&t.count===0&&Vl(t,t.stylesheets),0<t.count||0<t.imgCount?function(a){var o=setTimeout(function(){if(t.stylesheets&&Vl(t,t.stylesheets),t.unsuspend){var f=t.unsuspend;t.unsuspend=null,f()}},6e4+n);0<t.imgBytes&&Of===0&&(Of=62500*Xx());var u=setTimeout(function(){if(t.waitingForImages=!1,t.count===0&&(t.stylesheets&&Vl(t,t.stylesheets),t.unsuspend)){var f=t.unsuspend;t.unsuspend=null,f()}},(t.imgBytes>Of?50:800)+n);return t.unsuspend=a,function(){t.unsuspend=null,clearTimeout(o),clearTimeout(u)}}:null}function Hl(){if(this.count--,this.count===0&&(this.imgCount===0||!this.waitingForImages)){if(this.stylesheets)Vl(this,this.stylesheets);else if(this.unsuspend){var t=this.unsuspend;this.unsuspend=null,t()}}}var Gl=null;function Vl(t,n){t.stylesheets=null,t.unsuspend!==null&&(t.count++,Gl=new Map,n.forEach(fS,t),Gl=null,Hl.call(t))}function fS(t,n){if(!(n.state.loading&4)){var a=Gl.get(t);if(a)var o=a.get(null);else{a=new Map,Gl.set(t,a);for(var u=t.querySelectorAll("link[data-precedence],style[data-precedence]"),f=0;f<u.length;f++){var x=u[f];(x.nodeName==="LINK"||x.getAttribute("media")!=="not all")&&(a.set(x.dataset.precedence,x),o=x)}o&&a.set(null,o)}u=n.instance,x=u.getAttribute("data-precedence"),f=a.get(x)||o,f===o&&a.set(null,u),a.set(x,u),this.count++,o=Hl.bind(this),u.addEventListener("load",o),u.addEventListener("error",o),f?f.parentNode.insertBefore(u,f.nextSibling):(t=t.nodeType===9?t.head:t,t.insertBefore(u,t.firstChild)),n.state.loading|=4}}var xo={$$typeof:z,Provider:null,Consumer:null,_currentValue:j,_currentValue2:j,_threadCount:0};function dS(t,n,a,o,u,f,x,b,F){this.tag=1,this.containerInfo=t,this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.next=this.pendingContext=this.context=this.cancelPendingCommit=null,this.callbackPriority=0,this.expirationTimes=Ee(-1),this.entangledLanes=this.shellSuspendCounter=this.errorRecoveryDisabledLanes=this.expiredLanes=this.warmLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Ee(0),this.hiddenUpdates=Ee(null),this.identifierPrefix=o,this.onUncaughtError=u,this.onCaughtError=f,this.onRecoverableError=x,this.pooledCache=null,this.pooledCacheLanes=0,this.formState=F,this.incompleteTransitions=new Map}function t0(t,n,a,o,u,f,x,b,F,it,ht,vt){return t=new dS(t,n,a,x,F,it,ht,vt,b),n=1,f===!0&&(n|=24),f=Wn(3,null,null,n),t.current=f,f.stateNode=t,n=du(),n.refCount++,t.pooledCache=n,n.refCount++,f.memoizedState={element:o,isDehydrated:a,cache:n},gu(f),t}function e0(t){return t?(t=Or,t):Or}function n0(t,n,a,o,u,f){u=e0(u),o.context===null?o.context=u:o.pendingContext=u,o=pa(n),o.payload={element:a},f=f===void 0?null:f,f!==null&&(o.callback=f),a=ma(t,o,n),a!==null&&(In(a,t,n),Ks(a,t,n))}function i0(t,n){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var a=t.retryLane;t.retryLane=a!==0&&a<n?a:n}}function zf(t,n){i0(t,n),(t=t.alternate)&&i0(t,n)}function a0(t){if(t.tag===13||t.tag===31){var n=Za(t,67108864);n!==null&&In(n,t,67108864),zf(t,67108864)}}function r0(t){if(t.tag===13||t.tag===31){var n=Kn();n=Tr(n);var a=Za(t,n);a!==null&&In(a,t,n),zf(t,n)}}var kl=!0;function hS(t,n,a,o){var u=B.T;B.T=null;var f=q.p;try{q.p=2,Pf(t,n,a,o)}finally{q.p=f,B.T=u}}function pS(t,n,a,o){var u=B.T;B.T=null;var f=q.p;try{q.p=8,Pf(t,n,a,o)}finally{q.p=f,B.T=u}}function Pf(t,n,a,o){if(kl){var u=Bf(o);if(u===null)Mf(t,n,o,Xl,a),o0(t,o);else if(gS(u,t,n,a,o))o.stopPropagation();else if(o0(t,o),n&4&&-1<mS.indexOf(t)){for(;u!==null;){var f=ot(u);if(f!==null)switch(f.tag){case 3:if(f=f.stateNode,f.current.memoizedState.isDehydrated){var x=Tt(f.pendingLanes);if(x!==0){var b=f;for(b.pendingLanes|=2,b.entangledLanes|=2;x;){var F=1<<31-Pt(x);b.entanglements[1]|=F,x&=~F}Ri(f),(De&6)===0&&(Al=E()+500,ho(0))}}break;case 31:case 13:b=Za(f,2),b!==null&&In(b,f,2),Cl(),zf(f,2)}if(f=Bf(o),f===null&&Mf(t,n,o,Xl,a),f===u)break;u=f}u!==null&&o.stopPropagation()}else Mf(t,n,o,null,a)}}function Bf(t){return t=Fc(t),Ff(t)}var Xl=null;function Ff(t){if(Xl=null,t=Z(t),t!==null){var n=c(t);if(n===null)t=null;else{var a=n.tag;if(a===13){if(t=d(n),t!==null)return t;t=null}else if(a===31){if(t=h(n),t!==null)return t;t=null}else if(a===3){if(n.stateNode.current.memoizedState.isDehydrated)return n.tag===3?n.stateNode.containerInfo:null;t=null}else n!==t&&(t=null)}}return Xl=t,null}function s0(t){switch(t){case"beforetoggle":case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"toggle":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 2;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 8;case"message":switch(at()){case gt:return 2;case Et:return 8;case dt:case Zt:return 32;case Rt:return 268435456;default:return 32}default:return 32}}var If=!1,Aa=null,Ra=null,Ca=null,So=new Map,yo=new Map,wa=[],mS="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");function o0(t,n){switch(t){case"focusin":case"focusout":Aa=null;break;case"dragenter":case"dragleave":Ra=null;break;case"mouseover":case"mouseout":Ca=null;break;case"pointerover":case"pointerout":So.delete(n.pointerId);break;case"gotpointercapture":case"lostpointercapture":yo.delete(n.pointerId)}}function Mo(t,n,a,o,u,f){return t===null||t.nativeEvent!==f?(t={blockedOn:n,domEventName:a,eventSystemFlags:o,nativeEvent:f,targetContainers:[u]},n!==null&&(n=ot(n),n!==null&&a0(n)),t):(t.eventSystemFlags|=o,n=t.targetContainers,u!==null&&n.indexOf(u)===-1&&n.push(u),t)}function gS(t,n,a,o,u){switch(n){case"focusin":return Aa=Mo(Aa,t,n,a,o,u),!0;case"dragenter":return Ra=Mo(Ra,t,n,a,o,u),!0;case"mouseover":return Ca=Mo(Ca,t,n,a,o,u),!0;case"pointerover":var f=u.pointerId;return So.set(f,Mo(So.get(f)||null,t,n,a,o,u)),!0;case"gotpointercapture":return f=u.pointerId,yo.set(f,Mo(yo.get(f)||null,t,n,a,o,u)),!0}return!1}function l0(t){var n=Z(t.target);if(n!==null){var a=c(n);if(a!==null){if(n=a.tag,n===13){if(n=d(a),n!==null){t.blockedOn=n,Ns(t.priority,function(){r0(a)});return}}else if(n===31){if(n=h(a),n!==null){t.blockedOn=n,Ns(t.priority,function(){r0(a)});return}}else if(n===3&&a.stateNode.current.memoizedState.isDehydrated){t.blockedOn=a.tag===3?a.stateNode.containerInfo:null;return}}}t.blockedOn=null}function Wl(t){if(t.blockedOn!==null)return!1;for(var n=t.targetContainers;0<n.length;){var a=Bf(t.nativeEvent);if(a===null){a=t.nativeEvent;var o=new a.constructor(a.type,a);Bc=o,a.target.dispatchEvent(o),Bc=null}else return n=ot(a),n!==null&&a0(n),t.blockedOn=a,!1;n.shift()}return!0}function c0(t,n,a){Wl(t)&&a.delete(n)}function _S(){If=!1,Aa!==null&&Wl(Aa)&&(Aa=null),Ra!==null&&Wl(Ra)&&(Ra=null),Ca!==null&&Wl(Ca)&&(Ca=null),So.forEach(c0),yo.forEach(c0)}function ql(t,n){t.blockedOn===n&&(t.blockedOn=null,If||(If=!0,s.unstable_scheduleCallback(s.unstable_NormalPriority,_S)))}var Yl=null;function u0(t){Yl!==t&&(Yl=t,s.unstable_scheduleCallback(s.unstable_NormalPriority,function(){Yl===t&&(Yl=null);for(var n=0;n<t.length;n+=3){var a=t[n],o=t[n+1],u=t[n+2];if(typeof o!="function"){if(Ff(o||a)===null)continue;break}var f=ot(a);f!==null&&(t.splice(n,3),n-=3,Pu(f,{pending:!0,data:u,method:a.method,action:o},o,u))}}))}function as(t){function n(F){return ql(F,t)}Aa!==null&&ql(Aa,t),Ra!==null&&ql(Ra,t),Ca!==null&&ql(Ca,t),So.forEach(n),yo.forEach(n);for(var a=0;a<wa.length;a++){var o=wa[a];o.blockedOn===t&&(o.blockedOn=null)}for(;0<wa.length&&(a=wa[0],a.blockedOn===null);)l0(a),a.blockedOn===null&&wa.shift();if(a=(t.ownerDocument||t).$$reactFormReplay,a!=null)for(o=0;o<a.length;o+=3){var u=a[o],f=a[o+1],x=u[_n]||null;if(typeof f=="function")x||u0(a);else if(x){var b=null;if(f&&f.hasAttribute("formAction")){if(u=f,x=f[_n]||null)b=x.formAction;else if(Ff(u)!==null)continue}else b=x.action;typeof b=="function"?a[o+1]=b:(a.splice(o,3),o-=3),u0(a)}}}function f0(){function t(f){f.canIntercept&&f.info==="react-transition"&&f.intercept({handler:function(){return new Promise(function(x){return u=x})},focusReset:"manual",scroll:"manual"})}function n(){u!==null&&(u(),u=null),o||setTimeout(a,20)}function a(){if(!o&&!navigation.transition){var f=navigation.currentEntry;f&&f.url!=null&&navigation.navigate(f.url,{state:f.getState(),info:"react-transition",history:"replace"})}}if(typeof navigation=="object"){var o=!1,u=null;return navigation.addEventListener("navigate",t),navigation.addEventListener("navigatesuccess",n),navigation.addEventListener("navigateerror",n),setTimeout(a,100),function(){o=!0,navigation.removeEventListener("navigate",t),navigation.removeEventListener("navigatesuccess",n),navigation.removeEventListener("navigateerror",n),u!==null&&(u(),u=null)}}}function Hf(t){this._internalRoot=t}Zl.prototype.render=Hf.prototype.render=function(t){var n=this._internalRoot;if(n===null)throw Error(r(409));var a=n.current,o=Kn();n0(a,o,t,n,null,null)},Zl.prototype.unmount=Hf.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var n=t.containerInfo;n0(t.current,2,null,t,null,null),Cl(),n[oa]=null}};function Zl(t){this._internalRoot=t}Zl.prototype.unstable_scheduleHydration=function(t){if(t){var n=Va();t={blockedOn:null,target:t,priority:n};for(var a=0;a<wa.length&&n!==0&&n<wa[a].priority;a++);wa.splice(a,0,t),a===0&&l0(t)}};var d0=e.version;if(d0!=="19.2.6")throw Error(r(527,d0,"19.2.6"));q.findDOMNode=function(t){var n=t._reactInternals;if(n===void 0)throw typeof t.render=="function"?Error(r(188)):(t=Object.keys(t).join(","),Error(r(268,t)));return t=p(n),t=t!==null?v(t):null,t=t===null?null:t.stateNode,t};var vS={bundleType:0,version:"19.2.6",rendererPackageName:"react-dom",currentDispatcherRef:B,reconcilerVersion:"19.2.6"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){var jl=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!jl.isDisabled&&jl.supportsFiber)try{bt=jl.inject(vS),Ct=jl}catch{}}return Eo.createRoot=function(t,n){if(!l(t))throw Error(r(299));var a=!1,o="",u=xm,f=Sm,x=ym;return n!=null&&(n.unstable_strictMode===!0&&(a=!0),n.identifierPrefix!==void 0&&(o=n.identifierPrefix),n.onUncaughtError!==void 0&&(u=n.onUncaughtError),n.onCaughtError!==void 0&&(f=n.onCaughtError),n.onRecoverableError!==void 0&&(x=n.onRecoverableError)),n=t0(t,1,!1,null,null,a,o,null,u,f,x,f0),t[oa]=n.current,yf(t),new Hf(n)},Eo.hydrateRoot=function(t,n,a){if(!l(t))throw Error(r(299));var o=!1,u="",f=xm,x=Sm,b=ym,F=null;return a!=null&&(a.unstable_strictMode===!0&&(o=!0),a.identifierPrefix!==void 0&&(u=a.identifierPrefix),a.onUncaughtError!==void 0&&(f=a.onUncaughtError),a.onCaughtError!==void 0&&(x=a.onCaughtError),a.onRecoverableError!==void 0&&(b=a.onRecoverableError),a.formState!==void 0&&(F=a.formState)),n=t0(t,1,!0,n,a??null,o,u,F,f,x,b,f0),n.context=e0(null),a=n.current,o=Kn(),o=Tr(o),u=pa(o),u.callback=null,ma(a,u,o),a=o,n.current.lanes=a,wn(n,a),Ri(n),t[oa]=n.current,yf(t),new Zl(n)},Eo.version="19.2.6",Eo}var S0;function AS(){if(S0)return Vf.exports;S0=1;function s(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(s)}catch(e){console.error(e)}}return s(),Vf.exports=bS(),Vf.exports}var RS=AS();const ph="179",CS=0,y0=1,wS=2,N_=1,DS=2,ia=3,Ha=0,Gn=1,aa=2,Fa=0,ys=1,M0=2,E0=3,T0=4,US=5,mr=100,LS=101,NS=102,OS=103,zS=104,PS=200,BS=201,FS=202,IS=203,bd=204,Ad=205,HS=206,GS=207,VS=208,kS=209,XS=210,WS=211,qS=212,YS=213,ZS=214,Rd=0,Cd=1,wd=2,Ts=3,Dd=4,Ud=5,Ld=6,Nd=7,mh=0,jS=1,KS=2,Ia=0,QS=1,JS=2,$S=3,ty=4,ey=5,ny=6,iy=7,O_=300,bs=301,As=302,Od=303,zd=304,Dc=306,Pd=1e3,_r=1001,Bd=1002,Si=1003,ay=1004,Kl=1005,wi=1006,qf=1007,vr=1008,Li=1009,z_=1010,P_=1011,Uo=1012,gh=1013,Sr=1014,ra=1015,Po=1016,_h=1017,vh=1018,Lo=1020,B_=35902,F_=1021,I_=1022,xi=1023,No=1026,Oo=1027,H_=1028,xh=1029,G_=1030,Sh=1031,yh=1033,Sc=33776,yc=33777,Mc=33778,Ec=33779,Fd=35840,Id=35841,Hd=35842,Gd=35843,Vd=36196,kd=37492,Xd=37496,Wd=37808,qd=37809,Yd=37810,Zd=37811,jd=37812,Kd=37813,Qd=37814,Jd=37815,$d=37816,th=37817,eh=37818,nh=37819,ih=37820,ah=37821,Tc=36492,rh=36494,sh=36495,V_=36283,oh=36284,lh=36285,ch=36286,ry=3200,sy=3201,k_=0,oy=1,Ba="",ui="srgb",Rs="srgb-linear",Rc="linear",Ge="srgb",rs=7680,b0=519,ly=512,cy=513,uy=514,X_=515,fy=516,dy=517,hy=518,py=519,A0=35044,R0="300 es",Di=2e3,Cc=2001;class ws{addEventListener(e,i){this._listeners===void 0&&(this._listeners={});const r=this._listeners;r[e]===void 0&&(r[e]=[]),r[e].indexOf(i)===-1&&r[e].push(i)}hasEventListener(e,i){const r=this._listeners;return r===void 0?!1:r[e]!==void 0&&r[e].indexOf(i)!==-1}removeEventListener(e,i){const r=this._listeners;if(r===void 0)return;const l=r[e];if(l!==void 0){const c=l.indexOf(i);c!==-1&&l.splice(c,1)}}dispatchEvent(e){const i=this._listeners;if(i===void 0)return;const r=i[e.type];if(r!==void 0){e.target=this;const l=r.slice(0);for(let c=0,d=l.length;c<d;c++)l[c].call(this,e);e.target=null}}}const bn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let C0=1234567;const wo=Math.PI/180,zo=180/Math.PI;function Ds(){const s=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0,r=Math.random()*4294967295|0;return(bn[s&255]+bn[s>>8&255]+bn[s>>16&255]+bn[s>>24&255]+"-"+bn[e&255]+bn[e>>8&255]+"-"+bn[e>>16&15|64]+bn[e>>24&255]+"-"+bn[i&63|128]+bn[i>>8&255]+"-"+bn[i>>16&255]+bn[i>>24&255]+bn[r&255]+bn[r>>8&255]+bn[r>>16&255]+bn[r>>24&255]).toLowerCase()}function ye(s,e,i){return Math.max(e,Math.min(i,s))}function Mh(s,e){return(s%e+e)%e}function my(s,e,i,r,l){return r+(s-e)*(l-r)/(i-e)}function gy(s,e,i){return s!==e?(i-s)/(e-s):0}function Do(s,e,i){return(1-i)*s+i*e}function _y(s,e,i,r){return Do(s,e,1-Math.exp(-i*r))}function vy(s,e=1){return e-Math.abs(Mh(s,e*2)-e)}function xy(s,e,i){return s<=e?0:s>=i?1:(s=(s-e)/(i-e),s*s*(3-2*s))}function Sy(s,e,i){return s<=e?0:s>=i?1:(s=(s-e)/(i-e),s*s*s*(s*(s*6-15)+10))}function yy(s,e){return s+Math.floor(Math.random()*(e-s+1))}function My(s,e){return s+Math.random()*(e-s)}function Ey(s){return s*(.5-Math.random())}function Ty(s){s!==void 0&&(C0=s);let e=C0+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function by(s){return s*wo}function Ay(s){return s*zo}function Ry(s){return(s&s-1)===0&&s!==0}function Cy(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function wy(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function Dy(s,e,i,r,l){const c=Math.cos,d=Math.sin,h=c(i/2),m=d(i/2),p=c((e+r)/2),v=d((e+r)/2),g=c((e-r)/2),S=d((e-r)/2),M=c((r-e)/2),T=d((r-e)/2);switch(l){case"XYX":s.set(h*v,m*g,m*S,h*p);break;case"YZY":s.set(m*S,h*v,m*g,h*p);break;case"ZXZ":s.set(m*g,m*S,h*v,h*p);break;case"XZX":s.set(h*v,m*T,m*M,h*p);break;case"YXY":s.set(m*M,h*v,m*T,h*p);break;case"ZYZ":s.set(m*T,m*M,h*v,h*p);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+l)}}function xs(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("Invalid component type.")}}function Ln(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("Invalid component type.")}}const Ui={DEG2RAD:wo,RAD2DEG:zo,generateUUID:Ds,clamp:ye,euclideanModulo:Mh,mapLinear:my,inverseLerp:gy,lerp:Do,damp:_y,pingpong:vy,smoothstep:xy,smootherstep:Sy,randInt:yy,randFloat:My,randFloatSpread:Ey,seededRandom:Ty,degToRad:by,radToDeg:Ay,isPowerOfTwo:Ry,ceilPowerOfTwo:Cy,floorPowerOfTwo:wy,setQuaternionFromProperEuler:Dy,normalize:Ln,denormalize:xs};class Ae{constructor(e=0,i=0){Ae.prototype.isVector2=!0,this.x=e,this.y=i}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,i){return this.x=e,this.y=i,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,i){switch(e){case 0:this.x=i;break;case 1:this.y=i;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,i){return this.x=e.x+i.x,this.y=e.y+i.y,this}addScaledVector(e,i){return this.x+=e.x*i,this.y+=e.y*i,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,i){return this.x=e.x-i.x,this.y=e.y-i.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const i=this.x,r=this.y,l=e.elements;return this.x=l[0]*i+l[3]*r+l[6],this.y=l[1]*i+l[4]*r+l[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,i){return this.x=ye(this.x,e.x,i.x),this.y=ye(this.y,e.y,i.y),this}clampScalar(e,i){return this.x=ye(this.x,e,i),this.y=ye(this.y,e,i),this}clampLength(e,i){const r=this.length();return this.divideScalar(r||1).multiplyScalar(ye(r,e,i))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const i=Math.sqrt(this.lengthSq()*e.lengthSq());if(i===0)return Math.PI/2;const r=this.dot(e)/i;return Math.acos(ye(r,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const i=this.x-e.x,r=this.y-e.y;return i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,i){return this.x+=(e.x-this.x)*i,this.y+=(e.y-this.y)*i,this}lerpVectors(e,i,r){return this.x=e.x+(i.x-e.x)*r,this.y=e.y+(i.y-e.y)*r,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,i=0){return this.x=e[i],this.y=e[i+1],this}toArray(e=[],i=0){return e[i]=this.x,e[i+1]=this.y,e}fromBufferAttribute(e,i){return this.x=e.getX(i),this.y=e.getY(i),this}rotateAround(e,i){const r=Math.cos(i),l=Math.sin(i),c=this.x-e.x,d=this.y-e.y;return this.x=c*r-d*l+e.x,this.y=c*l+d*r+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Mr{constructor(e=0,i=0,r=0,l=1){this.isQuaternion=!0,this._x=e,this._y=i,this._z=r,this._w=l}static slerpFlat(e,i,r,l,c,d,h){let m=r[l+0],p=r[l+1],v=r[l+2],g=r[l+3];const S=c[d+0],M=c[d+1],T=c[d+2],R=c[d+3];if(h===0){e[i+0]=m,e[i+1]=p,e[i+2]=v,e[i+3]=g;return}if(h===1){e[i+0]=S,e[i+1]=M,e[i+2]=T,e[i+3]=R;return}if(g!==R||m!==S||p!==M||v!==T){let y=1-h;const _=m*S+p*M+v*T+g*R,I=_>=0?1:-1,z=1-_*_;if(z>Number.EPSILON){const H=Math.sqrt(z),L=Math.atan2(H,_*I);y=Math.sin(y*L)/H,h=Math.sin(h*L)/H}const D=h*I;if(m=m*y+S*D,p=p*y+M*D,v=v*y+T*D,g=g*y+R*D,y===1-h){const H=1/Math.sqrt(m*m+p*p+v*v+g*g);m*=H,p*=H,v*=H,g*=H}}e[i]=m,e[i+1]=p,e[i+2]=v,e[i+3]=g}static multiplyQuaternionsFlat(e,i,r,l,c,d){const h=r[l],m=r[l+1],p=r[l+2],v=r[l+3],g=c[d],S=c[d+1],M=c[d+2],T=c[d+3];return e[i]=h*T+v*g+m*M-p*S,e[i+1]=m*T+v*S+p*g-h*M,e[i+2]=p*T+v*M+h*S-m*g,e[i+3]=v*T-h*g-m*S-p*M,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,i,r,l){return this._x=e,this._y=i,this._z=r,this._w=l,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,i=!0){const r=e._x,l=e._y,c=e._z,d=e._order,h=Math.cos,m=Math.sin,p=h(r/2),v=h(l/2),g=h(c/2),S=m(r/2),M=m(l/2),T=m(c/2);switch(d){case"XYZ":this._x=S*v*g+p*M*T,this._y=p*M*g-S*v*T,this._z=p*v*T+S*M*g,this._w=p*v*g-S*M*T;break;case"YXZ":this._x=S*v*g+p*M*T,this._y=p*M*g-S*v*T,this._z=p*v*T-S*M*g,this._w=p*v*g+S*M*T;break;case"ZXY":this._x=S*v*g-p*M*T,this._y=p*M*g+S*v*T,this._z=p*v*T+S*M*g,this._w=p*v*g-S*M*T;break;case"ZYX":this._x=S*v*g-p*M*T,this._y=p*M*g+S*v*T,this._z=p*v*T-S*M*g,this._w=p*v*g+S*M*T;break;case"YZX":this._x=S*v*g+p*M*T,this._y=p*M*g+S*v*T,this._z=p*v*T-S*M*g,this._w=p*v*g-S*M*T;break;case"XZY":this._x=S*v*g-p*M*T,this._y=p*M*g-S*v*T,this._z=p*v*T+S*M*g,this._w=p*v*g+S*M*T;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+d)}return i===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,i){const r=i/2,l=Math.sin(r);return this._x=e.x*l,this._y=e.y*l,this._z=e.z*l,this._w=Math.cos(r),this._onChangeCallback(),this}setFromRotationMatrix(e){const i=e.elements,r=i[0],l=i[4],c=i[8],d=i[1],h=i[5],m=i[9],p=i[2],v=i[6],g=i[10],S=r+h+g;if(S>0){const M=.5/Math.sqrt(S+1);this._w=.25/M,this._x=(v-m)*M,this._y=(c-p)*M,this._z=(d-l)*M}else if(r>h&&r>g){const M=2*Math.sqrt(1+r-h-g);this._w=(v-m)/M,this._x=.25*M,this._y=(l+d)/M,this._z=(c+p)/M}else if(h>g){const M=2*Math.sqrt(1+h-r-g);this._w=(c-p)/M,this._x=(l+d)/M,this._y=.25*M,this._z=(m+v)/M}else{const M=2*Math.sqrt(1+g-r-h);this._w=(d-l)/M,this._x=(c+p)/M,this._y=(m+v)/M,this._z=.25*M}return this._onChangeCallback(),this}setFromUnitVectors(e,i){let r=e.dot(i)+1;return r<1e-8?(r=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=r):(this._x=0,this._y=-e.z,this._z=e.y,this._w=r)):(this._x=e.y*i.z-e.z*i.y,this._y=e.z*i.x-e.x*i.z,this._z=e.x*i.y-e.y*i.x,this._w=r),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(ye(this.dot(e),-1,1)))}rotateTowards(e,i){const r=this.angleTo(e);if(r===0)return this;const l=Math.min(1,i/r);return this.slerp(e,l),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,i){const r=e._x,l=e._y,c=e._z,d=e._w,h=i._x,m=i._y,p=i._z,v=i._w;return this._x=r*v+d*h+l*p-c*m,this._y=l*v+d*m+c*h-r*p,this._z=c*v+d*p+r*m-l*h,this._w=d*v-r*h-l*m-c*p,this._onChangeCallback(),this}slerp(e,i){if(i===0)return this;if(i===1)return this.copy(e);const r=this._x,l=this._y,c=this._z,d=this._w;let h=d*e._w+r*e._x+l*e._y+c*e._z;if(h<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,h=-h):this.copy(e),h>=1)return this._w=d,this._x=r,this._y=l,this._z=c,this;const m=1-h*h;if(m<=Number.EPSILON){const M=1-i;return this._w=M*d+i*this._w,this._x=M*r+i*this._x,this._y=M*l+i*this._y,this._z=M*c+i*this._z,this.normalize(),this}const p=Math.sqrt(m),v=Math.atan2(p,h),g=Math.sin((1-i)*v)/p,S=Math.sin(i*v)/p;return this._w=d*g+this._w*S,this._x=r*g+this._x*S,this._y=l*g+this._y*S,this._z=c*g+this._z*S,this._onChangeCallback(),this}slerpQuaternions(e,i,r){return this.copy(e).slerp(i,r)}random(){const e=2*Math.PI*Math.random(),i=2*Math.PI*Math.random(),r=Math.random(),l=Math.sqrt(1-r),c=Math.sqrt(r);return this.set(l*Math.sin(e),l*Math.cos(e),c*Math.sin(i),c*Math.cos(i))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,i=0){return this._x=e[i],this._y=e[i+1],this._z=e[i+2],this._w=e[i+3],this._onChangeCallback(),this}toArray(e=[],i=0){return e[i]=this._x,e[i+1]=this._y,e[i+2]=this._z,e[i+3]=this._w,e}fromBufferAttribute(e,i){return this._x=e.getX(i),this._y=e.getY(i),this._z=e.getZ(i),this._w=e.getW(i),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class ${constructor(e=0,i=0,r=0){$.prototype.isVector3=!0,this.x=e,this.y=i,this.z=r}set(e,i,r){return r===void 0&&(r=this.z),this.x=e,this.y=i,this.z=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,i){switch(e){case 0:this.x=i;break;case 1:this.y=i;break;case 2:this.z=i;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,i){return this.x=e.x+i.x,this.y=e.y+i.y,this.z=e.z+i.z,this}addScaledVector(e,i){return this.x+=e.x*i,this.y+=e.y*i,this.z+=e.z*i,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,i){return this.x=e.x-i.x,this.y=e.y-i.y,this.z=e.z-i.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,i){return this.x=e.x*i.x,this.y=e.y*i.y,this.z=e.z*i.z,this}applyEuler(e){return this.applyQuaternion(w0.setFromEuler(e))}applyAxisAngle(e,i){return this.applyQuaternion(w0.setFromAxisAngle(e,i))}applyMatrix3(e){const i=this.x,r=this.y,l=this.z,c=e.elements;return this.x=c[0]*i+c[3]*r+c[6]*l,this.y=c[1]*i+c[4]*r+c[7]*l,this.z=c[2]*i+c[5]*r+c[8]*l,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const i=this.x,r=this.y,l=this.z,c=e.elements,d=1/(c[3]*i+c[7]*r+c[11]*l+c[15]);return this.x=(c[0]*i+c[4]*r+c[8]*l+c[12])*d,this.y=(c[1]*i+c[5]*r+c[9]*l+c[13])*d,this.z=(c[2]*i+c[6]*r+c[10]*l+c[14])*d,this}applyQuaternion(e){const i=this.x,r=this.y,l=this.z,c=e.x,d=e.y,h=e.z,m=e.w,p=2*(d*l-h*r),v=2*(h*i-c*l),g=2*(c*r-d*i);return this.x=i+m*p+d*g-h*v,this.y=r+m*v+h*p-c*g,this.z=l+m*g+c*v-d*p,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const i=this.x,r=this.y,l=this.z,c=e.elements;return this.x=c[0]*i+c[4]*r+c[8]*l,this.y=c[1]*i+c[5]*r+c[9]*l,this.z=c[2]*i+c[6]*r+c[10]*l,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,i){return this.x=ye(this.x,e.x,i.x),this.y=ye(this.y,e.y,i.y),this.z=ye(this.z,e.z,i.z),this}clampScalar(e,i){return this.x=ye(this.x,e,i),this.y=ye(this.y,e,i),this.z=ye(this.z,e,i),this}clampLength(e,i){const r=this.length();return this.divideScalar(r||1).multiplyScalar(ye(r,e,i))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,i){return this.x+=(e.x-this.x)*i,this.y+=(e.y-this.y)*i,this.z+=(e.z-this.z)*i,this}lerpVectors(e,i,r){return this.x=e.x+(i.x-e.x)*r,this.y=e.y+(i.y-e.y)*r,this.z=e.z+(i.z-e.z)*r,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,i){const r=e.x,l=e.y,c=e.z,d=i.x,h=i.y,m=i.z;return this.x=l*m-c*h,this.y=c*d-r*m,this.z=r*h-l*d,this}projectOnVector(e){const i=e.lengthSq();if(i===0)return this.set(0,0,0);const r=e.dot(this)/i;return this.copy(e).multiplyScalar(r)}projectOnPlane(e){return Yf.copy(this).projectOnVector(e),this.sub(Yf)}reflect(e){return this.sub(Yf.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const i=Math.sqrt(this.lengthSq()*e.lengthSq());if(i===0)return Math.PI/2;const r=this.dot(e)/i;return Math.acos(ye(r,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const i=this.x-e.x,r=this.y-e.y,l=this.z-e.z;return i*i+r*r+l*l}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,i,r){const l=Math.sin(i)*e;return this.x=l*Math.sin(r),this.y=Math.cos(i)*e,this.z=l*Math.cos(r),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,i,r){return this.x=e*Math.sin(i),this.y=r,this.z=e*Math.cos(i),this}setFromMatrixPosition(e){const i=e.elements;return this.x=i[12],this.y=i[13],this.z=i[14],this}setFromMatrixScale(e){const i=this.setFromMatrixColumn(e,0).length(),r=this.setFromMatrixColumn(e,1).length(),l=this.setFromMatrixColumn(e,2).length();return this.x=i,this.y=r,this.z=l,this}setFromMatrixColumn(e,i){return this.fromArray(e.elements,i*4)}setFromMatrix3Column(e,i){return this.fromArray(e.elements,i*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,i=0){return this.x=e[i],this.y=e[i+1],this.z=e[i+2],this}toArray(e=[],i=0){return e[i]=this.x,e[i+1]=this.y,e[i+2]=this.z,e}fromBufferAttribute(e,i){return this.x=e.getX(i),this.y=e.getY(i),this.z=e.getZ(i),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,i=Math.random()*2-1,r=Math.sqrt(1-i*i);return this.x=r*Math.cos(e),this.y=i,this.z=r*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const Yf=new $,w0=new Mr;class oe{constructor(e,i,r,l,c,d,h,m,p){oe.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,i,r,l,c,d,h,m,p)}set(e,i,r,l,c,d,h,m,p){const v=this.elements;return v[0]=e,v[1]=l,v[2]=h,v[3]=i,v[4]=c,v[5]=m,v[6]=r,v[7]=d,v[8]=p,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const i=this.elements,r=e.elements;return i[0]=r[0],i[1]=r[1],i[2]=r[2],i[3]=r[3],i[4]=r[4],i[5]=r[5],i[6]=r[6],i[7]=r[7],i[8]=r[8],this}extractBasis(e,i,r){return e.setFromMatrix3Column(this,0),i.setFromMatrix3Column(this,1),r.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const i=e.elements;return this.set(i[0],i[4],i[8],i[1],i[5],i[9],i[2],i[6],i[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,i){const r=e.elements,l=i.elements,c=this.elements,d=r[0],h=r[3],m=r[6],p=r[1],v=r[4],g=r[7],S=r[2],M=r[5],T=r[8],R=l[0],y=l[3],_=l[6],I=l[1],z=l[4],D=l[7],H=l[2],L=l[5],U=l[8];return c[0]=d*R+h*I+m*H,c[3]=d*y+h*z+m*L,c[6]=d*_+h*D+m*U,c[1]=p*R+v*I+g*H,c[4]=p*y+v*z+g*L,c[7]=p*_+v*D+g*U,c[2]=S*R+M*I+T*H,c[5]=S*y+M*z+T*L,c[8]=S*_+M*D+T*U,this}multiplyScalar(e){const i=this.elements;return i[0]*=e,i[3]*=e,i[6]*=e,i[1]*=e,i[4]*=e,i[7]*=e,i[2]*=e,i[5]*=e,i[8]*=e,this}determinant(){const e=this.elements,i=e[0],r=e[1],l=e[2],c=e[3],d=e[4],h=e[5],m=e[6],p=e[7],v=e[8];return i*d*v-i*h*p-r*c*v+r*h*m+l*c*p-l*d*m}invert(){const e=this.elements,i=e[0],r=e[1],l=e[2],c=e[3],d=e[4],h=e[5],m=e[6],p=e[7],v=e[8],g=v*d-h*p,S=h*m-v*c,M=p*c-d*m,T=i*g+r*S+l*M;if(T===0)return this.set(0,0,0,0,0,0,0,0,0);const R=1/T;return e[0]=g*R,e[1]=(l*p-v*r)*R,e[2]=(h*r-l*d)*R,e[3]=S*R,e[4]=(v*i-l*m)*R,e[5]=(l*c-h*i)*R,e[6]=M*R,e[7]=(r*m-p*i)*R,e[8]=(d*i-r*c)*R,this}transpose(){let e;const i=this.elements;return e=i[1],i[1]=i[3],i[3]=e,e=i[2],i[2]=i[6],i[6]=e,e=i[5],i[5]=i[7],i[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const i=this.elements;return e[0]=i[0],e[1]=i[3],e[2]=i[6],e[3]=i[1],e[4]=i[4],e[5]=i[7],e[6]=i[2],e[7]=i[5],e[8]=i[8],this}setUvTransform(e,i,r,l,c,d,h){const m=Math.cos(c),p=Math.sin(c);return this.set(r*m,r*p,-r*(m*d+p*h)+d+e,-l*p,l*m,-l*(-p*d+m*h)+h+i,0,0,1),this}scale(e,i){return this.premultiply(Zf.makeScale(e,i)),this}rotate(e){return this.premultiply(Zf.makeRotation(-e)),this}translate(e,i){return this.premultiply(Zf.makeTranslation(e,i)),this}makeTranslation(e,i){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,i,0,0,1),this}makeRotation(e){const i=Math.cos(e),r=Math.sin(e);return this.set(i,-r,0,r,i,0,0,0,1),this}makeScale(e,i){return this.set(e,0,0,0,i,0,0,0,1),this}equals(e){const i=this.elements,r=e.elements;for(let l=0;l<9;l++)if(i[l]!==r[l])return!1;return!0}fromArray(e,i=0){for(let r=0;r<9;r++)this.elements[r]=e[r+i];return this}toArray(e=[],i=0){const r=this.elements;return e[i]=r[0],e[i+1]=r[1],e[i+2]=r[2],e[i+3]=r[3],e[i+4]=r[4],e[i+5]=r[5],e[i+6]=r[6],e[i+7]=r[7],e[i+8]=r[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const Zf=new oe;function W_(s){for(let e=s.length-1;e>=0;--e)if(s[e]>=65535)return!0;return!1}function wc(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function Uy(){const s=wc("canvas");return s.style.display="block",s}const D0={};function Ms(s){s in D0||(D0[s]=!0,console.warn(s))}function Ly(s,e,i){return new Promise(function(r,l){function c(){switch(s.clientWaitSync(e,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:l();break;case s.TIMEOUT_EXPIRED:setTimeout(c,i);break;default:r()}}setTimeout(c,i)})}const U0=new oe().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),L0=new oe().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Ny(){const s={enabled:!0,workingColorSpace:Rs,spaces:{},convert:function(l,c,d){return this.enabled===!1||c===d||!c||!d||(this.spaces[c].transfer===Ge&&(l.r=sa(l.r),l.g=sa(l.g),l.b=sa(l.b)),this.spaces[c].primaries!==this.spaces[d].primaries&&(l.applyMatrix3(this.spaces[c].toXYZ),l.applyMatrix3(this.spaces[d].fromXYZ)),this.spaces[d].transfer===Ge&&(l.r=Es(l.r),l.g=Es(l.g),l.b=Es(l.b))),l},workingToColorSpace:function(l,c){return this.convert(l,this.workingColorSpace,c)},colorSpaceToWorking:function(l,c){return this.convert(l,c,this.workingColorSpace)},getPrimaries:function(l){return this.spaces[l].primaries},getTransfer:function(l){return l===Ba?Rc:this.spaces[l].transfer},getLuminanceCoefficients:function(l,c=this.workingColorSpace){return l.fromArray(this.spaces[c].luminanceCoefficients)},define:function(l){Object.assign(this.spaces,l)},_getMatrix:function(l,c,d){return l.copy(this.spaces[c].toXYZ).multiply(this.spaces[d].fromXYZ)},_getDrawingBufferColorSpace:function(l){return this.spaces[l].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(l=this.workingColorSpace){return this.spaces[l].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(l,c){return Ms("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(l,c)},toWorkingColorSpace:function(l,c){return Ms("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(l,c)}},e=[.64,.33,.3,.6,.15,.06],i=[.2126,.7152,.0722],r=[.3127,.329];return s.define({[Rs]:{primaries:e,whitePoint:r,transfer:Rc,toXYZ:U0,fromXYZ:L0,luminanceCoefficients:i,workingColorSpaceConfig:{unpackColorSpace:ui},outputColorSpaceConfig:{drawingBufferColorSpace:ui}},[ui]:{primaries:e,whitePoint:r,transfer:Ge,toXYZ:U0,fromXYZ:L0,luminanceCoefficients:i,outputColorSpaceConfig:{drawingBufferColorSpace:ui}}}),s}const we=Ny();function sa(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function Es(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}let ss;class Oy{static getDataURL(e,i="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let r;if(e instanceof HTMLCanvasElement)r=e;else{ss===void 0&&(ss=wc("canvas")),ss.width=e.width,ss.height=e.height;const l=ss.getContext("2d");e instanceof ImageData?l.putImageData(e,0,0):l.drawImage(e,0,0,e.width,e.height),r=ss}return r.toDataURL(i)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const i=wc("canvas");i.width=e.width,i.height=e.height;const r=i.getContext("2d");r.drawImage(e,0,0,e.width,e.height);const l=r.getImageData(0,0,e.width,e.height),c=l.data;for(let d=0;d<c.length;d++)c[d]=sa(c[d]/255)*255;return r.putImageData(l,0,0),i}else if(e.data){const i=e.data.slice(0);for(let r=0;r<i.length;r++)i instanceof Uint8Array||i instanceof Uint8ClampedArray?i[r]=Math.floor(sa(i[r]/255)*255):i[r]=sa(i[r]);return{data:i,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let zy=0;class Eh{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:zy++}),this.uuid=Ds(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){const i=this.data;return i instanceof HTMLVideoElement?e.set(i.videoWidth,i.videoHeight,0):i instanceof VideoFrame?e.set(i.displayHeight,i.displayWidth,0):i!==null?e.set(i.width,i.height,i.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const i=e===void 0||typeof e=="string";if(!i&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const r={uuid:this.uuid,url:""},l=this.data;if(l!==null){let c;if(Array.isArray(l)){c=[];for(let d=0,h=l.length;d<h;d++)l[d].isDataTexture?c.push(jf(l[d].image)):c.push(jf(l[d]))}else c=jf(l);r.url=c}return i||(e.images[this.uuid]=r),r}}function jf(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?Oy.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Py=0;const Kf=new $;class Vn extends ws{constructor(e=Vn.DEFAULT_IMAGE,i=Vn.DEFAULT_MAPPING,r=_r,l=_r,c=wi,d=vr,h=xi,m=Li,p=Vn.DEFAULT_ANISOTROPY,v=Ba){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Py++}),this.uuid=Ds(),this.name="",this.source=new Eh(e),this.mipmaps=[],this.mapping=i,this.channel=0,this.wrapS=r,this.wrapT=l,this.magFilter=c,this.minFilter=d,this.anisotropy=p,this.format=h,this.internalFormat=null,this.type=m,this.offset=new Ae(0,0),this.repeat=new Ae(1,1),this.center=new Ae(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new oe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=v,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(Kf).x}get height(){return this.source.getSize(Kf).y}get depth(){return this.source.getSize(Kf).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,i){this.updateRanges.push({start:e,count:i})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(const i in e){const r=e[i];if(r===void 0){console.warn(`THREE.Texture.setValues(): parameter '${i}' has value of undefined.`);continue}const l=this[i];if(l===void 0){console.warn(`THREE.Texture.setValues(): property '${i}' does not exist.`);continue}l&&r&&l.isVector2&&r.isVector2||l&&r&&l.isVector3&&r.isVector3||l&&r&&l.isMatrix3&&r.isMatrix3?l.copy(r):this[i]=r}}toJSON(e){const i=e===void 0||typeof e=="string";if(!i&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const r={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(r.userData=this.userData),i||(e.textures[this.uuid]=r),r}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==O_)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Pd:e.x=e.x-Math.floor(e.x);break;case _r:e.x=e.x<0?0:1;break;case Bd:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Pd:e.y=e.y-Math.floor(e.y);break;case _r:e.y=e.y<0?0:1;break;case Bd:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}Vn.DEFAULT_IMAGE=null;Vn.DEFAULT_MAPPING=O_;Vn.DEFAULT_ANISOTROPY=1;class Je{constructor(e=0,i=0,r=0,l=1){Je.prototype.isVector4=!0,this.x=e,this.y=i,this.z=r,this.w=l}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,i,r,l){return this.x=e,this.y=i,this.z=r,this.w=l,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,i){switch(e){case 0:this.x=i;break;case 1:this.y=i;break;case 2:this.z=i;break;case 3:this.w=i;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,i){return this.x=e.x+i.x,this.y=e.y+i.y,this.z=e.z+i.z,this.w=e.w+i.w,this}addScaledVector(e,i){return this.x+=e.x*i,this.y+=e.y*i,this.z+=e.z*i,this.w+=e.w*i,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,i){return this.x=e.x-i.x,this.y=e.y-i.y,this.z=e.z-i.z,this.w=e.w-i.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const i=this.x,r=this.y,l=this.z,c=this.w,d=e.elements;return this.x=d[0]*i+d[4]*r+d[8]*l+d[12]*c,this.y=d[1]*i+d[5]*r+d[9]*l+d[13]*c,this.z=d[2]*i+d[6]*r+d[10]*l+d[14]*c,this.w=d[3]*i+d[7]*r+d[11]*l+d[15]*c,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const i=Math.sqrt(1-e.w*e.w);return i<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/i,this.y=e.y/i,this.z=e.z/i),this}setAxisAngleFromRotationMatrix(e){let i,r,l,c;const m=e.elements,p=m[0],v=m[4],g=m[8],S=m[1],M=m[5],T=m[9],R=m[2],y=m[6],_=m[10];if(Math.abs(v-S)<.01&&Math.abs(g-R)<.01&&Math.abs(T-y)<.01){if(Math.abs(v+S)<.1&&Math.abs(g+R)<.1&&Math.abs(T+y)<.1&&Math.abs(p+M+_-3)<.1)return this.set(1,0,0,0),this;i=Math.PI;const z=(p+1)/2,D=(M+1)/2,H=(_+1)/2,L=(v+S)/4,U=(g+R)/4,V=(T+y)/4;return z>D&&z>H?z<.01?(r=0,l=.707106781,c=.707106781):(r=Math.sqrt(z),l=L/r,c=U/r):D>H?D<.01?(r=.707106781,l=0,c=.707106781):(l=Math.sqrt(D),r=L/l,c=V/l):H<.01?(r=.707106781,l=.707106781,c=0):(c=Math.sqrt(H),r=U/c,l=V/c),this.set(r,l,c,i),this}let I=Math.sqrt((y-T)*(y-T)+(g-R)*(g-R)+(S-v)*(S-v));return Math.abs(I)<.001&&(I=1),this.x=(y-T)/I,this.y=(g-R)/I,this.z=(S-v)/I,this.w=Math.acos((p+M+_-1)/2),this}setFromMatrixPosition(e){const i=e.elements;return this.x=i[12],this.y=i[13],this.z=i[14],this.w=i[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,i){return this.x=ye(this.x,e.x,i.x),this.y=ye(this.y,e.y,i.y),this.z=ye(this.z,e.z,i.z),this.w=ye(this.w,e.w,i.w),this}clampScalar(e,i){return this.x=ye(this.x,e,i),this.y=ye(this.y,e,i),this.z=ye(this.z,e,i),this.w=ye(this.w,e,i),this}clampLength(e,i){const r=this.length();return this.divideScalar(r||1).multiplyScalar(ye(r,e,i))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,i){return this.x+=(e.x-this.x)*i,this.y+=(e.y-this.y)*i,this.z+=(e.z-this.z)*i,this.w+=(e.w-this.w)*i,this}lerpVectors(e,i,r){return this.x=e.x+(i.x-e.x)*r,this.y=e.y+(i.y-e.y)*r,this.z=e.z+(i.z-e.z)*r,this.w=e.w+(i.w-e.w)*r,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,i=0){return this.x=e[i],this.y=e[i+1],this.z=e[i+2],this.w=e[i+3],this}toArray(e=[],i=0){return e[i]=this.x,e[i+1]=this.y,e[i+2]=this.z,e[i+3]=this.w,e}fromBufferAttribute(e,i){return this.x=e.getX(i),this.y=e.getY(i),this.z=e.getZ(i),this.w=e.getW(i),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class By extends ws{constructor(e=1,i=1,r={}){super(),r=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:wi,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},r),this.isRenderTarget=!0,this.width=e,this.height=i,this.depth=r.depth,this.scissor=new Je(0,0,e,i),this.scissorTest=!1,this.viewport=new Je(0,0,e,i);const l={width:e,height:i,depth:r.depth},c=new Vn(l);this.textures=[];const d=r.count;for(let h=0;h<d;h++)this.textures[h]=c.clone(),this.textures[h].isRenderTargetTexture=!0,this.textures[h].renderTarget=this;this._setTextureOptions(r),this.depthBuffer=r.depthBuffer,this.stencilBuffer=r.stencilBuffer,this.resolveDepthBuffer=r.resolveDepthBuffer,this.resolveStencilBuffer=r.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=r.depthTexture,this.samples=r.samples,this.multiview=r.multiview}_setTextureOptions(e={}){const i={minFilter:wi,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(i.mapping=e.mapping),e.wrapS!==void 0&&(i.wrapS=e.wrapS),e.wrapT!==void 0&&(i.wrapT=e.wrapT),e.wrapR!==void 0&&(i.wrapR=e.wrapR),e.magFilter!==void 0&&(i.magFilter=e.magFilter),e.minFilter!==void 0&&(i.minFilter=e.minFilter),e.format!==void 0&&(i.format=e.format),e.type!==void 0&&(i.type=e.type),e.anisotropy!==void 0&&(i.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(i.colorSpace=e.colorSpace),e.flipY!==void 0&&(i.flipY=e.flipY),e.generateMipmaps!==void 0&&(i.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(i.internalFormat=e.internalFormat);for(let r=0;r<this.textures.length;r++)this.textures[r].setValues(i)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,i,r=1){if(this.width!==e||this.height!==i||this.depth!==r){this.width=e,this.height=i,this.depth=r;for(let l=0,c=this.textures.length;l<c;l++)this.textures[l].image.width=e,this.textures[l].image.height=i,this.textures[l].image.depth=r,this.textures[l].isArrayTexture=this.textures[l].image.depth>1;this.dispose()}this.viewport.set(0,0,e,i),this.scissor.set(0,0,e,i)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let i=0,r=e.textures.length;i<r;i++){this.textures[i]=e.textures[i].clone(),this.textures[i].isRenderTargetTexture=!0,this.textures[i].renderTarget=this;const l=Object.assign({},e.textures[i].image);this.textures[i].source=new Eh(l)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class yr extends By{constructor(e=1,i=1,r={}){super(e,i,r),this.isWebGLRenderTarget=!0}}class q_ extends Vn{constructor(e=null,i=1,r=1,l=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:i,height:r,depth:l},this.magFilter=Si,this.minFilter=Si,this.wrapR=_r,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Fy extends Vn{constructor(e=null,i=1,r=1,l=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:i,height:r,depth:l},this.magFilter=Si,this.minFilter=Si,this.wrapR=_r,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Bo{constructor(e=new $(1/0,1/0,1/0),i=new $(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=i}set(e,i){return this.min.copy(e),this.max.copy(i),this}setFromArray(e){this.makeEmpty();for(let i=0,r=e.length;i<r;i+=3)this.expandByPoint(mi.fromArray(e,i));return this}setFromBufferAttribute(e){this.makeEmpty();for(let i=0,r=e.count;i<r;i++)this.expandByPoint(mi.fromBufferAttribute(e,i));return this}setFromPoints(e){this.makeEmpty();for(let i=0,r=e.length;i<r;i++)this.expandByPoint(e[i]);return this}setFromCenterAndSize(e,i){const r=mi.copy(i).multiplyScalar(.5);return this.min.copy(e).sub(r),this.max.copy(e).add(r),this}setFromObject(e,i=!1){return this.makeEmpty(),this.expandByObject(e,i)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,i=!1){e.updateWorldMatrix(!1,!1);const r=e.geometry;if(r!==void 0){const c=r.getAttribute("position");if(i===!0&&c!==void 0&&e.isInstancedMesh!==!0)for(let d=0,h=c.count;d<h;d++)e.isMesh===!0?e.getVertexPosition(d,mi):mi.fromBufferAttribute(c,d),mi.applyMatrix4(e.matrixWorld),this.expandByPoint(mi);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Ql.copy(e.boundingBox)):(r.boundingBox===null&&r.computeBoundingBox(),Ql.copy(r.boundingBox)),Ql.applyMatrix4(e.matrixWorld),this.union(Ql)}const l=e.children;for(let c=0,d=l.length;c<d;c++)this.expandByObject(l[c],i);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,i){return i.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,mi),mi.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let i,r;return e.normal.x>0?(i=e.normal.x*this.min.x,r=e.normal.x*this.max.x):(i=e.normal.x*this.max.x,r=e.normal.x*this.min.x),e.normal.y>0?(i+=e.normal.y*this.min.y,r+=e.normal.y*this.max.y):(i+=e.normal.y*this.max.y,r+=e.normal.y*this.min.y),e.normal.z>0?(i+=e.normal.z*this.min.z,r+=e.normal.z*this.max.z):(i+=e.normal.z*this.max.z,r+=e.normal.z*this.min.z),i<=-e.constant&&r>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(To),Jl.subVectors(this.max,To),os.subVectors(e.a,To),ls.subVectors(e.b,To),cs.subVectors(e.c,To),Ua.subVectors(ls,os),La.subVectors(cs,ls),or.subVectors(os,cs);let i=[0,-Ua.z,Ua.y,0,-La.z,La.y,0,-or.z,or.y,Ua.z,0,-Ua.x,La.z,0,-La.x,or.z,0,-or.x,-Ua.y,Ua.x,0,-La.y,La.x,0,-or.y,or.x,0];return!Qf(i,os,ls,cs,Jl)||(i=[1,0,0,0,1,0,0,0,1],!Qf(i,os,ls,cs,Jl))?!1:($l.crossVectors(Ua,La),i=[$l.x,$l.y,$l.z],Qf(i,os,ls,cs,Jl))}clampPoint(e,i){return i.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,mi).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(mi).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Ji[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Ji[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Ji[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Ji[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Ji[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Ji[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Ji[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Ji[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Ji),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}}const Ji=[new $,new $,new $,new $,new $,new $,new $,new $],mi=new $,Ql=new Bo,os=new $,ls=new $,cs=new $,Ua=new $,La=new $,or=new $,To=new $,Jl=new $,$l=new $,lr=new $;function Qf(s,e,i,r,l){for(let c=0,d=s.length-3;c<=d;c+=3){lr.fromArray(s,c);const h=l.x*Math.abs(lr.x)+l.y*Math.abs(lr.y)+l.z*Math.abs(lr.z),m=e.dot(lr),p=i.dot(lr),v=r.dot(lr);if(Math.max(-Math.max(m,p,v),Math.min(m,p,v))>h)return!1}return!0}const Iy=new Bo,bo=new $,Jf=new $;class Th{constructor(e=new $,i=-1){this.isSphere=!0,this.center=e,this.radius=i}set(e,i){return this.center.copy(e),this.radius=i,this}setFromPoints(e,i){const r=this.center;i!==void 0?r.copy(i):Iy.setFromPoints(e).getCenter(r);let l=0;for(let c=0,d=e.length;c<d;c++)l=Math.max(l,r.distanceToSquared(e[c]));return this.radius=Math.sqrt(l),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const i=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=i*i}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,i){const r=this.center.distanceToSquared(e);return i.copy(e),r>this.radius*this.radius&&(i.sub(this.center).normalize(),i.multiplyScalar(this.radius).add(this.center)),i}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;bo.subVectors(e,this.center);const i=bo.lengthSq();if(i>this.radius*this.radius){const r=Math.sqrt(i),l=(r-this.radius)*.5;this.center.addScaledVector(bo,l/r),this.radius+=l}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Jf.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(bo.copy(e.center).add(Jf)),this.expandByPoint(bo.copy(e.center).sub(Jf))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}}const $i=new $,$f=new $,tc=new $,Na=new $,td=new $,ec=new $,ed=new $;class Y_{constructor(e=new $,i=new $(0,0,-1)){this.origin=e,this.direction=i}set(e,i){return this.origin.copy(e),this.direction.copy(i),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,i){return i.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,$i)),this}closestPointToPoint(e,i){i.subVectors(e,this.origin);const r=i.dot(this.direction);return r<0?i.copy(this.origin):i.copy(this.origin).addScaledVector(this.direction,r)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const i=$i.subVectors(e,this.origin).dot(this.direction);return i<0?this.origin.distanceToSquared(e):($i.copy(this.origin).addScaledVector(this.direction,i),$i.distanceToSquared(e))}distanceSqToSegment(e,i,r,l){$f.copy(e).add(i).multiplyScalar(.5),tc.copy(i).sub(e).normalize(),Na.copy(this.origin).sub($f);const c=e.distanceTo(i)*.5,d=-this.direction.dot(tc),h=Na.dot(this.direction),m=-Na.dot(tc),p=Na.lengthSq(),v=Math.abs(1-d*d);let g,S,M,T;if(v>0)if(g=d*m-h,S=d*h-m,T=c*v,g>=0)if(S>=-T)if(S<=T){const R=1/v;g*=R,S*=R,M=g*(g+d*S+2*h)+S*(d*g+S+2*m)+p}else S=c,g=Math.max(0,-(d*S+h)),M=-g*g+S*(S+2*m)+p;else S=-c,g=Math.max(0,-(d*S+h)),M=-g*g+S*(S+2*m)+p;else S<=-T?(g=Math.max(0,-(-d*c+h)),S=g>0?-c:Math.min(Math.max(-c,-m),c),M=-g*g+S*(S+2*m)+p):S<=T?(g=0,S=Math.min(Math.max(-c,-m),c),M=S*(S+2*m)+p):(g=Math.max(0,-(d*c+h)),S=g>0?c:Math.min(Math.max(-c,-m),c),M=-g*g+S*(S+2*m)+p);else S=d>0?-c:c,g=Math.max(0,-(d*S+h)),M=-g*g+S*(S+2*m)+p;return r&&r.copy(this.origin).addScaledVector(this.direction,g),l&&l.copy($f).addScaledVector(tc,S),M}intersectSphere(e,i){$i.subVectors(e.center,this.origin);const r=$i.dot(this.direction),l=$i.dot($i)-r*r,c=e.radius*e.radius;if(l>c)return null;const d=Math.sqrt(c-l),h=r-d,m=r+d;return m<0?null:h<0?this.at(m,i):this.at(h,i)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const i=e.normal.dot(this.direction);if(i===0)return e.distanceToPoint(this.origin)===0?0:null;const r=-(this.origin.dot(e.normal)+e.constant)/i;return r>=0?r:null}intersectPlane(e,i){const r=this.distanceToPlane(e);return r===null?null:this.at(r,i)}intersectsPlane(e){const i=e.distanceToPoint(this.origin);return i===0||e.normal.dot(this.direction)*i<0}intersectBox(e,i){let r,l,c,d,h,m;const p=1/this.direction.x,v=1/this.direction.y,g=1/this.direction.z,S=this.origin;return p>=0?(r=(e.min.x-S.x)*p,l=(e.max.x-S.x)*p):(r=(e.max.x-S.x)*p,l=(e.min.x-S.x)*p),v>=0?(c=(e.min.y-S.y)*v,d=(e.max.y-S.y)*v):(c=(e.max.y-S.y)*v,d=(e.min.y-S.y)*v),r>d||c>l||((c>r||isNaN(r))&&(r=c),(d<l||isNaN(l))&&(l=d),g>=0?(h=(e.min.z-S.z)*g,m=(e.max.z-S.z)*g):(h=(e.max.z-S.z)*g,m=(e.min.z-S.z)*g),r>m||h>l)||((h>r||r!==r)&&(r=h),(m<l||l!==l)&&(l=m),l<0)?null:this.at(r>=0?r:l,i)}intersectsBox(e){return this.intersectBox(e,$i)!==null}intersectTriangle(e,i,r,l,c){td.subVectors(i,e),ec.subVectors(r,e),ed.crossVectors(td,ec);let d=this.direction.dot(ed),h;if(d>0){if(l)return null;h=1}else if(d<0)h=-1,d=-d;else return null;Na.subVectors(this.origin,e);const m=h*this.direction.dot(ec.crossVectors(Na,ec));if(m<0)return null;const p=h*this.direction.dot(td.cross(Na));if(p<0||m+p>d)return null;const v=-h*Na.dot(ed);return v<0?null:this.at(v/d,c)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class $e{constructor(e,i,r,l,c,d,h,m,p,v,g,S,M,T,R,y){$e.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,i,r,l,c,d,h,m,p,v,g,S,M,T,R,y)}set(e,i,r,l,c,d,h,m,p,v,g,S,M,T,R,y){const _=this.elements;return _[0]=e,_[4]=i,_[8]=r,_[12]=l,_[1]=c,_[5]=d,_[9]=h,_[13]=m,_[2]=p,_[6]=v,_[10]=g,_[14]=S,_[3]=M,_[7]=T,_[11]=R,_[15]=y,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new $e().fromArray(this.elements)}copy(e){const i=this.elements,r=e.elements;return i[0]=r[0],i[1]=r[1],i[2]=r[2],i[3]=r[3],i[4]=r[4],i[5]=r[5],i[6]=r[6],i[7]=r[7],i[8]=r[8],i[9]=r[9],i[10]=r[10],i[11]=r[11],i[12]=r[12],i[13]=r[13],i[14]=r[14],i[15]=r[15],this}copyPosition(e){const i=this.elements,r=e.elements;return i[12]=r[12],i[13]=r[13],i[14]=r[14],this}setFromMatrix3(e){const i=e.elements;return this.set(i[0],i[3],i[6],0,i[1],i[4],i[7],0,i[2],i[5],i[8],0,0,0,0,1),this}extractBasis(e,i,r){return e.setFromMatrixColumn(this,0),i.setFromMatrixColumn(this,1),r.setFromMatrixColumn(this,2),this}makeBasis(e,i,r){return this.set(e.x,i.x,r.x,0,e.y,i.y,r.y,0,e.z,i.z,r.z,0,0,0,0,1),this}extractRotation(e){const i=this.elements,r=e.elements,l=1/us.setFromMatrixColumn(e,0).length(),c=1/us.setFromMatrixColumn(e,1).length(),d=1/us.setFromMatrixColumn(e,2).length();return i[0]=r[0]*l,i[1]=r[1]*l,i[2]=r[2]*l,i[3]=0,i[4]=r[4]*c,i[5]=r[5]*c,i[6]=r[6]*c,i[7]=0,i[8]=r[8]*d,i[9]=r[9]*d,i[10]=r[10]*d,i[11]=0,i[12]=0,i[13]=0,i[14]=0,i[15]=1,this}makeRotationFromEuler(e){const i=this.elements,r=e.x,l=e.y,c=e.z,d=Math.cos(r),h=Math.sin(r),m=Math.cos(l),p=Math.sin(l),v=Math.cos(c),g=Math.sin(c);if(e.order==="XYZ"){const S=d*v,M=d*g,T=h*v,R=h*g;i[0]=m*v,i[4]=-m*g,i[8]=p,i[1]=M+T*p,i[5]=S-R*p,i[9]=-h*m,i[2]=R-S*p,i[6]=T+M*p,i[10]=d*m}else if(e.order==="YXZ"){const S=m*v,M=m*g,T=p*v,R=p*g;i[0]=S+R*h,i[4]=T*h-M,i[8]=d*p,i[1]=d*g,i[5]=d*v,i[9]=-h,i[2]=M*h-T,i[6]=R+S*h,i[10]=d*m}else if(e.order==="ZXY"){const S=m*v,M=m*g,T=p*v,R=p*g;i[0]=S-R*h,i[4]=-d*g,i[8]=T+M*h,i[1]=M+T*h,i[5]=d*v,i[9]=R-S*h,i[2]=-d*p,i[6]=h,i[10]=d*m}else if(e.order==="ZYX"){const S=d*v,M=d*g,T=h*v,R=h*g;i[0]=m*v,i[4]=T*p-M,i[8]=S*p+R,i[1]=m*g,i[5]=R*p+S,i[9]=M*p-T,i[2]=-p,i[6]=h*m,i[10]=d*m}else if(e.order==="YZX"){const S=d*m,M=d*p,T=h*m,R=h*p;i[0]=m*v,i[4]=R-S*g,i[8]=T*g+M,i[1]=g,i[5]=d*v,i[9]=-h*v,i[2]=-p*v,i[6]=M*g+T,i[10]=S-R*g}else if(e.order==="XZY"){const S=d*m,M=d*p,T=h*m,R=h*p;i[0]=m*v,i[4]=-g,i[8]=p*v,i[1]=S*g+R,i[5]=d*v,i[9]=M*g-T,i[2]=T*g-M,i[6]=h*v,i[10]=R*g+S}return i[3]=0,i[7]=0,i[11]=0,i[12]=0,i[13]=0,i[14]=0,i[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Hy,e,Gy)}lookAt(e,i,r){const l=this.elements;return Qn.subVectors(e,i),Qn.lengthSq()===0&&(Qn.z=1),Qn.normalize(),Oa.crossVectors(r,Qn),Oa.lengthSq()===0&&(Math.abs(r.z)===1?Qn.x+=1e-4:Qn.z+=1e-4,Qn.normalize(),Oa.crossVectors(r,Qn)),Oa.normalize(),nc.crossVectors(Qn,Oa),l[0]=Oa.x,l[4]=nc.x,l[8]=Qn.x,l[1]=Oa.y,l[5]=nc.y,l[9]=Qn.y,l[2]=Oa.z,l[6]=nc.z,l[10]=Qn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,i){const r=e.elements,l=i.elements,c=this.elements,d=r[0],h=r[4],m=r[8],p=r[12],v=r[1],g=r[5],S=r[9],M=r[13],T=r[2],R=r[6],y=r[10],_=r[14],I=r[3],z=r[7],D=r[11],H=r[15],L=l[0],U=l[4],V=l[8],A=l[12],w=l[1],N=l[5],J=l[9],tt=l[13],rt=l[2],ct=l[6],B=l[10],q=l[14],j=l[3],yt=l[7],St=l[11],P=l[15];return c[0]=d*L+h*w+m*rt+p*j,c[4]=d*U+h*N+m*ct+p*yt,c[8]=d*V+h*J+m*B+p*St,c[12]=d*A+h*tt+m*q+p*P,c[1]=v*L+g*w+S*rt+M*j,c[5]=v*U+g*N+S*ct+M*yt,c[9]=v*V+g*J+S*B+M*St,c[13]=v*A+g*tt+S*q+M*P,c[2]=T*L+R*w+y*rt+_*j,c[6]=T*U+R*N+y*ct+_*yt,c[10]=T*V+R*J+y*B+_*St,c[14]=T*A+R*tt+y*q+_*P,c[3]=I*L+z*w+D*rt+H*j,c[7]=I*U+z*N+D*ct+H*yt,c[11]=I*V+z*J+D*B+H*St,c[15]=I*A+z*tt+D*q+H*P,this}multiplyScalar(e){const i=this.elements;return i[0]*=e,i[4]*=e,i[8]*=e,i[12]*=e,i[1]*=e,i[5]*=e,i[9]*=e,i[13]*=e,i[2]*=e,i[6]*=e,i[10]*=e,i[14]*=e,i[3]*=e,i[7]*=e,i[11]*=e,i[15]*=e,this}determinant(){const e=this.elements,i=e[0],r=e[4],l=e[8],c=e[12],d=e[1],h=e[5],m=e[9],p=e[13],v=e[2],g=e[6],S=e[10],M=e[14],T=e[3],R=e[7],y=e[11],_=e[15];return T*(+c*m*g-l*p*g-c*h*S+r*p*S+l*h*M-r*m*M)+R*(+i*m*M-i*p*S+c*d*S-l*d*M+l*p*v-c*m*v)+y*(+i*p*g-i*h*M-c*d*g+r*d*M+c*h*v-r*p*v)+_*(-l*h*v-i*m*g+i*h*S+l*d*g-r*d*S+r*m*v)}transpose(){const e=this.elements;let i;return i=e[1],e[1]=e[4],e[4]=i,i=e[2],e[2]=e[8],e[8]=i,i=e[6],e[6]=e[9],e[9]=i,i=e[3],e[3]=e[12],e[12]=i,i=e[7],e[7]=e[13],e[13]=i,i=e[11],e[11]=e[14],e[14]=i,this}setPosition(e,i,r){const l=this.elements;return e.isVector3?(l[12]=e.x,l[13]=e.y,l[14]=e.z):(l[12]=e,l[13]=i,l[14]=r),this}invert(){const e=this.elements,i=e[0],r=e[1],l=e[2],c=e[3],d=e[4],h=e[5],m=e[6],p=e[7],v=e[8],g=e[9],S=e[10],M=e[11],T=e[12],R=e[13],y=e[14],_=e[15],I=g*y*p-R*S*p+R*m*M-h*y*M-g*m*_+h*S*_,z=T*S*p-v*y*p-T*m*M+d*y*M+v*m*_-d*S*_,D=v*R*p-T*g*p+T*h*M-d*R*M-v*h*_+d*g*_,H=T*g*m-v*R*m-T*h*S+d*R*S+v*h*y-d*g*y,L=i*I+r*z+l*D+c*H;if(L===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const U=1/L;return e[0]=I*U,e[1]=(R*S*c-g*y*c-R*l*M+r*y*M+g*l*_-r*S*_)*U,e[2]=(h*y*c-R*m*c+R*l*p-r*y*p-h*l*_+r*m*_)*U,e[3]=(g*m*c-h*S*c-g*l*p+r*S*p+h*l*M-r*m*M)*U,e[4]=z*U,e[5]=(v*y*c-T*S*c+T*l*M-i*y*M-v*l*_+i*S*_)*U,e[6]=(T*m*c-d*y*c-T*l*p+i*y*p+d*l*_-i*m*_)*U,e[7]=(d*S*c-v*m*c+v*l*p-i*S*p-d*l*M+i*m*M)*U,e[8]=D*U,e[9]=(T*g*c-v*R*c-T*r*M+i*R*M+v*r*_-i*g*_)*U,e[10]=(d*R*c-T*h*c+T*r*p-i*R*p-d*r*_+i*h*_)*U,e[11]=(v*h*c-d*g*c-v*r*p+i*g*p+d*r*M-i*h*M)*U,e[12]=H*U,e[13]=(v*R*l-T*g*l+T*r*S-i*R*S-v*r*y+i*g*y)*U,e[14]=(T*h*l-d*R*l-T*r*m+i*R*m+d*r*y-i*h*y)*U,e[15]=(d*g*l-v*h*l+v*r*m-i*g*m-d*r*S+i*h*S)*U,this}scale(e){const i=this.elements,r=e.x,l=e.y,c=e.z;return i[0]*=r,i[4]*=l,i[8]*=c,i[1]*=r,i[5]*=l,i[9]*=c,i[2]*=r,i[6]*=l,i[10]*=c,i[3]*=r,i[7]*=l,i[11]*=c,this}getMaxScaleOnAxis(){const e=this.elements,i=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],r=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],l=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(i,r,l))}makeTranslation(e,i,r){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,i,0,0,1,r,0,0,0,1),this}makeRotationX(e){const i=Math.cos(e),r=Math.sin(e);return this.set(1,0,0,0,0,i,-r,0,0,r,i,0,0,0,0,1),this}makeRotationY(e){const i=Math.cos(e),r=Math.sin(e);return this.set(i,0,r,0,0,1,0,0,-r,0,i,0,0,0,0,1),this}makeRotationZ(e){const i=Math.cos(e),r=Math.sin(e);return this.set(i,-r,0,0,r,i,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,i){const r=Math.cos(i),l=Math.sin(i),c=1-r,d=e.x,h=e.y,m=e.z,p=c*d,v=c*h;return this.set(p*d+r,p*h-l*m,p*m+l*h,0,p*h+l*m,v*h+r,v*m-l*d,0,p*m-l*h,v*m+l*d,c*m*m+r,0,0,0,0,1),this}makeScale(e,i,r){return this.set(e,0,0,0,0,i,0,0,0,0,r,0,0,0,0,1),this}makeShear(e,i,r,l,c,d){return this.set(1,r,c,0,e,1,d,0,i,l,1,0,0,0,0,1),this}compose(e,i,r){const l=this.elements,c=i._x,d=i._y,h=i._z,m=i._w,p=c+c,v=d+d,g=h+h,S=c*p,M=c*v,T=c*g,R=d*v,y=d*g,_=h*g,I=m*p,z=m*v,D=m*g,H=r.x,L=r.y,U=r.z;return l[0]=(1-(R+_))*H,l[1]=(M+D)*H,l[2]=(T-z)*H,l[3]=0,l[4]=(M-D)*L,l[5]=(1-(S+_))*L,l[6]=(y+I)*L,l[7]=0,l[8]=(T+z)*U,l[9]=(y-I)*U,l[10]=(1-(S+R))*U,l[11]=0,l[12]=e.x,l[13]=e.y,l[14]=e.z,l[15]=1,this}decompose(e,i,r){const l=this.elements;let c=us.set(l[0],l[1],l[2]).length();const d=us.set(l[4],l[5],l[6]).length(),h=us.set(l[8],l[9],l[10]).length();this.determinant()<0&&(c=-c),e.x=l[12],e.y=l[13],e.z=l[14],gi.copy(this);const p=1/c,v=1/d,g=1/h;return gi.elements[0]*=p,gi.elements[1]*=p,gi.elements[2]*=p,gi.elements[4]*=v,gi.elements[5]*=v,gi.elements[6]*=v,gi.elements[8]*=g,gi.elements[9]*=g,gi.elements[10]*=g,i.setFromRotationMatrix(gi),r.x=c,r.y=d,r.z=h,this}makePerspective(e,i,r,l,c,d,h=Di,m=!1){const p=this.elements,v=2*c/(i-e),g=2*c/(r-l),S=(i+e)/(i-e),M=(r+l)/(r-l);let T,R;if(m)T=c/(d-c),R=d*c/(d-c);else if(h===Di)T=-(d+c)/(d-c),R=-2*d*c/(d-c);else if(h===Cc)T=-d/(d-c),R=-d*c/(d-c);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+h);return p[0]=v,p[4]=0,p[8]=S,p[12]=0,p[1]=0,p[5]=g,p[9]=M,p[13]=0,p[2]=0,p[6]=0,p[10]=T,p[14]=R,p[3]=0,p[7]=0,p[11]=-1,p[15]=0,this}makeOrthographic(e,i,r,l,c,d,h=Di,m=!1){const p=this.elements,v=2/(i-e),g=2/(r-l),S=-(i+e)/(i-e),M=-(r+l)/(r-l);let T,R;if(m)T=1/(d-c),R=d/(d-c);else if(h===Di)T=-2/(d-c),R=-(d+c)/(d-c);else if(h===Cc)T=-1/(d-c),R=-c/(d-c);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+h);return p[0]=v,p[4]=0,p[8]=0,p[12]=S,p[1]=0,p[5]=g,p[9]=0,p[13]=M,p[2]=0,p[6]=0,p[10]=T,p[14]=R,p[3]=0,p[7]=0,p[11]=0,p[15]=1,this}equals(e){const i=this.elements,r=e.elements;for(let l=0;l<16;l++)if(i[l]!==r[l])return!1;return!0}fromArray(e,i=0){for(let r=0;r<16;r++)this.elements[r]=e[r+i];return this}toArray(e=[],i=0){const r=this.elements;return e[i]=r[0],e[i+1]=r[1],e[i+2]=r[2],e[i+3]=r[3],e[i+4]=r[4],e[i+5]=r[5],e[i+6]=r[6],e[i+7]=r[7],e[i+8]=r[8],e[i+9]=r[9],e[i+10]=r[10],e[i+11]=r[11],e[i+12]=r[12],e[i+13]=r[13],e[i+14]=r[14],e[i+15]=r[15],e}}const us=new $,gi=new $e,Hy=new $(0,0,0),Gy=new $(1,1,1),Oa=new $,nc=new $,Qn=new $,N0=new $e,O0=new Mr;class Ni{constructor(e=0,i=0,r=0,l=Ni.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=i,this._z=r,this._order=l}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,i,r,l=this._order){return this._x=e,this._y=i,this._z=r,this._order=l,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,i=this._order,r=!0){const l=e.elements,c=l[0],d=l[4],h=l[8],m=l[1],p=l[5],v=l[9],g=l[2],S=l[6],M=l[10];switch(i){case"XYZ":this._y=Math.asin(ye(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(-v,M),this._z=Math.atan2(-d,c)):(this._x=Math.atan2(S,p),this._z=0);break;case"YXZ":this._x=Math.asin(-ye(v,-1,1)),Math.abs(v)<.9999999?(this._y=Math.atan2(h,M),this._z=Math.atan2(m,p)):(this._y=Math.atan2(-g,c),this._z=0);break;case"ZXY":this._x=Math.asin(ye(S,-1,1)),Math.abs(S)<.9999999?(this._y=Math.atan2(-g,M),this._z=Math.atan2(-d,p)):(this._y=0,this._z=Math.atan2(m,c));break;case"ZYX":this._y=Math.asin(-ye(g,-1,1)),Math.abs(g)<.9999999?(this._x=Math.atan2(S,M),this._z=Math.atan2(m,c)):(this._x=0,this._z=Math.atan2(-d,p));break;case"YZX":this._z=Math.asin(ye(m,-1,1)),Math.abs(m)<.9999999?(this._x=Math.atan2(-v,p),this._y=Math.atan2(-g,c)):(this._x=0,this._y=Math.atan2(h,M));break;case"XZY":this._z=Math.asin(-ye(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(S,p),this._y=Math.atan2(h,c)):(this._x=Math.atan2(-v,M),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+i)}return this._order=i,r===!0&&this._onChangeCallback(),this}setFromQuaternion(e,i,r){return N0.makeRotationFromQuaternion(e),this.setFromRotationMatrix(N0,i,r)}setFromVector3(e,i=this._order){return this.set(e.x,e.y,e.z,i)}reorder(e){return O0.setFromEuler(this),this.setFromQuaternion(O0,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],i=0){return e[i]=this._x,e[i+1]=this._y,e[i+2]=this._z,e[i+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Ni.DEFAULT_ORDER="XYZ";class bh{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Vy=0;const z0=new $,fs=new Mr,ta=new $e,ic=new $,Ao=new $,ky=new $,Xy=new Mr,P0=new $(1,0,0),B0=new $(0,1,0),F0=new $(0,0,1),I0={type:"added"},Wy={type:"removed"},ds={type:"childadded",child:null},nd={type:"childremoved",child:null};class Rn extends ws{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Vy++}),this.uuid=Ds(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Rn.DEFAULT_UP.clone();const e=new $,i=new Ni,r=new Mr,l=new $(1,1,1);function c(){r.setFromEuler(i,!1)}function d(){i.setFromQuaternion(r,void 0,!1)}i._onChange(c),r._onChange(d),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:i},quaternion:{configurable:!0,enumerable:!0,value:r},scale:{configurable:!0,enumerable:!0,value:l},modelViewMatrix:{value:new $e},normalMatrix:{value:new oe}}),this.matrix=new $e,this.matrixWorld=new $e,this.matrixAutoUpdate=Rn.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Rn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new bh,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,i){this.quaternion.setFromAxisAngle(e,i)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,i){return fs.setFromAxisAngle(e,i),this.quaternion.multiply(fs),this}rotateOnWorldAxis(e,i){return fs.setFromAxisAngle(e,i),this.quaternion.premultiply(fs),this}rotateX(e){return this.rotateOnAxis(P0,e)}rotateY(e){return this.rotateOnAxis(B0,e)}rotateZ(e){return this.rotateOnAxis(F0,e)}translateOnAxis(e,i){return z0.copy(e).applyQuaternion(this.quaternion),this.position.add(z0.multiplyScalar(i)),this}translateX(e){return this.translateOnAxis(P0,e)}translateY(e){return this.translateOnAxis(B0,e)}translateZ(e){return this.translateOnAxis(F0,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(ta.copy(this.matrixWorld).invert())}lookAt(e,i,r){e.isVector3?ic.copy(e):ic.set(e,i,r);const l=this.parent;this.updateWorldMatrix(!0,!1),Ao.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ta.lookAt(Ao,ic,this.up):ta.lookAt(ic,Ao,this.up),this.quaternion.setFromRotationMatrix(ta),l&&(ta.extractRotation(l.matrixWorld),fs.setFromRotationMatrix(ta),this.quaternion.premultiply(fs.invert()))}add(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.add(arguments[i]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(I0),ds.child=e,this.dispatchEvent(ds),ds.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let r=0;r<arguments.length;r++)this.remove(arguments[r]);return this}const i=this.children.indexOf(e);return i!==-1&&(e.parent=null,this.children.splice(i,1),e.dispatchEvent(Wy),nd.child=e,this.dispatchEvent(nd),nd.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),ta.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),ta.multiply(e.parent.matrixWorld)),e.applyMatrix4(ta),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(I0),ds.child=e,this.dispatchEvent(ds),ds.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,i){if(this[e]===i)return this;for(let r=0,l=this.children.length;r<l;r++){const d=this.children[r].getObjectByProperty(e,i);if(d!==void 0)return d}}getObjectsByProperty(e,i,r=[]){this[e]===i&&r.push(this);const l=this.children;for(let c=0,d=l.length;c<d;c++)l[c].getObjectsByProperty(e,i,r);return r}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ao,e,ky),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ao,Xy,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const i=this.matrixWorld.elements;return e.set(i[8],i[9],i[10]).normalize()}raycast(){}traverse(e){e(this);const i=this.children;for(let r=0,l=i.length;r<l;r++)i[r].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const i=this.children;for(let r=0,l=i.length;r<l;r++)i[r].traverseVisible(e)}traverseAncestors(e){const i=this.parent;i!==null&&(e(i),i.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const i=this.children;for(let r=0,l=i.length;r<l;r++)i[r].updateMatrixWorld(e)}updateWorldMatrix(e,i){const r=this.parent;if(e===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),i===!0){const l=this.children;for(let c=0,d=l.length;c<d;c++)l[c].updateWorldMatrix(!1,!0)}}toJSON(e){const i=e===void 0||typeof e=="string",r={};i&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},r.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const l={};l.uuid=this.uuid,l.type=this.type,this.name!==""&&(l.name=this.name),this.castShadow===!0&&(l.castShadow=!0),this.receiveShadow===!0&&(l.receiveShadow=!0),this.visible===!1&&(l.visible=!1),this.frustumCulled===!1&&(l.frustumCulled=!1),this.renderOrder!==0&&(l.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(l.userData=this.userData),l.layers=this.layers.mask,l.matrix=this.matrix.toArray(),l.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(l.matrixAutoUpdate=!1),this.isInstancedMesh&&(l.type="InstancedMesh",l.count=this.count,l.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(l.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(l.type="BatchedMesh",l.perObjectFrustumCulled=this.perObjectFrustumCulled,l.sortObjects=this.sortObjects,l.drawRanges=this._drawRanges,l.reservedRanges=this._reservedRanges,l.geometryInfo=this._geometryInfo.map(h=>({...h,boundingBox:h.boundingBox?h.boundingBox.toJSON():void 0,boundingSphere:h.boundingSphere?h.boundingSphere.toJSON():void 0})),l.instanceInfo=this._instanceInfo.map(h=>({...h})),l.availableInstanceIds=this._availableInstanceIds.slice(),l.availableGeometryIds=this._availableGeometryIds.slice(),l.nextIndexStart=this._nextIndexStart,l.nextVertexStart=this._nextVertexStart,l.geometryCount=this._geometryCount,l.maxInstanceCount=this._maxInstanceCount,l.maxVertexCount=this._maxVertexCount,l.maxIndexCount=this._maxIndexCount,l.geometryInitialized=this._geometryInitialized,l.matricesTexture=this._matricesTexture.toJSON(e),l.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(l.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(l.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(l.boundingBox=this.boundingBox.toJSON()));function c(h,m){return h[m.uuid]===void 0&&(h[m.uuid]=m.toJSON(e)),m.uuid}if(this.isScene)this.background&&(this.background.isColor?l.background=this.background.toJSON():this.background.isTexture&&(l.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(l.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){l.geometry=c(e.geometries,this.geometry);const h=this.geometry.parameters;if(h!==void 0&&h.shapes!==void 0){const m=h.shapes;if(Array.isArray(m))for(let p=0,v=m.length;p<v;p++){const g=m[p];c(e.shapes,g)}else c(e.shapes,m)}}if(this.isSkinnedMesh&&(l.bindMode=this.bindMode,l.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(c(e.skeletons,this.skeleton),l.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const h=[];for(let m=0,p=this.material.length;m<p;m++)h.push(c(e.materials,this.material[m]));l.material=h}else l.material=c(e.materials,this.material);if(this.children.length>0){l.children=[];for(let h=0;h<this.children.length;h++)l.children.push(this.children[h].toJSON(e).object)}if(this.animations.length>0){l.animations=[];for(let h=0;h<this.animations.length;h++){const m=this.animations[h];l.animations.push(c(e.animations,m))}}if(i){const h=d(e.geometries),m=d(e.materials),p=d(e.textures),v=d(e.images),g=d(e.shapes),S=d(e.skeletons),M=d(e.animations),T=d(e.nodes);h.length>0&&(r.geometries=h),m.length>0&&(r.materials=m),p.length>0&&(r.textures=p),v.length>0&&(r.images=v),g.length>0&&(r.shapes=g),S.length>0&&(r.skeletons=S),M.length>0&&(r.animations=M),T.length>0&&(r.nodes=T)}return r.object=l,r;function d(h){const m=[];for(const p in h){const v=h[p];delete v.metadata,m.push(v)}return m}}clone(e){return new this.constructor().copy(this,e)}copy(e,i=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),i===!0)for(let r=0;r<e.children.length;r++){const l=e.children[r];this.add(l.clone())}return this}}Rn.DEFAULT_UP=new $(0,1,0);Rn.DEFAULT_MATRIX_AUTO_UPDATE=!0;Rn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const _i=new $,ea=new $,id=new $,na=new $,hs=new $,ps=new $,H0=new $,ad=new $,rd=new $,sd=new $,od=new Je,ld=new Je,cd=new Je;class vi{constructor(e=new $,i=new $,r=new $){this.a=e,this.b=i,this.c=r}static getNormal(e,i,r,l){l.subVectors(r,i),_i.subVectors(e,i),l.cross(_i);const c=l.lengthSq();return c>0?l.multiplyScalar(1/Math.sqrt(c)):l.set(0,0,0)}static getBarycoord(e,i,r,l,c){_i.subVectors(l,i),ea.subVectors(r,i),id.subVectors(e,i);const d=_i.dot(_i),h=_i.dot(ea),m=_i.dot(id),p=ea.dot(ea),v=ea.dot(id),g=d*p-h*h;if(g===0)return c.set(0,0,0),null;const S=1/g,M=(p*m-h*v)*S,T=(d*v-h*m)*S;return c.set(1-M-T,T,M)}static containsPoint(e,i,r,l){return this.getBarycoord(e,i,r,l,na)===null?!1:na.x>=0&&na.y>=0&&na.x+na.y<=1}static getInterpolation(e,i,r,l,c,d,h,m){return this.getBarycoord(e,i,r,l,na)===null?(m.x=0,m.y=0,"z"in m&&(m.z=0),"w"in m&&(m.w=0),null):(m.setScalar(0),m.addScaledVector(c,na.x),m.addScaledVector(d,na.y),m.addScaledVector(h,na.z),m)}static getInterpolatedAttribute(e,i,r,l,c,d){return od.setScalar(0),ld.setScalar(0),cd.setScalar(0),od.fromBufferAttribute(e,i),ld.fromBufferAttribute(e,r),cd.fromBufferAttribute(e,l),d.setScalar(0),d.addScaledVector(od,c.x),d.addScaledVector(ld,c.y),d.addScaledVector(cd,c.z),d}static isFrontFacing(e,i,r,l){return _i.subVectors(r,i),ea.subVectors(e,i),_i.cross(ea).dot(l)<0}set(e,i,r){return this.a.copy(e),this.b.copy(i),this.c.copy(r),this}setFromPointsAndIndices(e,i,r,l){return this.a.copy(e[i]),this.b.copy(e[r]),this.c.copy(e[l]),this}setFromAttributeAndIndices(e,i,r,l){return this.a.fromBufferAttribute(e,i),this.b.fromBufferAttribute(e,r),this.c.fromBufferAttribute(e,l),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return _i.subVectors(this.c,this.b),ea.subVectors(this.a,this.b),_i.cross(ea).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return vi.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,i){return vi.getBarycoord(e,this.a,this.b,this.c,i)}getInterpolation(e,i,r,l,c){return vi.getInterpolation(e,this.a,this.b,this.c,i,r,l,c)}containsPoint(e){return vi.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return vi.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,i){const r=this.a,l=this.b,c=this.c;let d,h;hs.subVectors(l,r),ps.subVectors(c,r),ad.subVectors(e,r);const m=hs.dot(ad),p=ps.dot(ad);if(m<=0&&p<=0)return i.copy(r);rd.subVectors(e,l);const v=hs.dot(rd),g=ps.dot(rd);if(v>=0&&g<=v)return i.copy(l);const S=m*g-v*p;if(S<=0&&m>=0&&v<=0)return d=m/(m-v),i.copy(r).addScaledVector(hs,d);sd.subVectors(e,c);const M=hs.dot(sd),T=ps.dot(sd);if(T>=0&&M<=T)return i.copy(c);const R=M*p-m*T;if(R<=0&&p>=0&&T<=0)return h=p/(p-T),i.copy(r).addScaledVector(ps,h);const y=v*T-M*g;if(y<=0&&g-v>=0&&M-T>=0)return H0.subVectors(c,l),h=(g-v)/(g-v+(M-T)),i.copy(l).addScaledVector(H0,h);const _=1/(y+R+S);return d=R*_,h=S*_,i.copy(r).addScaledVector(hs,d).addScaledVector(ps,h)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const Z_={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},za={h:0,s:0,l:0},ac={h:0,s:0,l:0};function ud(s,e,i){return i<0&&(i+=1),i>1&&(i-=1),i<1/6?s+(e-s)*6*i:i<1/2?e:i<2/3?s+(e-s)*6*(2/3-i):s}class be{constructor(e,i,r){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,i,r)}set(e,i,r){if(i===void 0&&r===void 0){const l=e;l&&l.isColor?this.copy(l):typeof l=="number"?this.setHex(l):typeof l=="string"&&this.setStyle(l)}else this.setRGB(e,i,r);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,i=ui){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,we.colorSpaceToWorking(this,i),this}setRGB(e,i,r,l=we.workingColorSpace){return this.r=e,this.g=i,this.b=r,we.colorSpaceToWorking(this,l),this}setHSL(e,i,r,l=we.workingColorSpace){if(e=Mh(e,1),i=ye(i,0,1),r=ye(r,0,1),i===0)this.r=this.g=this.b=r;else{const c=r<=.5?r*(1+i):r+i-r*i,d=2*r-c;this.r=ud(d,c,e+1/3),this.g=ud(d,c,e),this.b=ud(d,c,e-1/3)}return we.colorSpaceToWorking(this,l),this}setStyle(e,i=ui){function r(c){c!==void 0&&parseFloat(c)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let l;if(l=/^(\w+)\(([^\)]*)\)/.exec(e)){let c;const d=l[1],h=l[2];switch(d){case"rgb":case"rgba":if(c=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(h))return r(c[4]),this.setRGB(Math.min(255,parseInt(c[1],10))/255,Math.min(255,parseInt(c[2],10))/255,Math.min(255,parseInt(c[3],10))/255,i);if(c=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(h))return r(c[4]),this.setRGB(Math.min(100,parseInt(c[1],10))/100,Math.min(100,parseInt(c[2],10))/100,Math.min(100,parseInt(c[3],10))/100,i);break;case"hsl":case"hsla":if(c=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(h))return r(c[4]),this.setHSL(parseFloat(c[1])/360,parseFloat(c[2])/100,parseFloat(c[3])/100,i);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(l=/^\#([A-Fa-f\d]+)$/.exec(e)){const c=l[1],d=c.length;if(d===3)return this.setRGB(parseInt(c.charAt(0),16)/15,parseInt(c.charAt(1),16)/15,parseInt(c.charAt(2),16)/15,i);if(d===6)return this.setHex(parseInt(c,16),i);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,i);return this}setColorName(e,i=ui){const r=Z_[e.toLowerCase()];return r!==void 0?this.setHex(r,i):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=sa(e.r),this.g=sa(e.g),this.b=sa(e.b),this}copyLinearToSRGB(e){return this.r=Es(e.r),this.g=Es(e.g),this.b=Es(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=ui){return we.workingToColorSpace(An.copy(this),e),Math.round(ye(An.r*255,0,255))*65536+Math.round(ye(An.g*255,0,255))*256+Math.round(ye(An.b*255,0,255))}getHexString(e=ui){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,i=we.workingColorSpace){we.workingToColorSpace(An.copy(this),i);const r=An.r,l=An.g,c=An.b,d=Math.max(r,l,c),h=Math.min(r,l,c);let m,p;const v=(h+d)/2;if(h===d)m=0,p=0;else{const g=d-h;switch(p=v<=.5?g/(d+h):g/(2-d-h),d){case r:m=(l-c)/g+(l<c?6:0);break;case l:m=(c-r)/g+2;break;case c:m=(r-l)/g+4;break}m/=6}return e.h=m,e.s=p,e.l=v,e}getRGB(e,i=we.workingColorSpace){return we.workingToColorSpace(An.copy(this),i),e.r=An.r,e.g=An.g,e.b=An.b,e}getStyle(e=ui){we.workingToColorSpace(An.copy(this),e);const i=An.r,r=An.g,l=An.b;return e!==ui?`color(${e} ${i.toFixed(3)} ${r.toFixed(3)} ${l.toFixed(3)})`:`rgb(${Math.round(i*255)},${Math.round(r*255)},${Math.round(l*255)})`}offsetHSL(e,i,r){return this.getHSL(za),this.setHSL(za.h+e,za.s+i,za.l+r)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,i){return this.r=e.r+i.r,this.g=e.g+i.g,this.b=e.b+i.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,i){return this.r+=(e.r-this.r)*i,this.g+=(e.g-this.g)*i,this.b+=(e.b-this.b)*i,this}lerpColors(e,i,r){return this.r=e.r+(i.r-e.r)*r,this.g=e.g+(i.g-e.g)*r,this.b=e.b+(i.b-e.b)*r,this}lerpHSL(e,i){this.getHSL(za),e.getHSL(ac);const r=Do(za.h,ac.h,i),l=Do(za.s,ac.s,i),c=Do(za.l,ac.l,i);return this.setHSL(r,l,c),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const i=this.r,r=this.g,l=this.b,c=e.elements;return this.r=c[0]*i+c[3]*r+c[6]*l,this.g=c[1]*i+c[4]*r+c[7]*l,this.b=c[2]*i+c[5]*r+c[8]*l,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,i=0){return this.r=e[i],this.g=e[i+1],this.b=e[i+2],this}toArray(e=[],i=0){return e[i]=this.r,e[i+1]=this.g,e[i+2]=this.b,e}fromBufferAttribute(e,i){return this.r=e.getX(i),this.g=e.getY(i),this.b=e.getZ(i),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const An=new be;be.NAMES=Z_;let qy=0;class Fo extends ws{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:qy++}),this.uuid=Ds(),this.name="",this.type="Material",this.blending=ys,this.side=Ha,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=bd,this.blendDst=Ad,this.blendEquation=mr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new be(0,0,0),this.blendAlpha=0,this.depthFunc=Ts,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=b0,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=rs,this.stencilZFail=rs,this.stencilZPass=rs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const i in e){const r=e[i];if(r===void 0){console.warn(`THREE.Material: parameter '${i}' has value of undefined.`);continue}const l=this[i];if(l===void 0){console.warn(`THREE.Material: '${i}' is not a property of THREE.${this.type}.`);continue}l&&l.isColor?l.set(r):l&&l.isVector3&&r&&r.isVector3?l.copy(r):this[i]=r}}toJSON(e){const i=e===void 0||typeof e=="string";i&&(e={textures:{},images:{}});const r={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.color&&this.color.isColor&&(r.color=this.color.getHex()),this.roughness!==void 0&&(r.roughness=this.roughness),this.metalness!==void 0&&(r.metalness=this.metalness),this.sheen!==void 0&&(r.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(r.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(r.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(r.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(r.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(r.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(r.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(r.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(r.shininess=this.shininess),this.clearcoat!==void 0&&(r.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(r.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(r.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(r.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(r.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,r.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(r.dispersion=this.dispersion),this.iridescence!==void 0&&(r.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(r.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(r.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(r.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(r.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(r.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(r.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(r.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(r.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(r.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(r.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(r.lightMap=this.lightMap.toJSON(e).uuid,r.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(r.aoMap=this.aoMap.toJSON(e).uuid,r.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(r.bumpMap=this.bumpMap.toJSON(e).uuid,r.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(r.normalMap=this.normalMap.toJSON(e).uuid,r.normalMapType=this.normalMapType,r.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(r.displacementMap=this.displacementMap.toJSON(e).uuid,r.displacementScale=this.displacementScale,r.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(r.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(r.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(r.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(r.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(r.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(r.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(r.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(r.combine=this.combine)),this.envMapRotation!==void 0&&(r.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(r.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(r.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(r.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(r.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(r.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(r.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(r.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(r.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(r.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(r.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(r.size=this.size),this.shadowSide!==null&&(r.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(r.sizeAttenuation=this.sizeAttenuation),this.blending!==ys&&(r.blending=this.blending),this.side!==Ha&&(r.side=this.side),this.vertexColors===!0&&(r.vertexColors=!0),this.opacity<1&&(r.opacity=this.opacity),this.transparent===!0&&(r.transparent=!0),this.blendSrc!==bd&&(r.blendSrc=this.blendSrc),this.blendDst!==Ad&&(r.blendDst=this.blendDst),this.blendEquation!==mr&&(r.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(r.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(r.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(r.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(r.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(r.blendAlpha=this.blendAlpha),this.depthFunc!==Ts&&(r.depthFunc=this.depthFunc),this.depthTest===!1&&(r.depthTest=this.depthTest),this.depthWrite===!1&&(r.depthWrite=this.depthWrite),this.colorWrite===!1&&(r.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(r.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==b0&&(r.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(r.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(r.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==rs&&(r.stencilFail=this.stencilFail),this.stencilZFail!==rs&&(r.stencilZFail=this.stencilZFail),this.stencilZPass!==rs&&(r.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(r.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(r.rotation=this.rotation),this.polygonOffset===!0&&(r.polygonOffset=!0),this.polygonOffsetFactor!==0&&(r.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(r.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(r.linewidth=this.linewidth),this.dashSize!==void 0&&(r.dashSize=this.dashSize),this.gapSize!==void 0&&(r.gapSize=this.gapSize),this.scale!==void 0&&(r.scale=this.scale),this.dithering===!0&&(r.dithering=!0),this.alphaTest>0&&(r.alphaTest=this.alphaTest),this.alphaHash===!0&&(r.alphaHash=!0),this.alphaToCoverage===!0&&(r.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(r.premultipliedAlpha=!0),this.forceSinglePass===!0&&(r.forceSinglePass=!0),this.wireframe===!0&&(r.wireframe=!0),this.wireframeLinewidth>1&&(r.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(r.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(r.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(r.flatShading=!0),this.visible===!1&&(r.visible=!1),this.toneMapped===!1&&(r.toneMapped=!1),this.fog===!1&&(r.fog=!1),Object.keys(this.userData).length>0&&(r.userData=this.userData);function l(c){const d=[];for(const h in c){const m=c[h];delete m.metadata,d.push(m)}return d}if(i){const c=l(e.textures),d=l(e.images);c.length>0&&(r.textures=c),d.length>0&&(r.images=d)}return r}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const i=e.clippingPlanes;let r=null;if(i!==null){const l=i.length;r=new Array(l);for(let c=0;c!==l;++c)r[c]=i[c].clone()}return this.clippingPlanes=r,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}}class j_ extends Fo{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new be(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ni,this.combine=mh,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const cn=new $,rc=new Ae;let Yy=0;class $n{constructor(e,i,r=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Yy++}),this.name="",this.array=e,this.itemSize=i,this.count=e!==void 0?e.length/i:0,this.normalized=r,this.usage=A0,this.updateRanges=[],this.gpuType=ra,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,i){this.updateRanges.push({start:e,count:i})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,i,r){e*=this.itemSize,r*=i.itemSize;for(let l=0,c=this.itemSize;l<c;l++)this.array[e+l]=i.array[r+l];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let i=0,r=this.count;i<r;i++)rc.fromBufferAttribute(this,i),rc.applyMatrix3(e),this.setXY(i,rc.x,rc.y);else if(this.itemSize===3)for(let i=0,r=this.count;i<r;i++)cn.fromBufferAttribute(this,i),cn.applyMatrix3(e),this.setXYZ(i,cn.x,cn.y,cn.z);return this}applyMatrix4(e){for(let i=0,r=this.count;i<r;i++)cn.fromBufferAttribute(this,i),cn.applyMatrix4(e),this.setXYZ(i,cn.x,cn.y,cn.z);return this}applyNormalMatrix(e){for(let i=0,r=this.count;i<r;i++)cn.fromBufferAttribute(this,i),cn.applyNormalMatrix(e),this.setXYZ(i,cn.x,cn.y,cn.z);return this}transformDirection(e){for(let i=0,r=this.count;i<r;i++)cn.fromBufferAttribute(this,i),cn.transformDirection(e),this.setXYZ(i,cn.x,cn.y,cn.z);return this}set(e,i=0){return this.array.set(e,i),this}getComponent(e,i){let r=this.array[e*this.itemSize+i];return this.normalized&&(r=xs(r,this.array)),r}setComponent(e,i,r){return this.normalized&&(r=Ln(r,this.array)),this.array[e*this.itemSize+i]=r,this}getX(e){let i=this.array[e*this.itemSize];return this.normalized&&(i=xs(i,this.array)),i}setX(e,i){return this.normalized&&(i=Ln(i,this.array)),this.array[e*this.itemSize]=i,this}getY(e){let i=this.array[e*this.itemSize+1];return this.normalized&&(i=xs(i,this.array)),i}setY(e,i){return this.normalized&&(i=Ln(i,this.array)),this.array[e*this.itemSize+1]=i,this}getZ(e){let i=this.array[e*this.itemSize+2];return this.normalized&&(i=xs(i,this.array)),i}setZ(e,i){return this.normalized&&(i=Ln(i,this.array)),this.array[e*this.itemSize+2]=i,this}getW(e){let i=this.array[e*this.itemSize+3];return this.normalized&&(i=xs(i,this.array)),i}setW(e,i){return this.normalized&&(i=Ln(i,this.array)),this.array[e*this.itemSize+3]=i,this}setXY(e,i,r){return e*=this.itemSize,this.normalized&&(i=Ln(i,this.array),r=Ln(r,this.array)),this.array[e+0]=i,this.array[e+1]=r,this}setXYZ(e,i,r,l){return e*=this.itemSize,this.normalized&&(i=Ln(i,this.array),r=Ln(r,this.array),l=Ln(l,this.array)),this.array[e+0]=i,this.array[e+1]=r,this.array[e+2]=l,this}setXYZW(e,i,r,l,c){return e*=this.itemSize,this.normalized&&(i=Ln(i,this.array),r=Ln(r,this.array),l=Ln(l,this.array),c=Ln(c,this.array)),this.array[e+0]=i,this.array[e+1]=r,this.array[e+2]=l,this.array[e+3]=c,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==A0&&(e.usage=this.usage),e}}class K_ extends $n{constructor(e,i,r){super(new Uint16Array(e),i,r)}}class Q_ extends $n{constructor(e,i,r){super(new Uint32Array(e),i,r)}}class Cn extends $n{constructor(e,i,r){super(new Float32Array(e),i,r)}}let Zy=0;const ci=new $e,fd=new Rn,ms=new $,Jn=new Bo,Ro=new Bo,gn=new $;class yi extends ws{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Zy++}),this.uuid=Ds(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(W_(e)?Q_:K_)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,i){return this.attributes[e]=i,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,i,r=0){this.groups.push({start:e,count:i,materialIndex:r})}clearGroups(){this.groups=[]}setDrawRange(e,i){this.drawRange.start=e,this.drawRange.count=i}applyMatrix4(e){const i=this.attributes.position;i!==void 0&&(i.applyMatrix4(e),i.needsUpdate=!0);const r=this.attributes.normal;if(r!==void 0){const c=new oe().getNormalMatrix(e);r.applyNormalMatrix(c),r.needsUpdate=!0}const l=this.attributes.tangent;return l!==void 0&&(l.transformDirection(e),l.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return ci.makeRotationFromQuaternion(e),this.applyMatrix4(ci),this}rotateX(e){return ci.makeRotationX(e),this.applyMatrix4(ci),this}rotateY(e){return ci.makeRotationY(e),this.applyMatrix4(ci),this}rotateZ(e){return ci.makeRotationZ(e),this.applyMatrix4(ci),this}translate(e,i,r){return ci.makeTranslation(e,i,r),this.applyMatrix4(ci),this}scale(e,i,r){return ci.makeScale(e,i,r),this.applyMatrix4(ci),this}lookAt(e){return fd.lookAt(e),fd.updateMatrix(),this.applyMatrix4(fd.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ms).negate(),this.translate(ms.x,ms.y,ms.z),this}setFromPoints(e){const i=this.getAttribute("position");if(i===void 0){const r=[];for(let l=0,c=e.length;l<c;l++){const d=e[l];r.push(d.x,d.y,d.z||0)}this.setAttribute("position",new Cn(r,3))}else{const r=Math.min(e.length,i.count);for(let l=0;l<r;l++){const c=e[l];i.setXYZ(l,c.x,c.y,c.z||0)}e.length>i.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),i.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Bo);const e=this.attributes.position,i=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new $(-1/0,-1/0,-1/0),new $(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),i)for(let r=0,l=i.length;r<l;r++){const c=i[r];Jn.setFromBufferAttribute(c),this.morphTargetsRelative?(gn.addVectors(this.boundingBox.min,Jn.min),this.boundingBox.expandByPoint(gn),gn.addVectors(this.boundingBox.max,Jn.max),this.boundingBox.expandByPoint(gn)):(this.boundingBox.expandByPoint(Jn.min),this.boundingBox.expandByPoint(Jn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Th);const e=this.attributes.position,i=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new $,1/0);return}if(e){const r=this.boundingSphere.center;if(Jn.setFromBufferAttribute(e),i)for(let c=0,d=i.length;c<d;c++){const h=i[c];Ro.setFromBufferAttribute(h),this.morphTargetsRelative?(gn.addVectors(Jn.min,Ro.min),Jn.expandByPoint(gn),gn.addVectors(Jn.max,Ro.max),Jn.expandByPoint(gn)):(Jn.expandByPoint(Ro.min),Jn.expandByPoint(Ro.max))}Jn.getCenter(r);let l=0;for(let c=0,d=e.count;c<d;c++)gn.fromBufferAttribute(e,c),l=Math.max(l,r.distanceToSquared(gn));if(i)for(let c=0,d=i.length;c<d;c++){const h=i[c],m=this.morphTargetsRelative;for(let p=0,v=h.count;p<v;p++)gn.fromBufferAttribute(h,p),m&&(ms.fromBufferAttribute(e,p),gn.add(ms)),l=Math.max(l,r.distanceToSquared(gn))}this.boundingSphere.radius=Math.sqrt(l),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,i=this.attributes;if(e===null||i.position===void 0||i.normal===void 0||i.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const r=i.position,l=i.normal,c=i.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new $n(new Float32Array(4*r.count),4));const d=this.getAttribute("tangent"),h=[],m=[];for(let V=0;V<r.count;V++)h[V]=new $,m[V]=new $;const p=new $,v=new $,g=new $,S=new Ae,M=new Ae,T=new Ae,R=new $,y=new $;function _(V,A,w){p.fromBufferAttribute(r,V),v.fromBufferAttribute(r,A),g.fromBufferAttribute(r,w),S.fromBufferAttribute(c,V),M.fromBufferAttribute(c,A),T.fromBufferAttribute(c,w),v.sub(p),g.sub(p),M.sub(S),T.sub(S);const N=1/(M.x*T.y-T.x*M.y);isFinite(N)&&(R.copy(v).multiplyScalar(T.y).addScaledVector(g,-M.y).multiplyScalar(N),y.copy(g).multiplyScalar(M.x).addScaledVector(v,-T.x).multiplyScalar(N),h[V].add(R),h[A].add(R),h[w].add(R),m[V].add(y),m[A].add(y),m[w].add(y))}let I=this.groups;I.length===0&&(I=[{start:0,count:e.count}]);for(let V=0,A=I.length;V<A;++V){const w=I[V],N=w.start,J=w.count;for(let tt=N,rt=N+J;tt<rt;tt+=3)_(e.getX(tt+0),e.getX(tt+1),e.getX(tt+2))}const z=new $,D=new $,H=new $,L=new $;function U(V){H.fromBufferAttribute(l,V),L.copy(H);const A=h[V];z.copy(A),z.sub(H.multiplyScalar(H.dot(A))).normalize(),D.crossVectors(L,A);const N=D.dot(m[V])<0?-1:1;d.setXYZW(V,z.x,z.y,z.z,N)}for(let V=0,A=I.length;V<A;++V){const w=I[V],N=w.start,J=w.count;for(let tt=N,rt=N+J;tt<rt;tt+=3)U(e.getX(tt+0)),U(e.getX(tt+1)),U(e.getX(tt+2))}}computeVertexNormals(){const e=this.index,i=this.getAttribute("position");if(i!==void 0){let r=this.getAttribute("normal");if(r===void 0)r=new $n(new Float32Array(i.count*3),3),this.setAttribute("normal",r);else for(let S=0,M=r.count;S<M;S++)r.setXYZ(S,0,0,0);const l=new $,c=new $,d=new $,h=new $,m=new $,p=new $,v=new $,g=new $;if(e)for(let S=0,M=e.count;S<M;S+=3){const T=e.getX(S+0),R=e.getX(S+1),y=e.getX(S+2);l.fromBufferAttribute(i,T),c.fromBufferAttribute(i,R),d.fromBufferAttribute(i,y),v.subVectors(d,c),g.subVectors(l,c),v.cross(g),h.fromBufferAttribute(r,T),m.fromBufferAttribute(r,R),p.fromBufferAttribute(r,y),h.add(v),m.add(v),p.add(v),r.setXYZ(T,h.x,h.y,h.z),r.setXYZ(R,m.x,m.y,m.z),r.setXYZ(y,p.x,p.y,p.z)}else for(let S=0,M=i.count;S<M;S+=3)l.fromBufferAttribute(i,S+0),c.fromBufferAttribute(i,S+1),d.fromBufferAttribute(i,S+2),v.subVectors(d,c),g.subVectors(l,c),v.cross(g),r.setXYZ(S+0,v.x,v.y,v.z),r.setXYZ(S+1,v.x,v.y,v.z),r.setXYZ(S+2,v.x,v.y,v.z);this.normalizeNormals(),r.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let i=0,r=e.count;i<r;i++)gn.fromBufferAttribute(e,i),gn.normalize(),e.setXYZ(i,gn.x,gn.y,gn.z)}toNonIndexed(){function e(h,m){const p=h.array,v=h.itemSize,g=h.normalized,S=new p.constructor(m.length*v);let M=0,T=0;for(let R=0,y=m.length;R<y;R++){h.isInterleavedBufferAttribute?M=m[R]*h.data.stride+h.offset:M=m[R]*v;for(let _=0;_<v;_++)S[T++]=p[M++]}return new $n(S,v,g)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const i=new yi,r=this.index.array,l=this.attributes;for(const h in l){const m=l[h],p=e(m,r);i.setAttribute(h,p)}const c=this.morphAttributes;for(const h in c){const m=[],p=c[h];for(let v=0,g=p.length;v<g;v++){const S=p[v],M=e(S,r);m.push(M)}i.morphAttributes[h]=m}i.morphTargetsRelative=this.morphTargetsRelative;const d=this.groups;for(let h=0,m=d.length;h<m;h++){const p=d[h];i.addGroup(p.start,p.count,p.materialIndex)}return i}toJSON(){const e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const m=this.parameters;for(const p in m)m[p]!==void 0&&(e[p]=m[p]);return e}e.data={attributes:{}};const i=this.index;i!==null&&(e.data.index={type:i.array.constructor.name,array:Array.prototype.slice.call(i.array)});const r=this.attributes;for(const m in r){const p=r[m];e.data.attributes[m]=p.toJSON(e.data)}const l={};let c=!1;for(const m in this.morphAttributes){const p=this.morphAttributes[m],v=[];for(let g=0,S=p.length;g<S;g++){const M=p[g];v.push(M.toJSON(e.data))}v.length>0&&(l[m]=v,c=!0)}c&&(e.data.morphAttributes=l,e.data.morphTargetsRelative=this.morphTargetsRelative);const d=this.groups;d.length>0&&(e.data.groups=JSON.parse(JSON.stringify(d)));const h=this.boundingSphere;return h!==null&&(e.data.boundingSphere=h.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const i={};this.name=e.name;const r=e.index;r!==null&&this.setIndex(r.clone());const l=e.attributes;for(const p in l){const v=l[p];this.setAttribute(p,v.clone(i))}const c=e.morphAttributes;for(const p in c){const v=[],g=c[p];for(let S=0,M=g.length;S<M;S++)v.push(g[S].clone(i));this.morphAttributes[p]=v}this.morphTargetsRelative=e.morphTargetsRelative;const d=e.groups;for(let p=0,v=d.length;p<v;p++){const g=d[p];this.addGroup(g.start,g.count,g.materialIndex)}const h=e.boundingBox;h!==null&&(this.boundingBox=h.clone());const m=e.boundingSphere;return m!==null&&(this.boundingSphere=m.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const G0=new $e,cr=new Y_,sc=new Th,V0=new $,oc=new $,lc=new $,cc=new $,dd=new $,uc=new $,k0=new $,fc=new $;class Hn extends Rn{constructor(e=new yi,i=new j_){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=i,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,i){return super.copy(e,i),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const i=this.geometry.morphAttributes,r=Object.keys(i);if(r.length>0){const l=i[r[0]];if(l!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let c=0,d=l.length;c<d;c++){const h=l[c].name||String(c);this.morphTargetInfluences.push(0),this.morphTargetDictionary[h]=c}}}}getVertexPosition(e,i){const r=this.geometry,l=r.attributes.position,c=r.morphAttributes.position,d=r.morphTargetsRelative;i.fromBufferAttribute(l,e);const h=this.morphTargetInfluences;if(c&&h){uc.set(0,0,0);for(let m=0,p=c.length;m<p;m++){const v=h[m],g=c[m];v!==0&&(dd.fromBufferAttribute(g,e),d?uc.addScaledVector(dd,v):uc.addScaledVector(dd.sub(i),v))}i.add(uc)}return i}raycast(e,i){const r=this.geometry,l=this.material,c=this.matrixWorld;l!==void 0&&(r.boundingSphere===null&&r.computeBoundingSphere(),sc.copy(r.boundingSphere),sc.applyMatrix4(c),cr.copy(e.ray).recast(e.near),!(sc.containsPoint(cr.origin)===!1&&(cr.intersectSphere(sc,V0)===null||cr.origin.distanceToSquared(V0)>(e.far-e.near)**2))&&(G0.copy(c).invert(),cr.copy(e.ray).applyMatrix4(G0),!(r.boundingBox!==null&&cr.intersectsBox(r.boundingBox)===!1)&&this._computeIntersections(e,i,cr)))}_computeIntersections(e,i,r){let l;const c=this.geometry,d=this.material,h=c.index,m=c.attributes.position,p=c.attributes.uv,v=c.attributes.uv1,g=c.attributes.normal,S=c.groups,M=c.drawRange;if(h!==null)if(Array.isArray(d))for(let T=0,R=S.length;T<R;T++){const y=S[T],_=d[y.materialIndex],I=Math.max(y.start,M.start),z=Math.min(h.count,Math.min(y.start+y.count,M.start+M.count));for(let D=I,H=z;D<H;D+=3){const L=h.getX(D),U=h.getX(D+1),V=h.getX(D+2);l=dc(this,_,e,r,p,v,g,L,U,V),l&&(l.faceIndex=Math.floor(D/3),l.face.materialIndex=y.materialIndex,i.push(l))}}else{const T=Math.max(0,M.start),R=Math.min(h.count,M.start+M.count);for(let y=T,_=R;y<_;y+=3){const I=h.getX(y),z=h.getX(y+1),D=h.getX(y+2);l=dc(this,d,e,r,p,v,g,I,z,D),l&&(l.faceIndex=Math.floor(y/3),i.push(l))}}else if(m!==void 0)if(Array.isArray(d))for(let T=0,R=S.length;T<R;T++){const y=S[T],_=d[y.materialIndex],I=Math.max(y.start,M.start),z=Math.min(m.count,Math.min(y.start+y.count,M.start+M.count));for(let D=I,H=z;D<H;D+=3){const L=D,U=D+1,V=D+2;l=dc(this,_,e,r,p,v,g,L,U,V),l&&(l.faceIndex=Math.floor(D/3),l.face.materialIndex=y.materialIndex,i.push(l))}}else{const T=Math.max(0,M.start),R=Math.min(m.count,M.start+M.count);for(let y=T,_=R;y<_;y+=3){const I=y,z=y+1,D=y+2;l=dc(this,d,e,r,p,v,g,I,z,D),l&&(l.faceIndex=Math.floor(y/3),i.push(l))}}}}function jy(s,e,i,r,l,c,d,h){let m;if(e.side===Gn?m=r.intersectTriangle(d,c,l,!0,h):m=r.intersectTriangle(l,c,d,e.side===Ha,h),m===null)return null;fc.copy(h),fc.applyMatrix4(s.matrixWorld);const p=i.ray.origin.distanceTo(fc);return p<i.near||p>i.far?null:{distance:p,point:fc.clone(),object:s}}function dc(s,e,i,r,l,c,d,h,m,p){s.getVertexPosition(h,oc),s.getVertexPosition(m,lc),s.getVertexPosition(p,cc);const v=jy(s,e,i,r,oc,lc,cc,k0);if(v){const g=new $;vi.getBarycoord(k0,oc,lc,cc,g),l&&(v.uv=vi.getInterpolatedAttribute(l,h,m,p,g,new Ae)),c&&(v.uv1=vi.getInterpolatedAttribute(c,h,m,p,g,new Ae)),d&&(v.normal=vi.getInterpolatedAttribute(d,h,m,p,g,new $),v.normal.dot(r.direction)>0&&v.normal.multiplyScalar(-1));const S={a:h,b:m,c:p,normal:new $,materialIndex:0};vi.getNormal(oc,lc,cc,S.normal),v.face=S,v.barycoord=g}return v}class Io extends yi{constructor(e=1,i=1,r=1,l=1,c=1,d=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:i,depth:r,widthSegments:l,heightSegments:c,depthSegments:d};const h=this;l=Math.floor(l),c=Math.floor(c),d=Math.floor(d);const m=[],p=[],v=[],g=[];let S=0,M=0;T("z","y","x",-1,-1,r,i,e,d,c,0),T("z","y","x",1,-1,r,i,-e,d,c,1),T("x","z","y",1,1,e,r,i,l,d,2),T("x","z","y",1,-1,e,r,-i,l,d,3),T("x","y","z",1,-1,e,i,r,l,c,4),T("x","y","z",-1,-1,e,i,-r,l,c,5),this.setIndex(m),this.setAttribute("position",new Cn(p,3)),this.setAttribute("normal",new Cn(v,3)),this.setAttribute("uv",new Cn(g,2));function T(R,y,_,I,z,D,H,L,U,V,A){const w=D/U,N=H/V,J=D/2,tt=H/2,rt=L/2,ct=U+1,B=V+1;let q=0,j=0;const yt=new $;for(let St=0;St<B;St++){const P=St*N-tt;for(let et=0;et<ct;et++){const X=et*w-J;yt[R]=X*I,yt[y]=P*z,yt[_]=rt,p.push(yt.x,yt.y,yt.z),yt[R]=0,yt[y]=0,yt[_]=L>0?1:-1,v.push(yt.x,yt.y,yt.z),g.push(et/U),g.push(1-St/V),q+=1}}for(let St=0;St<V;St++)for(let P=0;P<U;P++){const et=S+P+ct*St,X=S+P+ct*(St+1),pt=S+(P+1)+ct*(St+1),Y=S+(P+1)+ct*St;m.push(et,X,Y),m.push(X,pt,Y),j+=6}h.addGroup(M,j,A),M+=j,S+=q}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Io(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Cs(s){const e={};for(const i in s){e[i]={};for(const r in s[i]){const l=s[i][r];l&&(l.isColor||l.isMatrix3||l.isMatrix4||l.isVector2||l.isVector3||l.isVector4||l.isTexture||l.isQuaternion)?l.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[i][r]=null):e[i][r]=l.clone():Array.isArray(l)?e[i][r]=l.slice():e[i][r]=l}}return e}function Nn(s){const e={};for(let i=0;i<s.length;i++){const r=Cs(s[i]);for(const l in r)e[l]=r[l]}return e}function Ky(s){const e=[];for(let i=0;i<s.length;i++)e.push(s[i].clone());return e}function J_(s){const e=s.getRenderTarget();return e===null?s.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:we.workingColorSpace}const Qy={clone:Cs,merge:Nn};var Jy=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,$y=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Ga extends Fo{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Jy,this.fragmentShader=$y,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Cs(e.uniforms),this.uniformsGroups=Ky(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const i=super.toJSON(e);i.glslVersion=this.glslVersion,i.uniforms={};for(const l in this.uniforms){const d=this.uniforms[l].value;d&&d.isTexture?i.uniforms[l]={type:"t",value:d.toJSON(e).uuid}:d&&d.isColor?i.uniforms[l]={type:"c",value:d.getHex()}:d&&d.isVector2?i.uniforms[l]={type:"v2",value:d.toArray()}:d&&d.isVector3?i.uniforms[l]={type:"v3",value:d.toArray()}:d&&d.isVector4?i.uniforms[l]={type:"v4",value:d.toArray()}:d&&d.isMatrix3?i.uniforms[l]={type:"m3",value:d.toArray()}:d&&d.isMatrix4?i.uniforms[l]={type:"m4",value:d.toArray()}:i.uniforms[l]={value:d}}Object.keys(this.defines).length>0&&(i.defines=this.defines),i.vertexShader=this.vertexShader,i.fragmentShader=this.fragmentShader,i.lights=this.lights,i.clipping=this.clipping;const r={};for(const l in this.extensions)this.extensions[l]===!0&&(r[l]=!0);return Object.keys(r).length>0&&(i.extensions=r),i}}class $_ extends Rn{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new $e,this.projectionMatrix=new $e,this.projectionMatrixInverse=new $e,this.coordinateSystem=Di,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,i){return super.copy(e,i),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,i){super.updateWorldMatrix(e,i),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Pa=new $,X0=new Ae,W0=new Ae;class fi extends $_{constructor(e=50,i=1,r=.1,l=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=r,this.far=l,this.focus=10,this.aspect=i,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,i){return super.copy(e,i),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const i=.5*this.getFilmHeight()/e;this.fov=zo*2*Math.atan(i),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(wo*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return zo*2*Math.atan(Math.tan(wo*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,i,r){Pa.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Pa.x,Pa.y).multiplyScalar(-e/Pa.z),Pa.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),r.set(Pa.x,Pa.y).multiplyScalar(-e/Pa.z)}getViewSize(e,i){return this.getViewBounds(e,X0,W0),i.subVectors(W0,X0)}setViewOffset(e,i,r,l,c,d){this.aspect=e/i,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=i,this.view.offsetX=r,this.view.offsetY=l,this.view.width=c,this.view.height=d,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let i=e*Math.tan(wo*.5*this.fov)/this.zoom,r=2*i,l=this.aspect*r,c=-.5*l;const d=this.view;if(this.view!==null&&this.view.enabled){const m=d.fullWidth,p=d.fullHeight;c+=d.offsetX*l/m,i-=d.offsetY*r/p,l*=d.width/m,r*=d.height/p}const h=this.filmOffset;h!==0&&(c+=e*h/this.getFilmWidth()),this.projectionMatrix.makePerspective(c,c+l,i,i-r,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const i=super.toJSON(e);return i.object.fov=this.fov,i.object.zoom=this.zoom,i.object.near=this.near,i.object.far=this.far,i.object.focus=this.focus,i.object.aspect=this.aspect,this.view!==null&&(i.object.view=Object.assign({},this.view)),i.object.filmGauge=this.filmGauge,i.object.filmOffset=this.filmOffset,i}}const gs=-90,_s=1;class tM extends Rn{constructor(e,i,r){super(),this.type="CubeCamera",this.renderTarget=r,this.coordinateSystem=null,this.activeMipmapLevel=0;const l=new fi(gs,_s,e,i);l.layers=this.layers,this.add(l);const c=new fi(gs,_s,e,i);c.layers=this.layers,this.add(c);const d=new fi(gs,_s,e,i);d.layers=this.layers,this.add(d);const h=new fi(gs,_s,e,i);h.layers=this.layers,this.add(h);const m=new fi(gs,_s,e,i);m.layers=this.layers,this.add(m);const p=new fi(gs,_s,e,i);p.layers=this.layers,this.add(p)}updateCoordinateSystem(){const e=this.coordinateSystem,i=this.children.concat(),[r,l,c,d,h,m]=i;for(const p of i)this.remove(p);if(e===Di)r.up.set(0,1,0),r.lookAt(1,0,0),l.up.set(0,1,0),l.lookAt(-1,0,0),c.up.set(0,0,-1),c.lookAt(0,1,0),d.up.set(0,0,1),d.lookAt(0,-1,0),h.up.set(0,1,0),h.lookAt(0,0,1),m.up.set(0,1,0),m.lookAt(0,0,-1);else if(e===Cc)r.up.set(0,-1,0),r.lookAt(-1,0,0),l.up.set(0,-1,0),l.lookAt(1,0,0),c.up.set(0,0,1),c.lookAt(0,1,0),d.up.set(0,0,-1),d.lookAt(0,-1,0),h.up.set(0,-1,0),h.lookAt(0,0,1),m.up.set(0,-1,0),m.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const p of i)this.add(p),p.updateMatrixWorld()}update(e,i){this.parent===null&&this.updateMatrixWorld();const{renderTarget:r,activeMipmapLevel:l}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[c,d,h,m,p,v]=this.children,g=e.getRenderTarget(),S=e.getActiveCubeFace(),M=e.getActiveMipmapLevel(),T=e.xr.enabled;e.xr.enabled=!1;const R=r.texture.generateMipmaps;r.texture.generateMipmaps=!1,e.setRenderTarget(r,0,l),e.render(i,c),e.setRenderTarget(r,1,l),e.render(i,d),e.setRenderTarget(r,2,l),e.render(i,h),e.setRenderTarget(r,3,l),e.render(i,m),e.setRenderTarget(r,4,l),e.render(i,p),r.texture.generateMipmaps=R,e.setRenderTarget(r,5,l),e.render(i,v),e.setRenderTarget(g,S,M),e.xr.enabled=T,r.texture.needsPMREMUpdate=!0}}class tv extends Vn{constructor(e=[],i=bs,r,l,c,d,h,m,p,v){super(e,i,r,l,c,d,h,m,p,v),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class eM extends yr{constructor(e=1,i={}){super(e,e,i),this.isWebGLCubeRenderTarget=!0;const r={width:e,height:e,depth:1},l=[r,r,r,r,r,r];this.texture=new tv(l),this._setTextureOptions(i),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,i){this.texture.type=i.type,this.texture.colorSpace=i.colorSpace,this.texture.generateMipmaps=i.generateMipmaps,this.texture.minFilter=i.minFilter,this.texture.magFilter=i.magFilter;const r={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},l=new Io(5,5,5),c=new Ga({name:"CubemapFromEquirect",uniforms:Cs(r.uniforms),vertexShader:r.vertexShader,fragmentShader:r.fragmentShader,side:Gn,blending:Fa});c.uniforms.tEquirect.value=i;const d=new Hn(l,c),h=i.minFilter;return i.minFilter===vr&&(i.minFilter=wi),new tM(1,10,this).update(e,d),i.minFilter=h,d.geometry.dispose(),d.material.dispose(),this}clear(e,i=!0,r=!0,l=!0){const c=e.getRenderTarget();for(let d=0;d<6;d++)e.setRenderTarget(this,d),e.clear(i,r,l);e.setRenderTarget(c)}}class xr extends Rn{constructor(){super(),this.isGroup=!0,this.type="Group"}}const nM={type:"move"};class hd{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new xr,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new xr,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new $,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new $),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new xr,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new $,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new $),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const i=this._hand;if(i)for(const r of e.hand.values())this._getHandJoint(i,r)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,i,r){let l=null,c=null,d=null;const h=this._targetRay,m=this._grip,p=this._hand;if(e&&i.session.visibilityState!=="visible-blurred"){if(p&&e.hand){d=!0;for(const R of e.hand.values()){const y=i.getJointPose(R,r),_=this._getHandJoint(p,R);y!==null&&(_.matrix.fromArray(y.transform.matrix),_.matrix.decompose(_.position,_.rotation,_.scale),_.matrixWorldNeedsUpdate=!0,_.jointRadius=y.radius),_.visible=y!==null}const v=p.joints["index-finger-tip"],g=p.joints["thumb-tip"],S=v.position.distanceTo(g.position),M=.02,T=.005;p.inputState.pinching&&S>M+T?(p.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!p.inputState.pinching&&S<=M-T&&(p.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else m!==null&&e.gripSpace&&(c=i.getPose(e.gripSpace,r),c!==null&&(m.matrix.fromArray(c.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,c.linearVelocity?(m.hasLinearVelocity=!0,m.linearVelocity.copy(c.linearVelocity)):m.hasLinearVelocity=!1,c.angularVelocity?(m.hasAngularVelocity=!0,m.angularVelocity.copy(c.angularVelocity)):m.hasAngularVelocity=!1));h!==null&&(l=i.getPose(e.targetRaySpace,r),l===null&&c!==null&&(l=c),l!==null&&(h.matrix.fromArray(l.transform.matrix),h.matrix.decompose(h.position,h.rotation,h.scale),h.matrixWorldNeedsUpdate=!0,l.linearVelocity?(h.hasLinearVelocity=!0,h.linearVelocity.copy(l.linearVelocity)):h.hasLinearVelocity=!1,l.angularVelocity?(h.hasAngularVelocity=!0,h.angularVelocity.copy(l.angularVelocity)):h.hasAngularVelocity=!1,this.dispatchEvent(nM)))}return h!==null&&(h.visible=l!==null),m!==null&&(m.visible=c!==null),p!==null&&(p.visible=d!==null),this}_getHandJoint(e,i){if(e.joints[i.jointName]===void 0){const r=new xr;r.matrixAutoUpdate=!1,r.visible=!1,e.joints[i.jointName]=r,e.add(r)}return e.joints[i.jointName]}}class iM extends Rn{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ni,this.environmentIntensity=1,this.environmentRotation=new Ni,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,i){return super.copy(e,i),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const i=super.toJSON(e);return this.fog!==null&&(i.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(i.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(i.object.backgroundIntensity=this.backgroundIntensity),i.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(i.object.environmentIntensity=this.environmentIntensity),i.object.environmentRotation=this.environmentRotation.toArray(),i}}const pd=new $,aM=new $,rM=new oe;class hr{constructor(e=new $(1,0,0),i=0){this.isPlane=!0,this.normal=e,this.constant=i}set(e,i){return this.normal.copy(e),this.constant=i,this}setComponents(e,i,r,l){return this.normal.set(e,i,r),this.constant=l,this}setFromNormalAndCoplanarPoint(e,i){return this.normal.copy(e),this.constant=-i.dot(this.normal),this}setFromCoplanarPoints(e,i,r){const l=pd.subVectors(r,i).cross(aM.subVectors(e,i)).normalize();return this.setFromNormalAndCoplanarPoint(l,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,i){return i.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,i){const r=e.delta(pd),l=this.normal.dot(r);if(l===0)return this.distanceToPoint(e.start)===0?i.copy(e.start):null;const c=-(e.start.dot(this.normal)+this.constant)/l;return c<0||c>1?null:i.copy(e.start).addScaledVector(r,c)}intersectsLine(e){const i=this.distanceToPoint(e.start),r=this.distanceToPoint(e.end);return i<0&&r>0||r<0&&i>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,i){const r=i||rM.getNormalMatrix(e),l=this.coplanarPoint(pd).applyMatrix4(e),c=this.normal.applyMatrix3(r).normalize();return this.constant=-l.dot(c),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const ur=new Th,sM=new Ae(.5,.5),hc=new $;class Ah{constructor(e=new hr,i=new hr,r=new hr,l=new hr,c=new hr,d=new hr){this.planes=[e,i,r,l,c,d]}set(e,i,r,l,c,d){const h=this.planes;return h[0].copy(e),h[1].copy(i),h[2].copy(r),h[3].copy(l),h[4].copy(c),h[5].copy(d),this}copy(e){const i=this.planes;for(let r=0;r<6;r++)i[r].copy(e.planes[r]);return this}setFromProjectionMatrix(e,i=Di,r=!1){const l=this.planes,c=e.elements,d=c[0],h=c[1],m=c[2],p=c[3],v=c[4],g=c[5],S=c[6],M=c[7],T=c[8],R=c[9],y=c[10],_=c[11],I=c[12],z=c[13],D=c[14],H=c[15];if(l[0].setComponents(p-d,M-v,_-T,H-I).normalize(),l[1].setComponents(p+d,M+v,_+T,H+I).normalize(),l[2].setComponents(p+h,M+g,_+R,H+z).normalize(),l[3].setComponents(p-h,M-g,_-R,H-z).normalize(),r)l[4].setComponents(m,S,y,D).normalize(),l[5].setComponents(p-m,M-S,_-y,H-D).normalize();else if(l[4].setComponents(p-m,M-S,_-y,H-D).normalize(),i===Di)l[5].setComponents(p+m,M+S,_+y,H+D).normalize();else if(i===Cc)l[5].setComponents(m,S,y,D).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+i);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ur.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const i=e.geometry;i.boundingSphere===null&&i.computeBoundingSphere(),ur.copy(i.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ur)}intersectsSprite(e){ur.center.set(0,0,0);const i=sM.distanceTo(e.center);return ur.radius=.7071067811865476+i,ur.applyMatrix4(e.matrixWorld),this.intersectsSphere(ur)}intersectsSphere(e){const i=this.planes,r=e.center,l=-e.radius;for(let c=0;c<6;c++)if(i[c].distanceToPoint(r)<l)return!1;return!0}intersectsBox(e){const i=this.planes;for(let r=0;r<6;r++){const l=i[r];if(hc.x=l.normal.x>0?e.max.x:e.min.x,hc.y=l.normal.y>0?e.max.y:e.min.y,hc.z=l.normal.z>0?e.max.z:e.min.z,l.distanceToPoint(hc)<0)return!1}return!0}containsPoint(e){const i=this.planes;for(let r=0;r<6;r++)if(i[r].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class ev extends Vn{constructor(e,i,r=Sr,l,c,d,h=Si,m=Si,p,v=No,g=1){if(v!==No&&v!==Oo)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const S={width:e,height:i,depth:g};super(S,l,c,d,h,m,v,r,p),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Eh(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){const i=super.toJSON(e);return this.compareFunction!==null&&(i.compareFunction=this.compareFunction),i}}class Uc extends yi{constructor(e=1,i=1,r=1,l=32,c=1,d=!1,h=0,m=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:i,height:r,radialSegments:l,heightSegments:c,openEnded:d,thetaStart:h,thetaLength:m};const p=this;l=Math.floor(l),c=Math.floor(c);const v=[],g=[],S=[],M=[];let T=0;const R=[],y=r/2;let _=0;I(),d===!1&&(e>0&&z(!0),i>0&&z(!1)),this.setIndex(v),this.setAttribute("position",new Cn(g,3)),this.setAttribute("normal",new Cn(S,3)),this.setAttribute("uv",new Cn(M,2));function I(){const D=new $,H=new $;let L=0;const U=(i-e)/r;for(let V=0;V<=c;V++){const A=[],w=V/c,N=w*(i-e)+e;for(let J=0;J<=l;J++){const tt=J/l,rt=tt*m+h,ct=Math.sin(rt),B=Math.cos(rt);H.x=N*ct,H.y=-w*r+y,H.z=N*B,g.push(H.x,H.y,H.z),D.set(ct,U,B).normalize(),S.push(D.x,D.y,D.z),M.push(tt,1-w),A.push(T++)}R.push(A)}for(let V=0;V<l;V++)for(let A=0;A<c;A++){const w=R[A][V],N=R[A+1][V],J=R[A+1][V+1],tt=R[A][V+1];(e>0||A!==0)&&(v.push(w,N,tt),L+=3),(i>0||A!==c-1)&&(v.push(N,J,tt),L+=3)}p.addGroup(_,L,0),_+=L}function z(D){const H=T,L=new Ae,U=new $;let V=0;const A=D===!0?e:i,w=D===!0?1:-1;for(let J=1;J<=l;J++)g.push(0,y*w,0),S.push(0,w,0),M.push(.5,.5),T++;const N=T;for(let J=0;J<=l;J++){const rt=J/l*m+h,ct=Math.cos(rt),B=Math.sin(rt);U.x=A*B,U.y=y*w,U.z=A*ct,g.push(U.x,U.y,U.z),S.push(0,w,0),L.x=ct*.5+.5,L.y=B*.5*w+.5,M.push(L.x,L.y),T++}for(let J=0;J<l;J++){const tt=H+J,rt=N+J;D===!0?v.push(rt,rt+1,tt):v.push(rt+1,rt,tt),V+=3}p.addGroup(_,V,D===!0?1:2),_+=V}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Uc(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class Rh extends Uc{constructor(e=1,i=1,r=32,l=1,c=!1,d=0,h=Math.PI*2){super(0,e,i,r,l,c,d,h),this.type="ConeGeometry",this.parameters={radius:e,height:i,radialSegments:r,heightSegments:l,openEnded:c,thetaStart:d,thetaLength:h}}static fromJSON(e){return new Rh(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class Lc extends yi{constructor(e=1,i=1,r=1,l=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:i,widthSegments:r,heightSegments:l};const c=e/2,d=i/2,h=Math.floor(r),m=Math.floor(l),p=h+1,v=m+1,g=e/h,S=i/m,M=[],T=[],R=[],y=[];for(let _=0;_<v;_++){const I=_*S-d;for(let z=0;z<p;z++){const D=z*g-c;T.push(D,-I,0),R.push(0,0,1),y.push(z/h),y.push(1-_/m)}}for(let _=0;_<m;_++)for(let I=0;I<h;I++){const z=I+p*_,D=I+p*(_+1),H=I+1+p*(_+1),L=I+1+p*_;M.push(z,D,L),M.push(D,H,L)}this.setIndex(M),this.setAttribute("position",new Cn(T,3)),this.setAttribute("normal",new Cn(R,3)),this.setAttribute("uv",new Cn(y,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Lc(e.width,e.height,e.widthSegments,e.heightSegments)}}class Ch extends yi{constructor(e=1,i=32,r=16,l=0,c=Math.PI*2,d=0,h=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:i,heightSegments:r,phiStart:l,phiLength:c,thetaStart:d,thetaLength:h},i=Math.max(3,Math.floor(i)),r=Math.max(2,Math.floor(r));const m=Math.min(d+h,Math.PI);let p=0;const v=[],g=new $,S=new $,M=[],T=[],R=[],y=[];for(let _=0;_<=r;_++){const I=[],z=_/r;let D=0;_===0&&d===0?D=.5/i:_===r&&m===Math.PI&&(D=-.5/i);for(let H=0;H<=i;H++){const L=H/i;g.x=-e*Math.cos(l+L*c)*Math.sin(d+z*h),g.y=e*Math.cos(d+z*h),g.z=e*Math.sin(l+L*c)*Math.sin(d+z*h),T.push(g.x,g.y,g.z),S.copy(g).normalize(),R.push(S.x,S.y,S.z),y.push(L+D,1-z),I.push(p++)}v.push(I)}for(let _=0;_<r;_++)for(let I=0;I<i;I++){const z=v[_][I+1],D=v[_][I],H=v[_+1][I],L=v[_+1][I+1];(_!==0||d>0)&&M.push(z,D,L),(_!==r-1||m<Math.PI)&&M.push(D,H,L)}this.setIndex(M),this.setAttribute("position",new Cn(T,3)),this.setAttribute("normal",new Cn(R,3)),this.setAttribute("uv",new Cn(y,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Ch(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class wh extends yi{constructor(e=1,i=.4,r=12,l=48,c=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:i,radialSegments:r,tubularSegments:l,arc:c},r=Math.floor(r),l=Math.floor(l);const d=[],h=[],m=[],p=[],v=new $,g=new $,S=new $;for(let M=0;M<=r;M++)for(let T=0;T<=l;T++){const R=T/l*c,y=M/r*Math.PI*2;g.x=(e+i*Math.cos(y))*Math.cos(R),g.y=(e+i*Math.cos(y))*Math.sin(R),g.z=i*Math.sin(y),h.push(g.x,g.y,g.z),v.x=e*Math.cos(R),v.y=e*Math.sin(R),S.subVectors(g,v).normalize(),m.push(S.x,S.y,S.z),p.push(T/l),p.push(M/r)}for(let M=1;M<=r;M++)for(let T=1;T<=l;T++){const R=(l+1)*M+T-1,y=(l+1)*(M-1)+T-1,_=(l+1)*(M-1)+T,I=(l+1)*M+T;d.push(R,y,I),d.push(y,_,I)}this.setIndex(d),this.setAttribute("position",new Cn(h,3)),this.setAttribute("normal",new Cn(m,3)),this.setAttribute("uv",new Cn(p,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new wh(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}}class Dh extends Fo{constructor(e){super(),this.isMeshPhongMaterial=!0,this.type="MeshPhongMaterial",this.color=new be(16777215),this.specular=new be(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new be(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=k_,this.normalScale=new Ae(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ni,this.combine=mh,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.specular.copy(e.specular),this.shininess=e.shininess,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class oM extends Fo{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=ry,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class lM extends Fo{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}class nv extends Rn{constructor(e,i=1){super(),this.isLight=!0,this.type="Light",this.color=new be(e),this.intensity=i}dispose(){}copy(e,i){return super.copy(e,i),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const i=super.toJSON(e);return i.object.color=this.color.getHex(),i.object.intensity=this.intensity,this.groundColor!==void 0&&(i.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(i.object.distance=this.distance),this.angle!==void 0&&(i.object.angle=this.angle),this.decay!==void 0&&(i.object.decay=this.decay),this.penumbra!==void 0&&(i.object.penumbra=this.penumbra),this.shadow!==void 0&&(i.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(i.object.target=this.target.uuid),i}}const md=new $e,q0=new $,Y0=new $;class cM{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ae(512,512),this.mapType=Li,this.map=null,this.mapPass=null,this.matrix=new $e,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ah,this._frameExtents=new Ae(1,1),this._viewportCount=1,this._viewports=[new Je(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const i=this.camera,r=this.matrix;q0.setFromMatrixPosition(e.matrixWorld),i.position.copy(q0),Y0.setFromMatrixPosition(e.target.matrixWorld),i.lookAt(Y0),i.updateMatrixWorld(),md.multiplyMatrices(i.projectionMatrix,i.matrixWorldInverse),this._frustum.setFromProjectionMatrix(md,i.coordinateSystem,i.reversedDepth),i.reversedDepth?r.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):r.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),r.multiply(md)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class iv extends $_{constructor(e=-1,i=1,r=1,l=-1,c=.1,d=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=i,this.top=r,this.bottom=l,this.near=c,this.far=d,this.updateProjectionMatrix()}copy(e,i){return super.copy(e,i),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,i,r,l,c,d){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=i,this.view.offsetX=r,this.view.offsetY=l,this.view.width=c,this.view.height=d,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),i=(this.top-this.bottom)/(2*this.zoom),r=(this.right+this.left)/2,l=(this.top+this.bottom)/2;let c=r-e,d=r+e,h=l+i,m=l-i;if(this.view!==null&&this.view.enabled){const p=(this.right-this.left)/this.view.fullWidth/this.zoom,v=(this.top-this.bottom)/this.view.fullHeight/this.zoom;c+=p*this.view.offsetX,d=c+p*this.view.width,h-=v*this.view.offsetY,m=h-v*this.view.height}this.projectionMatrix.makeOrthographic(c,d,h,m,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const i=super.toJSON(e);return i.object.zoom=this.zoom,i.object.left=this.left,i.object.right=this.right,i.object.top=this.top,i.object.bottom=this.bottom,i.object.near=this.near,i.object.far=this.far,this.view!==null&&(i.object.view=Object.assign({},this.view)),i}}class uM extends cM{constructor(){super(new iv(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Z0 extends nv{constructor(e,i){super(e,i),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Rn.DEFAULT_UP),this.updateMatrix(),this.target=new Rn,this.shadow=new uM}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class fM extends nv{constructor(e,i){super(e,i),this.isAmbientLight=!0,this.type="AmbientLight"}}class dM extends fi{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}}const j0=new $e;class hM{constructor(e,i,r=0,l=1/0){this.ray=new Y_(e,i),this.near=r,this.far=l,this.camera=null,this.layers=new bh,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,i){this.ray.set(e,i)}setFromCamera(e,i){i.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(i.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(i).sub(this.ray.origin).normalize(),this.camera=i):i.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(i.near+i.far)/(i.near-i.far)).unproject(i),this.ray.direction.set(0,0,-1).transformDirection(i.matrixWorld),this.camera=i):console.error("THREE.Raycaster: Unsupported camera type: "+i.type)}setFromXRController(e){return j0.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(j0),this}intersectObject(e,i=!0,r=[]){return uh(e,this,r,i),r.sort(K0),r}intersectObjects(e,i=!0,r=[]){for(let l=0,c=e.length;l<c;l++)uh(e[l],this,r,i);return r.sort(K0),r}}function K0(s,e){return s.distance-e.distance}function uh(s,e,i,r){let l=!0;if(s.layers.test(e.layers)&&s.raycast(e,i)===!1&&(l=!1),l===!0&&r===!0){const c=s.children;for(let d=0,h=c.length;d<h;d++)uh(c[d],e,i,!0)}}function Q0(s,e,i,r){const l=pM(r);switch(i){case F_:return s*e;case H_:return s*e/l.components*l.byteLength;case xh:return s*e/l.components*l.byteLength;case G_:return s*e*2/l.components*l.byteLength;case Sh:return s*e*2/l.components*l.byteLength;case I_:return s*e*3/l.components*l.byteLength;case xi:return s*e*4/l.components*l.byteLength;case yh:return s*e*4/l.components*l.byteLength;case Sc:case yc:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*8;case Mc:case Ec:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case Id:case Gd:return Math.max(s,16)*Math.max(e,8)/4;case Fd:case Hd:return Math.max(s,8)*Math.max(e,8)/2;case Vd:case kd:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*8;case Xd:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case Wd:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case qd:return Math.floor((s+4)/5)*Math.floor((e+3)/4)*16;case Yd:return Math.floor((s+4)/5)*Math.floor((e+4)/5)*16;case Zd:return Math.floor((s+5)/6)*Math.floor((e+4)/5)*16;case jd:return Math.floor((s+5)/6)*Math.floor((e+5)/6)*16;case Kd:return Math.floor((s+7)/8)*Math.floor((e+4)/5)*16;case Qd:return Math.floor((s+7)/8)*Math.floor((e+5)/6)*16;case Jd:return Math.floor((s+7)/8)*Math.floor((e+7)/8)*16;case $d:return Math.floor((s+9)/10)*Math.floor((e+4)/5)*16;case th:return Math.floor((s+9)/10)*Math.floor((e+5)/6)*16;case eh:return Math.floor((s+9)/10)*Math.floor((e+7)/8)*16;case nh:return Math.floor((s+9)/10)*Math.floor((e+9)/10)*16;case ih:return Math.floor((s+11)/12)*Math.floor((e+9)/10)*16;case ah:return Math.floor((s+11)/12)*Math.floor((e+11)/12)*16;case Tc:case rh:case sh:return Math.ceil(s/4)*Math.ceil(e/4)*16;case V_:case oh:return Math.ceil(s/4)*Math.ceil(e/4)*8;case lh:case ch:return Math.ceil(s/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${i} format.`)}function pM(s){switch(s){case Li:case z_:return{byteLength:1,components:1};case Uo:case P_:case Po:return{byteLength:2,components:1};case _h:case vh:return{byteLength:2,components:4};case Sr:case gh:case ra:return{byteLength:4,components:1};case B_:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${s}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:ph}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=ph);function av(){let s=null,e=!1,i=null,r=null;function l(c,d){i(c,d),r=s.requestAnimationFrame(l)}return{start:function(){e!==!0&&i!==null&&(r=s.requestAnimationFrame(l),e=!0)},stop:function(){s.cancelAnimationFrame(r),e=!1},setAnimationLoop:function(c){i=c},setContext:function(c){s=c}}}function mM(s){const e=new WeakMap;function i(h,m){const p=h.array,v=h.usage,g=p.byteLength,S=s.createBuffer();s.bindBuffer(m,S),s.bufferData(m,p,v),h.onUploadCallback();let M;if(p instanceof Float32Array)M=s.FLOAT;else if(typeof Float16Array<"u"&&p instanceof Float16Array)M=s.HALF_FLOAT;else if(p instanceof Uint16Array)h.isFloat16BufferAttribute?M=s.HALF_FLOAT:M=s.UNSIGNED_SHORT;else if(p instanceof Int16Array)M=s.SHORT;else if(p instanceof Uint32Array)M=s.UNSIGNED_INT;else if(p instanceof Int32Array)M=s.INT;else if(p instanceof Int8Array)M=s.BYTE;else if(p instanceof Uint8Array)M=s.UNSIGNED_BYTE;else if(p instanceof Uint8ClampedArray)M=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+p);return{buffer:S,type:M,bytesPerElement:p.BYTES_PER_ELEMENT,version:h.version,size:g}}function r(h,m,p){const v=m.array,g=m.updateRanges;if(s.bindBuffer(p,h),g.length===0)s.bufferSubData(p,0,v);else{g.sort((M,T)=>M.start-T.start);let S=0;for(let M=1;M<g.length;M++){const T=g[S],R=g[M];R.start<=T.start+T.count+1?T.count=Math.max(T.count,R.start+R.count-T.start):(++S,g[S]=R)}g.length=S+1;for(let M=0,T=g.length;M<T;M++){const R=g[M];s.bufferSubData(p,R.start*v.BYTES_PER_ELEMENT,v,R.start,R.count)}m.clearUpdateRanges()}m.onUploadCallback()}function l(h){return h.isInterleavedBufferAttribute&&(h=h.data),e.get(h)}function c(h){h.isInterleavedBufferAttribute&&(h=h.data);const m=e.get(h);m&&(s.deleteBuffer(m.buffer),e.delete(h))}function d(h,m){if(h.isInterleavedBufferAttribute&&(h=h.data),h.isGLBufferAttribute){const v=e.get(h);(!v||v.version<h.version)&&e.set(h,{buffer:h.buffer,type:h.type,bytesPerElement:h.elementSize,version:h.version});return}const p=e.get(h);if(p===void 0)e.set(h,i(h,m));else if(p.version<h.version){if(p.size!==h.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");r(p.buffer,h,m),p.version=h.version}}return{get:l,remove:c,update:d}}var gM=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,_M=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,vM=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,xM=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,SM=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,yM=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,MM=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,EM=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,TM=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,bM=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,AM=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,RM=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,CM=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,wM=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,DM=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,UM=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,LM=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,NM=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,OM=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,zM=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,PM=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,BM=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,FM=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,IM=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,HM=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,GM=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,VM=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,kM=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,XM=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,WM=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,qM="gl_FragColor = linearToOutputTexel( gl_FragColor );",YM=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,ZM=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,jM=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,KM=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,QM=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,JM=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,$M=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,tE=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,eE=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,nE=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,iE=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,aE=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,rE=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,sE=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,oE=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,lE=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,cE=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,uE=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,fE=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,dE=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,hE=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,pE=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,mE=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,gE=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,_E=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,vE=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,xE=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,SE=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,yE=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,ME=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,EE=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,TE=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,bE=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,AE=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,RE=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,CE=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,wE=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,DE=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,UE=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,LE=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,NE=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,OE=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,zE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,PE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,BE=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,FE=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,IE=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,HE=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,GE=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,VE=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,kE=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,XE=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,WE=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,qE=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,YE=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,ZE=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,jE=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,KE=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,QE=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSEDEPTHBUF
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSEDEPTHBUF
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare , distribution.x );
		#endif
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,JE=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,$E=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,tT=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,eT=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,nT=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,iT=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,aT=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,rT=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,sT=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,oT=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,lT=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,cT=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,uT=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,fT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,dT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,hT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,pT=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const mT=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,gT=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_T=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,vT=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,xT=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,ST=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,yT=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,MT=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSEDEPTHBUF
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,ET=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,TT=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,bT=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,AT=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,RT=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,CT=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,wT=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,DT=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,UT=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,LT=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,NT=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,OT=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,zT=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,PT=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,BT=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,FT=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,IT=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,HT=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,GT=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,VT=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,kT=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,XT=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,WT=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,qT=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,YT=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,ZT=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,ce={alphahash_fragment:gM,alphahash_pars_fragment:_M,alphamap_fragment:vM,alphamap_pars_fragment:xM,alphatest_fragment:SM,alphatest_pars_fragment:yM,aomap_fragment:MM,aomap_pars_fragment:EM,batching_pars_vertex:TM,batching_vertex:bM,begin_vertex:AM,beginnormal_vertex:RM,bsdfs:CM,iridescence_fragment:wM,bumpmap_pars_fragment:DM,clipping_planes_fragment:UM,clipping_planes_pars_fragment:LM,clipping_planes_pars_vertex:NM,clipping_planes_vertex:OM,color_fragment:zM,color_pars_fragment:PM,color_pars_vertex:BM,color_vertex:FM,common:IM,cube_uv_reflection_fragment:HM,defaultnormal_vertex:GM,displacementmap_pars_vertex:VM,displacementmap_vertex:kM,emissivemap_fragment:XM,emissivemap_pars_fragment:WM,colorspace_fragment:qM,colorspace_pars_fragment:YM,envmap_fragment:ZM,envmap_common_pars_fragment:jM,envmap_pars_fragment:KM,envmap_pars_vertex:QM,envmap_physical_pars_fragment:lE,envmap_vertex:JM,fog_vertex:$M,fog_pars_vertex:tE,fog_fragment:eE,fog_pars_fragment:nE,gradientmap_pars_fragment:iE,lightmap_pars_fragment:aE,lights_lambert_fragment:rE,lights_lambert_pars_fragment:sE,lights_pars_begin:oE,lights_toon_fragment:cE,lights_toon_pars_fragment:uE,lights_phong_fragment:fE,lights_phong_pars_fragment:dE,lights_physical_fragment:hE,lights_physical_pars_fragment:pE,lights_fragment_begin:mE,lights_fragment_maps:gE,lights_fragment_end:_E,logdepthbuf_fragment:vE,logdepthbuf_pars_fragment:xE,logdepthbuf_pars_vertex:SE,logdepthbuf_vertex:yE,map_fragment:ME,map_pars_fragment:EE,map_particle_fragment:TE,map_particle_pars_fragment:bE,metalnessmap_fragment:AE,metalnessmap_pars_fragment:RE,morphinstance_vertex:CE,morphcolor_vertex:wE,morphnormal_vertex:DE,morphtarget_pars_vertex:UE,morphtarget_vertex:LE,normal_fragment_begin:NE,normal_fragment_maps:OE,normal_pars_fragment:zE,normal_pars_vertex:PE,normal_vertex:BE,normalmap_pars_fragment:FE,clearcoat_normal_fragment_begin:IE,clearcoat_normal_fragment_maps:HE,clearcoat_pars_fragment:GE,iridescence_pars_fragment:VE,opaque_fragment:kE,packing:XE,premultiplied_alpha_fragment:WE,project_vertex:qE,dithering_fragment:YE,dithering_pars_fragment:ZE,roughnessmap_fragment:jE,roughnessmap_pars_fragment:KE,shadowmap_pars_fragment:QE,shadowmap_pars_vertex:JE,shadowmap_vertex:$E,shadowmask_pars_fragment:tT,skinbase_vertex:eT,skinning_pars_vertex:nT,skinning_vertex:iT,skinnormal_vertex:aT,specularmap_fragment:rT,specularmap_pars_fragment:sT,tonemapping_fragment:oT,tonemapping_pars_fragment:lT,transmission_fragment:cT,transmission_pars_fragment:uT,uv_pars_fragment:fT,uv_pars_vertex:dT,uv_vertex:hT,worldpos_vertex:pT,background_vert:mT,background_frag:gT,backgroundCube_vert:_T,backgroundCube_frag:vT,cube_vert:xT,cube_frag:ST,depth_vert:yT,depth_frag:MT,distanceRGBA_vert:ET,distanceRGBA_frag:TT,equirect_vert:bT,equirect_frag:AT,linedashed_vert:RT,linedashed_frag:CT,meshbasic_vert:wT,meshbasic_frag:DT,meshlambert_vert:UT,meshlambert_frag:LT,meshmatcap_vert:NT,meshmatcap_frag:OT,meshnormal_vert:zT,meshnormal_frag:PT,meshphong_vert:BT,meshphong_frag:FT,meshphysical_vert:IT,meshphysical_frag:HT,meshtoon_vert:GT,meshtoon_frag:VT,points_vert:kT,points_frag:XT,shadow_vert:WT,shadow_frag:qT,sprite_vert:YT,sprite_frag:ZT},Ot={common:{diffuse:{value:new be(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new oe},alphaMap:{value:null},alphaMapTransform:{value:new oe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new oe}},envmap:{envMap:{value:null},envMapRotation:{value:new oe},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new oe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new oe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new oe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new oe},normalScale:{value:new Ae(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new oe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new oe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new oe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new oe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new be(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new be(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new oe},alphaTest:{value:0},uvTransform:{value:new oe}},sprite:{diffuse:{value:new be(16777215)},opacity:{value:1},center:{value:new Ae(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new oe},alphaMap:{value:null},alphaMapTransform:{value:new oe},alphaTest:{value:0}}},Ci={basic:{uniforms:Nn([Ot.common,Ot.specularmap,Ot.envmap,Ot.aomap,Ot.lightmap,Ot.fog]),vertexShader:ce.meshbasic_vert,fragmentShader:ce.meshbasic_frag},lambert:{uniforms:Nn([Ot.common,Ot.specularmap,Ot.envmap,Ot.aomap,Ot.lightmap,Ot.emissivemap,Ot.bumpmap,Ot.normalmap,Ot.displacementmap,Ot.fog,Ot.lights,{emissive:{value:new be(0)}}]),vertexShader:ce.meshlambert_vert,fragmentShader:ce.meshlambert_frag},phong:{uniforms:Nn([Ot.common,Ot.specularmap,Ot.envmap,Ot.aomap,Ot.lightmap,Ot.emissivemap,Ot.bumpmap,Ot.normalmap,Ot.displacementmap,Ot.fog,Ot.lights,{emissive:{value:new be(0)},specular:{value:new be(1118481)},shininess:{value:30}}]),vertexShader:ce.meshphong_vert,fragmentShader:ce.meshphong_frag},standard:{uniforms:Nn([Ot.common,Ot.envmap,Ot.aomap,Ot.lightmap,Ot.emissivemap,Ot.bumpmap,Ot.normalmap,Ot.displacementmap,Ot.roughnessmap,Ot.metalnessmap,Ot.fog,Ot.lights,{emissive:{value:new be(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ce.meshphysical_vert,fragmentShader:ce.meshphysical_frag},toon:{uniforms:Nn([Ot.common,Ot.aomap,Ot.lightmap,Ot.emissivemap,Ot.bumpmap,Ot.normalmap,Ot.displacementmap,Ot.gradientmap,Ot.fog,Ot.lights,{emissive:{value:new be(0)}}]),vertexShader:ce.meshtoon_vert,fragmentShader:ce.meshtoon_frag},matcap:{uniforms:Nn([Ot.common,Ot.bumpmap,Ot.normalmap,Ot.displacementmap,Ot.fog,{matcap:{value:null}}]),vertexShader:ce.meshmatcap_vert,fragmentShader:ce.meshmatcap_frag},points:{uniforms:Nn([Ot.points,Ot.fog]),vertexShader:ce.points_vert,fragmentShader:ce.points_frag},dashed:{uniforms:Nn([Ot.common,Ot.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ce.linedashed_vert,fragmentShader:ce.linedashed_frag},depth:{uniforms:Nn([Ot.common,Ot.displacementmap]),vertexShader:ce.depth_vert,fragmentShader:ce.depth_frag},normal:{uniforms:Nn([Ot.common,Ot.bumpmap,Ot.normalmap,Ot.displacementmap,{opacity:{value:1}}]),vertexShader:ce.meshnormal_vert,fragmentShader:ce.meshnormal_frag},sprite:{uniforms:Nn([Ot.sprite,Ot.fog]),vertexShader:ce.sprite_vert,fragmentShader:ce.sprite_frag},background:{uniforms:{uvTransform:{value:new oe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ce.background_vert,fragmentShader:ce.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new oe}},vertexShader:ce.backgroundCube_vert,fragmentShader:ce.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ce.cube_vert,fragmentShader:ce.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ce.equirect_vert,fragmentShader:ce.equirect_frag},distanceRGBA:{uniforms:Nn([Ot.common,Ot.displacementmap,{referencePosition:{value:new $},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ce.distanceRGBA_vert,fragmentShader:ce.distanceRGBA_frag},shadow:{uniforms:Nn([Ot.lights,Ot.fog,{color:{value:new be(0)},opacity:{value:1}}]),vertexShader:ce.shadow_vert,fragmentShader:ce.shadow_frag}};Ci.physical={uniforms:Nn([Ci.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new oe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new oe},clearcoatNormalScale:{value:new Ae(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new oe},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new oe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new oe},sheen:{value:0},sheenColor:{value:new be(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new oe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new oe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new oe},transmissionSamplerSize:{value:new Ae},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new oe},attenuationDistance:{value:0},attenuationColor:{value:new be(0)},specularColor:{value:new be(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new oe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new oe},anisotropyVector:{value:new Ae},anisotropyMap:{value:null},anisotropyMapTransform:{value:new oe}}]),vertexShader:ce.meshphysical_vert,fragmentShader:ce.meshphysical_frag};const pc={r:0,b:0,g:0},fr=new Ni,jT=new $e;function KT(s,e,i,r,l,c,d){const h=new be(0);let m=c===!0?0:1,p,v,g=null,S=0,M=null;function T(z){let D=z.isScene===!0?z.background:null;return D&&D.isTexture&&(D=(z.backgroundBlurriness>0?i:e).get(D)),D}function R(z){let D=!1;const H=T(z);H===null?_(h,m):H&&H.isColor&&(_(H,1),D=!0);const L=s.xr.getEnvironmentBlendMode();L==="additive"?r.buffers.color.setClear(0,0,0,1,d):L==="alpha-blend"&&r.buffers.color.setClear(0,0,0,0,d),(s.autoClear||D)&&(r.buffers.depth.setTest(!0),r.buffers.depth.setMask(!0),r.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function y(z,D){const H=T(D);H&&(H.isCubeTexture||H.mapping===Dc)?(v===void 0&&(v=new Hn(new Io(1,1,1),new Ga({name:"BackgroundCubeMaterial",uniforms:Cs(Ci.backgroundCube.uniforms),vertexShader:Ci.backgroundCube.vertexShader,fragmentShader:Ci.backgroundCube.fragmentShader,side:Gn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),v.geometry.deleteAttribute("normal"),v.geometry.deleteAttribute("uv"),v.onBeforeRender=function(L,U,V){this.matrixWorld.copyPosition(V.matrixWorld)},Object.defineProperty(v.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),l.update(v)),fr.copy(D.backgroundRotation),fr.x*=-1,fr.y*=-1,fr.z*=-1,H.isCubeTexture&&H.isRenderTargetTexture===!1&&(fr.y*=-1,fr.z*=-1),v.material.uniforms.envMap.value=H,v.material.uniforms.flipEnvMap.value=H.isCubeTexture&&H.isRenderTargetTexture===!1?-1:1,v.material.uniforms.backgroundBlurriness.value=D.backgroundBlurriness,v.material.uniforms.backgroundIntensity.value=D.backgroundIntensity,v.material.uniforms.backgroundRotation.value.setFromMatrix4(jT.makeRotationFromEuler(fr)),v.material.toneMapped=we.getTransfer(H.colorSpace)!==Ge,(g!==H||S!==H.version||M!==s.toneMapping)&&(v.material.needsUpdate=!0,g=H,S=H.version,M=s.toneMapping),v.layers.enableAll(),z.unshift(v,v.geometry,v.material,0,0,null)):H&&H.isTexture&&(p===void 0&&(p=new Hn(new Lc(2,2),new Ga({name:"BackgroundMaterial",uniforms:Cs(Ci.background.uniforms),vertexShader:Ci.background.vertexShader,fragmentShader:Ci.background.fragmentShader,side:Ha,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),p.geometry.deleteAttribute("normal"),Object.defineProperty(p.material,"map",{get:function(){return this.uniforms.t2D.value}}),l.update(p)),p.material.uniforms.t2D.value=H,p.material.uniforms.backgroundIntensity.value=D.backgroundIntensity,p.material.toneMapped=we.getTransfer(H.colorSpace)!==Ge,H.matrixAutoUpdate===!0&&H.updateMatrix(),p.material.uniforms.uvTransform.value.copy(H.matrix),(g!==H||S!==H.version||M!==s.toneMapping)&&(p.material.needsUpdate=!0,g=H,S=H.version,M=s.toneMapping),p.layers.enableAll(),z.unshift(p,p.geometry,p.material,0,0,null))}function _(z,D){z.getRGB(pc,J_(s)),r.buffers.color.setClear(pc.r,pc.g,pc.b,D,d)}function I(){v!==void 0&&(v.geometry.dispose(),v.material.dispose(),v=void 0),p!==void 0&&(p.geometry.dispose(),p.material.dispose(),p=void 0)}return{getClearColor:function(){return h},setClearColor:function(z,D=1){h.set(z),m=D,_(h,m)},getClearAlpha:function(){return m},setClearAlpha:function(z){m=z,_(h,m)},render:R,addToRenderList:y,dispose:I}}function QT(s,e){const i=s.getParameter(s.MAX_VERTEX_ATTRIBS),r={},l=S(null);let c=l,d=!1;function h(w,N,J,tt,rt){let ct=!1;const B=g(tt,J,N);c!==B&&(c=B,p(c.object)),ct=M(w,tt,J,rt),ct&&T(w,tt,J,rt),rt!==null&&e.update(rt,s.ELEMENT_ARRAY_BUFFER),(ct||d)&&(d=!1,D(w,N,J,tt),rt!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,e.get(rt).buffer))}function m(){return s.createVertexArray()}function p(w){return s.bindVertexArray(w)}function v(w){return s.deleteVertexArray(w)}function g(w,N,J){const tt=J.wireframe===!0;let rt=r[w.id];rt===void 0&&(rt={},r[w.id]=rt);let ct=rt[N.id];ct===void 0&&(ct={},rt[N.id]=ct);let B=ct[tt];return B===void 0&&(B=S(m()),ct[tt]=B),B}function S(w){const N=[],J=[],tt=[];for(let rt=0;rt<i;rt++)N[rt]=0,J[rt]=0,tt[rt]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:N,enabledAttributes:J,attributeDivisors:tt,object:w,attributes:{},index:null}}function M(w,N,J,tt){const rt=c.attributes,ct=N.attributes;let B=0;const q=J.getAttributes();for(const j in q)if(q[j].location>=0){const St=rt[j];let P=ct[j];if(P===void 0&&(j==="instanceMatrix"&&w.instanceMatrix&&(P=w.instanceMatrix),j==="instanceColor"&&w.instanceColor&&(P=w.instanceColor)),St===void 0||St.attribute!==P||P&&St.data!==P.data)return!0;B++}return c.attributesNum!==B||c.index!==tt}function T(w,N,J,tt){const rt={},ct=N.attributes;let B=0;const q=J.getAttributes();for(const j in q)if(q[j].location>=0){let St=ct[j];St===void 0&&(j==="instanceMatrix"&&w.instanceMatrix&&(St=w.instanceMatrix),j==="instanceColor"&&w.instanceColor&&(St=w.instanceColor));const P={};P.attribute=St,St&&St.data&&(P.data=St.data),rt[j]=P,B++}c.attributes=rt,c.attributesNum=B,c.index=tt}function R(){const w=c.newAttributes;for(let N=0,J=w.length;N<J;N++)w[N]=0}function y(w){_(w,0)}function _(w,N){const J=c.newAttributes,tt=c.enabledAttributes,rt=c.attributeDivisors;J[w]=1,tt[w]===0&&(s.enableVertexAttribArray(w),tt[w]=1),rt[w]!==N&&(s.vertexAttribDivisor(w,N),rt[w]=N)}function I(){const w=c.newAttributes,N=c.enabledAttributes;for(let J=0,tt=N.length;J<tt;J++)N[J]!==w[J]&&(s.disableVertexAttribArray(J),N[J]=0)}function z(w,N,J,tt,rt,ct,B){B===!0?s.vertexAttribIPointer(w,N,J,rt,ct):s.vertexAttribPointer(w,N,J,tt,rt,ct)}function D(w,N,J,tt){R();const rt=tt.attributes,ct=J.getAttributes(),B=N.defaultAttributeValues;for(const q in ct){const j=ct[q];if(j.location>=0){let yt=rt[q];if(yt===void 0&&(q==="instanceMatrix"&&w.instanceMatrix&&(yt=w.instanceMatrix),q==="instanceColor"&&w.instanceColor&&(yt=w.instanceColor)),yt!==void 0){const St=yt.normalized,P=yt.itemSize,et=e.get(yt);if(et===void 0)continue;const X=et.buffer,pt=et.type,Y=et.bytesPerElement,mt=pt===s.INT||pt===s.UNSIGNED_INT||yt.gpuType===gh;if(yt.isInterleavedBufferAttribute){const ft=yt.data,Ut=ft.stride,Dt=yt.offset;if(ft.isInstancedInterleavedBuffer){for(let $t=0;$t<j.locationSize;$t++)_(j.location+$t,ft.meshPerAttribute);w.isInstancedMesh!==!0&&tt._maxInstanceCount===void 0&&(tt._maxInstanceCount=ft.meshPerAttribute*ft.count)}else for(let $t=0;$t<j.locationSize;$t++)y(j.location+$t);s.bindBuffer(s.ARRAY_BUFFER,X);for(let $t=0;$t<j.locationSize;$t++)z(j.location+$t,P/j.locationSize,pt,St,Ut*Y,(Dt+P/j.locationSize*$t)*Y,mt)}else{if(yt.isInstancedBufferAttribute){for(let ft=0;ft<j.locationSize;ft++)_(j.location+ft,yt.meshPerAttribute);w.isInstancedMesh!==!0&&tt._maxInstanceCount===void 0&&(tt._maxInstanceCount=yt.meshPerAttribute*yt.count)}else for(let ft=0;ft<j.locationSize;ft++)y(j.location+ft);s.bindBuffer(s.ARRAY_BUFFER,X);for(let ft=0;ft<j.locationSize;ft++)z(j.location+ft,P/j.locationSize,pt,St,P*Y,P/j.locationSize*ft*Y,mt)}}else if(B!==void 0){const St=B[q];if(St!==void 0)switch(St.length){case 2:s.vertexAttrib2fv(j.location,St);break;case 3:s.vertexAttrib3fv(j.location,St);break;case 4:s.vertexAttrib4fv(j.location,St);break;default:s.vertexAttrib1fv(j.location,St)}}}}I()}function H(){V();for(const w in r){const N=r[w];for(const J in N){const tt=N[J];for(const rt in tt)v(tt[rt].object),delete tt[rt];delete N[J]}delete r[w]}}function L(w){if(r[w.id]===void 0)return;const N=r[w.id];for(const J in N){const tt=N[J];for(const rt in tt)v(tt[rt].object),delete tt[rt];delete N[J]}delete r[w.id]}function U(w){for(const N in r){const J=r[N];if(J[w.id]===void 0)continue;const tt=J[w.id];for(const rt in tt)v(tt[rt].object),delete tt[rt];delete J[w.id]}}function V(){A(),d=!0,c!==l&&(c=l,p(c.object))}function A(){l.geometry=null,l.program=null,l.wireframe=!1}return{setup:h,reset:V,resetDefaultState:A,dispose:H,releaseStatesOfGeometry:L,releaseStatesOfProgram:U,initAttributes:R,enableAttribute:y,disableUnusedAttributes:I}}function JT(s,e,i){let r;function l(p){r=p}function c(p,v){s.drawArrays(r,p,v),i.update(v,r,1)}function d(p,v,g){g!==0&&(s.drawArraysInstanced(r,p,v,g),i.update(v,r,g))}function h(p,v,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(r,p,0,v,0,g);let M=0;for(let T=0;T<g;T++)M+=v[T];i.update(M,r,1)}function m(p,v,g,S){if(g===0)return;const M=e.get("WEBGL_multi_draw");if(M===null)for(let T=0;T<p.length;T++)d(p[T],v[T],S[T]);else{M.multiDrawArraysInstancedWEBGL(r,p,0,v,0,S,0,g);let T=0;for(let R=0;R<g;R++)T+=v[R]*S[R];i.update(T,r,1)}}this.setMode=l,this.render=c,this.renderInstances=d,this.renderMultiDraw=h,this.renderMultiDrawInstances=m}function $T(s,e,i,r){let l;function c(){if(l!==void 0)return l;if(e.has("EXT_texture_filter_anisotropic")===!0){const U=e.get("EXT_texture_filter_anisotropic");l=s.getParameter(U.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else l=0;return l}function d(U){return!(U!==xi&&r.convert(U)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function h(U){const V=U===Po&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(U!==Li&&r.convert(U)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&U!==ra&&!V)}function m(U){if(U==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";U="mediump"}return U==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let p=i.precision!==void 0?i.precision:"highp";const v=m(p);v!==p&&(console.warn("THREE.WebGLRenderer:",p,"not supported, using",v,"instead."),p=v);const g=i.logarithmicDepthBuffer===!0,S=i.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),M=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),T=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),R=s.getParameter(s.MAX_TEXTURE_SIZE),y=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),_=s.getParameter(s.MAX_VERTEX_ATTRIBS),I=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),z=s.getParameter(s.MAX_VARYING_VECTORS),D=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),H=T>0,L=s.getParameter(s.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:c,getMaxPrecision:m,textureFormatReadable:d,textureTypeReadable:h,precision:p,logarithmicDepthBuffer:g,reversedDepthBuffer:S,maxTextures:M,maxVertexTextures:T,maxTextureSize:R,maxCubemapSize:y,maxAttributes:_,maxVertexUniforms:I,maxVaryings:z,maxFragmentUniforms:D,vertexTextures:H,maxSamples:L}}function t1(s){const e=this;let i=null,r=0,l=!1,c=!1;const d=new hr,h=new oe,m={value:null,needsUpdate:!1};this.uniform=m,this.numPlanes=0,this.numIntersection=0,this.init=function(g,S){const M=g.length!==0||S||r!==0||l;return l=S,r=g.length,M},this.beginShadows=function(){c=!0,v(null)},this.endShadows=function(){c=!1},this.setGlobalState=function(g,S){i=v(g,S,0)},this.setState=function(g,S,M){const T=g.clippingPlanes,R=g.clipIntersection,y=g.clipShadows,_=s.get(g);if(!l||T===null||T.length===0||c&&!y)c?v(null):p();else{const I=c?0:r,z=I*4;let D=_.clippingState||null;m.value=D,D=v(T,S,z,M);for(let H=0;H!==z;++H)D[H]=i[H];_.clippingState=D,this.numIntersection=R?this.numPlanes:0,this.numPlanes+=I}};function p(){m.value!==i&&(m.value=i,m.needsUpdate=r>0),e.numPlanes=r,e.numIntersection=0}function v(g,S,M,T){const R=g!==null?g.length:0;let y=null;if(R!==0){if(y=m.value,T!==!0||y===null){const _=M+R*4,I=S.matrixWorldInverse;h.getNormalMatrix(I),(y===null||y.length<_)&&(y=new Float32Array(_));for(let z=0,D=M;z!==R;++z,D+=4)d.copy(g[z]).applyMatrix4(I,h),d.normal.toArray(y,D),y[D+3]=d.constant}m.value=y,m.needsUpdate=!0}return e.numPlanes=R,e.numIntersection=0,y}}function e1(s){let e=new WeakMap;function i(d,h){return h===Od?d.mapping=bs:h===zd&&(d.mapping=As),d}function r(d){if(d&&d.isTexture){const h=d.mapping;if(h===Od||h===zd)if(e.has(d)){const m=e.get(d).texture;return i(m,d.mapping)}else{const m=d.image;if(m&&m.height>0){const p=new eM(m.height);return p.fromEquirectangularTexture(s,d),e.set(d,p),d.addEventListener("dispose",l),i(p.texture,d.mapping)}else return null}}return d}function l(d){const h=d.target;h.removeEventListener("dispose",l);const m=e.get(h);m!==void 0&&(e.delete(h),m.dispose())}function c(){e=new WeakMap}return{get:r,dispose:c}}const Ss=4,J0=[.125,.215,.35,.446,.526,.582],gr=20,gd=new iv,$0=new be;let _d=null,vd=0,xd=0,Sd=!1;const pr=(1+Math.sqrt(5))/2,vs=1/pr,t_=[new $(-pr,vs,0),new $(pr,vs,0),new $(-vs,0,pr),new $(vs,0,pr),new $(0,pr,-vs),new $(0,pr,vs),new $(-1,1,-1),new $(1,1,-1),new $(-1,1,1),new $(1,1,1)],n1=new $;class e_{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,i=0,r=.1,l=100,c={}){const{size:d=256,position:h=n1}=c;_d=this._renderer.getRenderTarget(),vd=this._renderer.getActiveCubeFace(),xd=this._renderer.getActiveMipmapLevel(),Sd=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(d);const m=this._allocateTargets();return m.depthBuffer=!0,this._sceneToCubeUV(e,r,l,m,h),i>0&&this._blur(m,0,0,i),this._applyPMREM(m),this._cleanup(m),m}fromEquirectangular(e,i=null){return this._fromTexture(e,i)}fromCubemap(e,i=null){return this._fromTexture(e,i)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=a_(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=i_(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(_d,vd,xd),this._renderer.xr.enabled=Sd,e.scissorTest=!1,mc(e,0,0,e.width,e.height)}_fromTexture(e,i){e.mapping===bs||e.mapping===As?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),_d=this._renderer.getRenderTarget(),vd=this._renderer.getActiveCubeFace(),xd=this._renderer.getActiveMipmapLevel(),Sd=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const r=i||this._allocateTargets();return this._textureToCubeUV(e,r),this._applyPMREM(r),this._cleanup(r),r}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),i=4*this._cubeSize,r={magFilter:wi,minFilter:wi,generateMipmaps:!1,type:Po,format:xi,colorSpace:Rs,depthBuffer:!1},l=n_(e,i,r);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==i){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=n_(e,i,r);const{_lodMax:c}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=i1(c)),this._blurMaterial=a1(c,e,i)}return l}_compileMaterial(e){const i=new Hn(this._lodPlanes[0],e);this._renderer.compile(i,gd)}_sceneToCubeUV(e,i,r,l,c){const m=new fi(90,1,i,r),p=[1,-1,1,1,1,1],v=[1,1,1,-1,-1,-1],g=this._renderer,S=g.autoClear,M=g.toneMapping;g.getClearColor($0),g.toneMapping=Ia,g.autoClear=!1,g.state.buffers.depth.getReversed()&&(g.setRenderTarget(l),g.clearDepth(),g.setRenderTarget(null));const R=new j_({name:"PMREM.Background",side:Gn,depthWrite:!1,depthTest:!1}),y=new Hn(new Io,R);let _=!1;const I=e.background;I?I.isColor&&(R.color.copy(I),e.background=null,_=!0):(R.color.copy($0),_=!0);for(let z=0;z<6;z++){const D=z%3;D===0?(m.up.set(0,p[z],0),m.position.set(c.x,c.y,c.z),m.lookAt(c.x+v[z],c.y,c.z)):D===1?(m.up.set(0,0,p[z]),m.position.set(c.x,c.y,c.z),m.lookAt(c.x,c.y+v[z],c.z)):(m.up.set(0,p[z],0),m.position.set(c.x,c.y,c.z),m.lookAt(c.x,c.y,c.z+v[z]));const H=this._cubeSize;mc(l,D*H,z>2?H:0,H,H),g.setRenderTarget(l),_&&g.render(y,m),g.render(e,m)}y.geometry.dispose(),y.material.dispose(),g.toneMapping=M,g.autoClear=S,e.background=I}_textureToCubeUV(e,i){const r=this._renderer,l=e.mapping===bs||e.mapping===As;l?(this._cubemapMaterial===null&&(this._cubemapMaterial=a_()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=i_());const c=l?this._cubemapMaterial:this._equirectMaterial,d=new Hn(this._lodPlanes[0],c),h=c.uniforms;h.envMap.value=e;const m=this._cubeSize;mc(i,0,0,3*m,2*m),r.setRenderTarget(i),r.render(d,gd)}_applyPMREM(e){const i=this._renderer,r=i.autoClear;i.autoClear=!1;const l=this._lodPlanes.length;for(let c=1;c<l;c++){const d=Math.sqrt(this._sigmas[c]*this._sigmas[c]-this._sigmas[c-1]*this._sigmas[c-1]),h=t_[(l-c-1)%t_.length];this._blur(e,c-1,c,d,h)}i.autoClear=r}_blur(e,i,r,l,c){const d=this._pingPongRenderTarget;this._halfBlur(e,d,i,r,l,"latitudinal",c),this._halfBlur(d,e,r,r,l,"longitudinal",c)}_halfBlur(e,i,r,l,c,d,h){const m=this._renderer,p=this._blurMaterial;d!=="latitudinal"&&d!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const v=3,g=new Hn(this._lodPlanes[l],p),S=p.uniforms,M=this._sizeLods[r]-1,T=isFinite(c)?Math.PI/(2*M):2*Math.PI/(2*gr-1),R=c/T,y=isFinite(c)?1+Math.floor(v*R):gr;y>gr&&console.warn(`sigmaRadians, ${c}, is too large and will clip, as it requested ${y} samples when the maximum is set to ${gr}`);const _=[];let I=0;for(let U=0;U<gr;++U){const V=U/R,A=Math.exp(-V*V/2);_.push(A),U===0?I+=A:U<y&&(I+=2*A)}for(let U=0;U<_.length;U++)_[U]=_[U]/I;S.envMap.value=e.texture,S.samples.value=y,S.weights.value=_,S.latitudinal.value=d==="latitudinal",h&&(S.poleAxis.value=h);const{_lodMax:z}=this;S.dTheta.value=T,S.mipInt.value=z-r;const D=this._sizeLods[l],H=3*D*(l>z-Ss?l-z+Ss:0),L=4*(this._cubeSize-D);mc(i,H,L,3*D,2*D),m.setRenderTarget(i),m.render(g,gd)}}function i1(s){const e=[],i=[],r=[];let l=s;const c=s-Ss+1+J0.length;for(let d=0;d<c;d++){const h=Math.pow(2,l);i.push(h);let m=1/h;d>s-Ss?m=J0[d-s+Ss-1]:d===0&&(m=0),r.push(m);const p=1/(h-2),v=-p,g=1+p,S=[v,v,g,v,g,g,v,v,g,g,v,g],M=6,T=6,R=3,y=2,_=1,I=new Float32Array(R*T*M),z=new Float32Array(y*T*M),D=new Float32Array(_*T*M);for(let L=0;L<M;L++){const U=L%3*2/3-1,V=L>2?0:-1,A=[U,V,0,U+2/3,V,0,U+2/3,V+1,0,U,V,0,U+2/3,V+1,0,U,V+1,0];I.set(A,R*T*L),z.set(S,y*T*L);const w=[L,L,L,L,L,L];D.set(w,_*T*L)}const H=new yi;H.setAttribute("position",new $n(I,R)),H.setAttribute("uv",new $n(z,y)),H.setAttribute("faceIndex",new $n(D,_)),e.push(H),l>Ss&&l--}return{lodPlanes:e,sizeLods:i,sigmas:r}}function n_(s,e,i){const r=new yr(s,e,i);return r.texture.mapping=Dc,r.texture.name="PMREM.cubeUv",r.scissorTest=!0,r}function mc(s,e,i,r,l){s.viewport.set(e,i,r,l),s.scissor.set(e,i,r,l)}function a1(s,e,i){const r=new Float32Array(gr),l=new $(0,1,0);return new Ga({name:"SphericalGaussianBlur",defines:{n:gr,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/i,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:r},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:l}},vertexShader:Uh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Fa,depthTest:!1,depthWrite:!1})}function i_(){return new Ga({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Uh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Fa,depthTest:!1,depthWrite:!1})}function a_(){return new Ga({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Uh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Fa,depthTest:!1,depthWrite:!1})}function Uh(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function r1(s){let e=new WeakMap,i=null;function r(h){if(h&&h.isTexture){const m=h.mapping,p=m===Od||m===zd,v=m===bs||m===As;if(p||v){let g=e.get(h);const S=g!==void 0?g.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==S)return i===null&&(i=new e_(s)),g=p?i.fromEquirectangular(h,g):i.fromCubemap(h,g),g.texture.pmremVersion=h.pmremVersion,e.set(h,g),g.texture;if(g!==void 0)return g.texture;{const M=h.image;return p&&M&&M.height>0||v&&M&&l(M)?(i===null&&(i=new e_(s)),g=p?i.fromEquirectangular(h):i.fromCubemap(h),g.texture.pmremVersion=h.pmremVersion,e.set(h,g),h.addEventListener("dispose",c),g.texture):null}}}return h}function l(h){let m=0;const p=6;for(let v=0;v<p;v++)h[v]!==void 0&&m++;return m===p}function c(h){const m=h.target;m.removeEventListener("dispose",c);const p=e.get(m);p!==void 0&&(e.delete(m),p.dispose())}function d(){e=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:d}}function s1(s){const e={};function i(r){if(e[r]!==void 0)return e[r];let l;switch(r){case"WEBGL_depth_texture":l=s.getExtension("WEBGL_depth_texture")||s.getExtension("MOZ_WEBGL_depth_texture")||s.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":l=s.getExtension("EXT_texture_filter_anisotropic")||s.getExtension("MOZ_EXT_texture_filter_anisotropic")||s.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":l=s.getExtension("WEBGL_compressed_texture_s3tc")||s.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":l=s.getExtension("WEBGL_compressed_texture_pvrtc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:l=s.getExtension(r)}return e[r]=l,l}return{has:function(r){return i(r)!==null},init:function(){i("EXT_color_buffer_float"),i("WEBGL_clip_cull_distance"),i("OES_texture_float_linear"),i("EXT_color_buffer_half_float"),i("WEBGL_multisampled_render_to_texture"),i("WEBGL_render_shared_exponent")},get:function(r){const l=i(r);return l===null&&Ms("THREE.WebGLRenderer: "+r+" extension not supported."),l}}}function o1(s,e,i,r){const l={},c=new WeakMap;function d(g){const S=g.target;S.index!==null&&e.remove(S.index);for(const T in S.attributes)e.remove(S.attributes[T]);S.removeEventListener("dispose",d),delete l[S.id];const M=c.get(S);M&&(e.remove(M),c.delete(S)),r.releaseStatesOfGeometry(S),S.isInstancedBufferGeometry===!0&&delete S._maxInstanceCount,i.memory.geometries--}function h(g,S){return l[S.id]===!0||(S.addEventListener("dispose",d),l[S.id]=!0,i.memory.geometries++),S}function m(g){const S=g.attributes;for(const M in S)e.update(S[M],s.ARRAY_BUFFER)}function p(g){const S=[],M=g.index,T=g.attributes.position;let R=0;if(M!==null){const I=M.array;R=M.version;for(let z=0,D=I.length;z<D;z+=3){const H=I[z+0],L=I[z+1],U=I[z+2];S.push(H,L,L,U,U,H)}}else if(T!==void 0){const I=T.array;R=T.version;for(let z=0,D=I.length/3-1;z<D;z+=3){const H=z+0,L=z+1,U=z+2;S.push(H,L,L,U,U,H)}}else return;const y=new(W_(S)?Q_:K_)(S,1);y.version=R;const _=c.get(g);_&&e.remove(_),c.set(g,y)}function v(g){const S=c.get(g);if(S){const M=g.index;M!==null&&S.version<M.version&&p(g)}else p(g);return c.get(g)}return{get:h,update:m,getWireframeAttribute:v}}function l1(s,e,i){let r;function l(S){r=S}let c,d;function h(S){c=S.type,d=S.bytesPerElement}function m(S,M){s.drawElements(r,M,c,S*d),i.update(M,r,1)}function p(S,M,T){T!==0&&(s.drawElementsInstanced(r,M,c,S*d,T),i.update(M,r,T))}function v(S,M,T){if(T===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(r,M,0,c,S,0,T);let y=0;for(let _=0;_<T;_++)y+=M[_];i.update(y,r,1)}function g(S,M,T,R){if(T===0)return;const y=e.get("WEBGL_multi_draw");if(y===null)for(let _=0;_<S.length;_++)p(S[_]/d,M[_],R[_]);else{y.multiDrawElementsInstancedWEBGL(r,M,0,c,S,0,R,0,T);let _=0;for(let I=0;I<T;I++)_+=M[I]*R[I];i.update(_,r,1)}}this.setMode=l,this.setIndex=h,this.render=m,this.renderInstances=p,this.renderMultiDraw=v,this.renderMultiDrawInstances=g}function c1(s){const e={geometries:0,textures:0},i={frame:0,calls:0,triangles:0,points:0,lines:0};function r(c,d,h){switch(i.calls++,d){case s.TRIANGLES:i.triangles+=h*(c/3);break;case s.LINES:i.lines+=h*(c/2);break;case s.LINE_STRIP:i.lines+=h*(c-1);break;case s.LINE_LOOP:i.lines+=h*c;break;case s.POINTS:i.points+=h*c;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",d);break}}function l(){i.calls=0,i.triangles=0,i.points=0,i.lines=0}return{memory:e,render:i,programs:null,autoReset:!0,reset:l,update:r}}function u1(s,e,i){const r=new WeakMap,l=new Je;function c(d,h,m){const p=d.morphTargetInfluences,v=h.morphAttributes.position||h.morphAttributes.normal||h.morphAttributes.color,g=v!==void 0?v.length:0;let S=r.get(h);if(S===void 0||S.count!==g){let w=function(){V.dispose(),r.delete(h),h.removeEventListener("dispose",w)};var M=w;S!==void 0&&S.texture.dispose();const T=h.morphAttributes.position!==void 0,R=h.morphAttributes.normal!==void 0,y=h.morphAttributes.color!==void 0,_=h.morphAttributes.position||[],I=h.morphAttributes.normal||[],z=h.morphAttributes.color||[];let D=0;T===!0&&(D=1),R===!0&&(D=2),y===!0&&(D=3);let H=h.attributes.position.count*D,L=1;H>e.maxTextureSize&&(L=Math.ceil(H/e.maxTextureSize),H=e.maxTextureSize);const U=new Float32Array(H*L*4*g),V=new q_(U,H,L,g);V.type=ra,V.needsUpdate=!0;const A=D*4;for(let N=0;N<g;N++){const J=_[N],tt=I[N],rt=z[N],ct=H*L*4*N;for(let B=0;B<J.count;B++){const q=B*A;T===!0&&(l.fromBufferAttribute(J,B),U[ct+q+0]=l.x,U[ct+q+1]=l.y,U[ct+q+2]=l.z,U[ct+q+3]=0),R===!0&&(l.fromBufferAttribute(tt,B),U[ct+q+4]=l.x,U[ct+q+5]=l.y,U[ct+q+6]=l.z,U[ct+q+7]=0),y===!0&&(l.fromBufferAttribute(rt,B),U[ct+q+8]=l.x,U[ct+q+9]=l.y,U[ct+q+10]=l.z,U[ct+q+11]=rt.itemSize===4?l.w:1)}}S={count:g,texture:V,size:new Ae(H,L)},r.set(h,S),h.addEventListener("dispose",w)}if(d.isInstancedMesh===!0&&d.morphTexture!==null)m.getUniforms().setValue(s,"morphTexture",d.morphTexture,i);else{let T=0;for(let y=0;y<p.length;y++)T+=p[y];const R=h.morphTargetsRelative?1:1-T;m.getUniforms().setValue(s,"morphTargetBaseInfluence",R),m.getUniforms().setValue(s,"morphTargetInfluences",p)}m.getUniforms().setValue(s,"morphTargetsTexture",S.texture,i),m.getUniforms().setValue(s,"morphTargetsTextureSize",S.size)}return{update:c}}function f1(s,e,i,r){let l=new WeakMap;function c(m){const p=r.render.frame,v=m.geometry,g=e.get(m,v);if(l.get(g)!==p&&(e.update(g),l.set(g,p)),m.isInstancedMesh&&(m.hasEventListener("dispose",h)===!1&&m.addEventListener("dispose",h),l.get(m)!==p&&(i.update(m.instanceMatrix,s.ARRAY_BUFFER),m.instanceColor!==null&&i.update(m.instanceColor,s.ARRAY_BUFFER),l.set(m,p))),m.isSkinnedMesh){const S=m.skeleton;l.get(S)!==p&&(S.update(),l.set(S,p))}return g}function d(){l=new WeakMap}function h(m){const p=m.target;p.removeEventListener("dispose",h),i.remove(p.instanceMatrix),p.instanceColor!==null&&i.remove(p.instanceColor)}return{update:c,dispose:d}}const rv=new Vn,r_=new ev(1,1),sv=new q_,ov=new Fy,lv=new tv,s_=[],o_=[],l_=new Float32Array(16),c_=new Float32Array(9),u_=new Float32Array(4);function Us(s,e,i){const r=s[0];if(r<=0||r>0)return s;const l=e*i;let c=s_[l];if(c===void 0&&(c=new Float32Array(l),s_[l]=c),e!==0){r.toArray(c,0);for(let d=1,h=0;d!==e;++d)h+=i,s[d].toArray(c,h)}return c}function dn(s,e){if(s.length!==e.length)return!1;for(let i=0,r=s.length;i<r;i++)if(s[i]!==e[i])return!1;return!0}function hn(s,e){for(let i=0,r=e.length;i<r;i++)s[i]=e[i]}function Nc(s,e){let i=o_[e];i===void 0&&(i=new Int32Array(e),o_[e]=i);for(let r=0;r!==e;++r)i[r]=s.allocateTextureUnit();return i}function d1(s,e){const i=this.cache;i[0]!==e&&(s.uniform1f(this.addr,e),i[0]=e)}function h1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y)&&(s.uniform2f(this.addr,e.x,e.y),i[0]=e.x,i[1]=e.y);else{if(dn(i,e))return;s.uniform2fv(this.addr,e),hn(i,e)}}function p1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y||i[2]!==e.z)&&(s.uniform3f(this.addr,e.x,e.y,e.z),i[0]=e.x,i[1]=e.y,i[2]=e.z);else if(e.r!==void 0)(i[0]!==e.r||i[1]!==e.g||i[2]!==e.b)&&(s.uniform3f(this.addr,e.r,e.g,e.b),i[0]=e.r,i[1]=e.g,i[2]=e.b);else{if(dn(i,e))return;s.uniform3fv(this.addr,e),hn(i,e)}}function m1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y||i[2]!==e.z||i[3]!==e.w)&&(s.uniform4f(this.addr,e.x,e.y,e.z,e.w),i[0]=e.x,i[1]=e.y,i[2]=e.z,i[3]=e.w);else{if(dn(i,e))return;s.uniform4fv(this.addr,e),hn(i,e)}}function g1(s,e){const i=this.cache,r=e.elements;if(r===void 0){if(dn(i,e))return;s.uniformMatrix2fv(this.addr,!1,e),hn(i,e)}else{if(dn(i,r))return;u_.set(r),s.uniformMatrix2fv(this.addr,!1,u_),hn(i,r)}}function _1(s,e){const i=this.cache,r=e.elements;if(r===void 0){if(dn(i,e))return;s.uniformMatrix3fv(this.addr,!1,e),hn(i,e)}else{if(dn(i,r))return;c_.set(r),s.uniformMatrix3fv(this.addr,!1,c_),hn(i,r)}}function v1(s,e){const i=this.cache,r=e.elements;if(r===void 0){if(dn(i,e))return;s.uniformMatrix4fv(this.addr,!1,e),hn(i,e)}else{if(dn(i,r))return;l_.set(r),s.uniformMatrix4fv(this.addr,!1,l_),hn(i,r)}}function x1(s,e){const i=this.cache;i[0]!==e&&(s.uniform1i(this.addr,e),i[0]=e)}function S1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y)&&(s.uniform2i(this.addr,e.x,e.y),i[0]=e.x,i[1]=e.y);else{if(dn(i,e))return;s.uniform2iv(this.addr,e),hn(i,e)}}function y1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y||i[2]!==e.z)&&(s.uniform3i(this.addr,e.x,e.y,e.z),i[0]=e.x,i[1]=e.y,i[2]=e.z);else{if(dn(i,e))return;s.uniform3iv(this.addr,e),hn(i,e)}}function M1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y||i[2]!==e.z||i[3]!==e.w)&&(s.uniform4i(this.addr,e.x,e.y,e.z,e.w),i[0]=e.x,i[1]=e.y,i[2]=e.z,i[3]=e.w);else{if(dn(i,e))return;s.uniform4iv(this.addr,e),hn(i,e)}}function E1(s,e){const i=this.cache;i[0]!==e&&(s.uniform1ui(this.addr,e),i[0]=e)}function T1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y)&&(s.uniform2ui(this.addr,e.x,e.y),i[0]=e.x,i[1]=e.y);else{if(dn(i,e))return;s.uniform2uiv(this.addr,e),hn(i,e)}}function b1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y||i[2]!==e.z)&&(s.uniform3ui(this.addr,e.x,e.y,e.z),i[0]=e.x,i[1]=e.y,i[2]=e.z);else{if(dn(i,e))return;s.uniform3uiv(this.addr,e),hn(i,e)}}function A1(s,e){const i=this.cache;if(e.x!==void 0)(i[0]!==e.x||i[1]!==e.y||i[2]!==e.z||i[3]!==e.w)&&(s.uniform4ui(this.addr,e.x,e.y,e.z,e.w),i[0]=e.x,i[1]=e.y,i[2]=e.z,i[3]=e.w);else{if(dn(i,e))return;s.uniform4uiv(this.addr,e),hn(i,e)}}function R1(s,e,i){const r=this.cache,l=i.allocateTextureUnit();r[0]!==l&&(s.uniform1i(this.addr,l),r[0]=l);let c;this.type===s.SAMPLER_2D_SHADOW?(r_.compareFunction=X_,c=r_):c=rv,i.setTexture2D(e||c,l)}function C1(s,e,i){const r=this.cache,l=i.allocateTextureUnit();r[0]!==l&&(s.uniform1i(this.addr,l),r[0]=l),i.setTexture3D(e||ov,l)}function w1(s,e,i){const r=this.cache,l=i.allocateTextureUnit();r[0]!==l&&(s.uniform1i(this.addr,l),r[0]=l),i.setTextureCube(e||lv,l)}function D1(s,e,i){const r=this.cache,l=i.allocateTextureUnit();r[0]!==l&&(s.uniform1i(this.addr,l),r[0]=l),i.setTexture2DArray(e||sv,l)}function U1(s){switch(s){case 5126:return d1;case 35664:return h1;case 35665:return p1;case 35666:return m1;case 35674:return g1;case 35675:return _1;case 35676:return v1;case 5124:case 35670:return x1;case 35667:case 35671:return S1;case 35668:case 35672:return y1;case 35669:case 35673:return M1;case 5125:return E1;case 36294:return T1;case 36295:return b1;case 36296:return A1;case 35678:case 36198:case 36298:case 36306:case 35682:return R1;case 35679:case 36299:case 36307:return C1;case 35680:case 36300:case 36308:case 36293:return w1;case 36289:case 36303:case 36311:case 36292:return D1}}function L1(s,e){s.uniform1fv(this.addr,e)}function N1(s,e){const i=Us(e,this.size,2);s.uniform2fv(this.addr,i)}function O1(s,e){const i=Us(e,this.size,3);s.uniform3fv(this.addr,i)}function z1(s,e){const i=Us(e,this.size,4);s.uniform4fv(this.addr,i)}function P1(s,e){const i=Us(e,this.size,4);s.uniformMatrix2fv(this.addr,!1,i)}function B1(s,e){const i=Us(e,this.size,9);s.uniformMatrix3fv(this.addr,!1,i)}function F1(s,e){const i=Us(e,this.size,16);s.uniformMatrix4fv(this.addr,!1,i)}function I1(s,e){s.uniform1iv(this.addr,e)}function H1(s,e){s.uniform2iv(this.addr,e)}function G1(s,e){s.uniform3iv(this.addr,e)}function V1(s,e){s.uniform4iv(this.addr,e)}function k1(s,e){s.uniform1uiv(this.addr,e)}function X1(s,e){s.uniform2uiv(this.addr,e)}function W1(s,e){s.uniform3uiv(this.addr,e)}function q1(s,e){s.uniform4uiv(this.addr,e)}function Y1(s,e,i){const r=this.cache,l=e.length,c=Nc(i,l);dn(r,c)||(s.uniform1iv(this.addr,c),hn(r,c));for(let d=0;d!==l;++d)i.setTexture2D(e[d]||rv,c[d])}function Z1(s,e,i){const r=this.cache,l=e.length,c=Nc(i,l);dn(r,c)||(s.uniform1iv(this.addr,c),hn(r,c));for(let d=0;d!==l;++d)i.setTexture3D(e[d]||ov,c[d])}function j1(s,e,i){const r=this.cache,l=e.length,c=Nc(i,l);dn(r,c)||(s.uniform1iv(this.addr,c),hn(r,c));for(let d=0;d!==l;++d)i.setTextureCube(e[d]||lv,c[d])}function K1(s,e,i){const r=this.cache,l=e.length,c=Nc(i,l);dn(r,c)||(s.uniform1iv(this.addr,c),hn(r,c));for(let d=0;d!==l;++d)i.setTexture2DArray(e[d]||sv,c[d])}function Q1(s){switch(s){case 5126:return L1;case 35664:return N1;case 35665:return O1;case 35666:return z1;case 35674:return P1;case 35675:return B1;case 35676:return F1;case 5124:case 35670:return I1;case 35667:case 35671:return H1;case 35668:case 35672:return G1;case 35669:case 35673:return V1;case 5125:return k1;case 36294:return X1;case 36295:return W1;case 36296:return q1;case 35678:case 36198:case 36298:case 36306:case 35682:return Y1;case 35679:case 36299:case 36307:return Z1;case 35680:case 36300:case 36308:case 36293:return j1;case 36289:case 36303:case 36311:case 36292:return K1}}class J1{constructor(e,i,r){this.id=e,this.addr=r,this.cache=[],this.type=i.type,this.setValue=U1(i.type)}}class $1{constructor(e,i,r){this.id=e,this.addr=r,this.cache=[],this.type=i.type,this.size=i.size,this.setValue=Q1(i.type)}}class tb{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,i,r){const l=this.seq;for(let c=0,d=l.length;c!==d;++c){const h=l[c];h.setValue(e,i[h.id],r)}}}const yd=/(\w+)(\])?(\[|\.)?/g;function f_(s,e){s.seq.push(e),s.map[e.id]=e}function eb(s,e,i){const r=s.name,l=r.length;for(yd.lastIndex=0;;){const c=yd.exec(r),d=yd.lastIndex;let h=c[1];const m=c[2]==="]",p=c[3];if(m&&(h=h|0),p===void 0||p==="["&&d+2===l){f_(i,p===void 0?new J1(h,s,e):new $1(h,s,e));break}else{let g=i.map[h];g===void 0&&(g=new tb(h),f_(i,g)),i=g}}}class bc{constructor(e,i){this.seq=[],this.map={};const r=e.getProgramParameter(i,e.ACTIVE_UNIFORMS);for(let l=0;l<r;++l){const c=e.getActiveUniform(i,l),d=e.getUniformLocation(i,c.name);eb(c,d,this)}}setValue(e,i,r,l){const c=this.map[i];c!==void 0&&c.setValue(e,r,l)}setOptional(e,i,r){const l=i[r];l!==void 0&&this.setValue(e,r,l)}static upload(e,i,r,l){for(let c=0,d=i.length;c!==d;++c){const h=i[c],m=r[h.id];m.needsUpdate!==!1&&h.setValue(e,m.value,l)}}static seqWithValue(e,i){const r=[];for(let l=0,c=e.length;l!==c;++l){const d=e[l];d.id in i&&r.push(d)}return r}}function d_(s,e,i){const r=s.createShader(e);return s.shaderSource(r,i),s.compileShader(r),r}const nb=37297;let ib=0;function ab(s,e){const i=s.split(`
`),r=[],l=Math.max(e-6,0),c=Math.min(e+6,i.length);for(let d=l;d<c;d++){const h=d+1;r.push(`${h===e?">":" "} ${h}: ${i[d]}`)}return r.join(`
`)}const h_=new oe;function rb(s){we._getMatrix(h_,we.workingColorSpace,s);const e=`mat3( ${h_.elements.map(i=>i.toFixed(4))} )`;switch(we.getTransfer(s)){case Rc:return[e,"LinearTransferOETF"];case Ge:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",s),[e,"LinearTransferOETF"]}}function p_(s,e,i){const r=s.getShaderParameter(e,s.COMPILE_STATUS),c=(s.getShaderInfoLog(e)||"").trim();if(r&&c==="")return"";const d=/ERROR: 0:(\d+)/.exec(c);if(d){const h=parseInt(d[1]);return i.toUpperCase()+`

`+c+`

`+ab(s.getShaderSource(e),h)}else return c}function sb(s,e){const i=rb(e);return[`vec4 ${s}( vec4 value ) {`,`	return ${i[1]}( vec4( value.rgb * ${i[0]}, value.a ) );`,"}"].join(`
`)}function ob(s,e){let i;switch(e){case QS:i="Linear";break;case JS:i="Reinhard";break;case $S:i="Cineon";break;case ty:i="ACESFilmic";break;case ny:i="AgX";break;case iy:i="Neutral";break;case ey:i="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),i="Linear"}return"vec3 "+s+"( vec3 color ) { return "+i+"ToneMapping( color ); }"}const gc=new $;function lb(){we.getLuminanceCoefficients(gc);const s=gc.x.toFixed(4),e=gc.y.toFixed(4),i=gc.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${e}, ${i} );`,"	return dot( weights, rgb );","}"].join(`
`)}function cb(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Co).join(`
`)}function ub(s){const e=[];for(const i in s){const r=s[i];r!==!1&&e.push("#define "+i+" "+r)}return e.join(`
`)}function fb(s,e){const i={},r=s.getProgramParameter(e,s.ACTIVE_ATTRIBUTES);for(let l=0;l<r;l++){const c=s.getActiveAttrib(e,l),d=c.name;let h=1;c.type===s.FLOAT_MAT2&&(h=2),c.type===s.FLOAT_MAT3&&(h=3),c.type===s.FLOAT_MAT4&&(h=4),i[d]={type:c.type,location:s.getAttribLocation(e,d),locationSize:h}}return i}function Co(s){return s!==""}function m_(s,e){const i=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,i).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function g_(s,e){return s.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const db=/^[ \t]*#include +<([\w\d./]+)>/gm;function fh(s){return s.replace(db,pb)}const hb=new Map;function pb(s,e){let i=ce[e];if(i===void 0){const r=hb.get(e);if(r!==void 0)i=ce[r],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,r);else throw new Error("Can not resolve #include <"+e+">")}return fh(i)}const mb=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function __(s){return s.replace(mb,gb)}function gb(s,e,i,r){let l="";for(let c=parseInt(e);c<parseInt(i);c++)l+=r.replace(/\[\s*i\s*\]/g,"[ "+c+" ]").replace(/UNROLLED_LOOP_INDEX/g,c);return l}function v_(s){let e=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?e+=`
#define HIGH_PRECISION`:s.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function _b(s){let e="SHADOWMAP_TYPE_BASIC";return s.shadowMapType===N_?e="SHADOWMAP_TYPE_PCF":s.shadowMapType===DS?e="SHADOWMAP_TYPE_PCF_SOFT":s.shadowMapType===ia&&(e="SHADOWMAP_TYPE_VSM"),e}function vb(s){let e="ENVMAP_TYPE_CUBE";if(s.envMap)switch(s.envMapMode){case bs:case As:e="ENVMAP_TYPE_CUBE";break;case Dc:e="ENVMAP_TYPE_CUBE_UV";break}return e}function xb(s){let e="ENVMAP_MODE_REFLECTION";return s.envMap&&s.envMapMode===As&&(e="ENVMAP_MODE_REFRACTION"),e}function Sb(s){let e="ENVMAP_BLENDING_NONE";if(s.envMap)switch(s.combine){case mh:e="ENVMAP_BLENDING_MULTIPLY";break;case jS:e="ENVMAP_BLENDING_MIX";break;case KS:e="ENVMAP_BLENDING_ADD";break}return e}function yb(s){const e=s.envMapCubeUVHeight;if(e===null)return null;const i=Math.log2(e)-2,r=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,i),112)),texelHeight:r,maxMip:i}}function Mb(s,e,i,r){const l=s.getContext(),c=i.defines;let d=i.vertexShader,h=i.fragmentShader;const m=_b(i),p=vb(i),v=xb(i),g=Sb(i),S=yb(i),M=cb(i),T=ub(c),R=l.createProgram();let y,_,I=i.glslVersion?"#version "+i.glslVersion+`
`:"";i.isRawShaderMaterial?(y=["#define SHADER_TYPE "+i.shaderType,"#define SHADER_NAME "+i.shaderName,T].filter(Co).join(`
`),y.length>0&&(y+=`
`),_=["#define SHADER_TYPE "+i.shaderType,"#define SHADER_NAME "+i.shaderName,T].filter(Co).join(`
`),_.length>0&&(_+=`
`)):(y=[v_(i),"#define SHADER_TYPE "+i.shaderType,"#define SHADER_NAME "+i.shaderName,T,i.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",i.batching?"#define USE_BATCHING":"",i.batchingColor?"#define USE_BATCHING_COLOR":"",i.instancing?"#define USE_INSTANCING":"",i.instancingColor?"#define USE_INSTANCING_COLOR":"",i.instancingMorph?"#define USE_INSTANCING_MORPH":"",i.useFog&&i.fog?"#define USE_FOG":"",i.useFog&&i.fogExp2?"#define FOG_EXP2":"",i.map?"#define USE_MAP":"",i.envMap?"#define USE_ENVMAP":"",i.envMap?"#define "+v:"",i.lightMap?"#define USE_LIGHTMAP":"",i.aoMap?"#define USE_AOMAP":"",i.bumpMap?"#define USE_BUMPMAP":"",i.normalMap?"#define USE_NORMALMAP":"",i.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",i.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",i.displacementMap?"#define USE_DISPLACEMENTMAP":"",i.emissiveMap?"#define USE_EMISSIVEMAP":"",i.anisotropy?"#define USE_ANISOTROPY":"",i.anisotropyMap?"#define USE_ANISOTROPYMAP":"",i.clearcoatMap?"#define USE_CLEARCOATMAP":"",i.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",i.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",i.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",i.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",i.specularMap?"#define USE_SPECULARMAP":"",i.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",i.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",i.roughnessMap?"#define USE_ROUGHNESSMAP":"",i.metalnessMap?"#define USE_METALNESSMAP":"",i.alphaMap?"#define USE_ALPHAMAP":"",i.alphaHash?"#define USE_ALPHAHASH":"",i.transmission?"#define USE_TRANSMISSION":"",i.transmissionMap?"#define USE_TRANSMISSIONMAP":"",i.thicknessMap?"#define USE_THICKNESSMAP":"",i.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",i.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",i.mapUv?"#define MAP_UV "+i.mapUv:"",i.alphaMapUv?"#define ALPHAMAP_UV "+i.alphaMapUv:"",i.lightMapUv?"#define LIGHTMAP_UV "+i.lightMapUv:"",i.aoMapUv?"#define AOMAP_UV "+i.aoMapUv:"",i.emissiveMapUv?"#define EMISSIVEMAP_UV "+i.emissiveMapUv:"",i.bumpMapUv?"#define BUMPMAP_UV "+i.bumpMapUv:"",i.normalMapUv?"#define NORMALMAP_UV "+i.normalMapUv:"",i.displacementMapUv?"#define DISPLACEMENTMAP_UV "+i.displacementMapUv:"",i.metalnessMapUv?"#define METALNESSMAP_UV "+i.metalnessMapUv:"",i.roughnessMapUv?"#define ROUGHNESSMAP_UV "+i.roughnessMapUv:"",i.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+i.anisotropyMapUv:"",i.clearcoatMapUv?"#define CLEARCOATMAP_UV "+i.clearcoatMapUv:"",i.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+i.clearcoatNormalMapUv:"",i.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+i.clearcoatRoughnessMapUv:"",i.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+i.iridescenceMapUv:"",i.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+i.iridescenceThicknessMapUv:"",i.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+i.sheenColorMapUv:"",i.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+i.sheenRoughnessMapUv:"",i.specularMapUv?"#define SPECULARMAP_UV "+i.specularMapUv:"",i.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+i.specularColorMapUv:"",i.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+i.specularIntensityMapUv:"",i.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+i.transmissionMapUv:"",i.thicknessMapUv?"#define THICKNESSMAP_UV "+i.thicknessMapUv:"",i.vertexTangents&&i.flatShading===!1?"#define USE_TANGENT":"",i.vertexColors?"#define USE_COLOR":"",i.vertexAlphas?"#define USE_COLOR_ALPHA":"",i.vertexUv1s?"#define USE_UV1":"",i.vertexUv2s?"#define USE_UV2":"",i.vertexUv3s?"#define USE_UV3":"",i.pointsUvs?"#define USE_POINTS_UV":"",i.flatShading?"#define FLAT_SHADED":"",i.skinning?"#define USE_SKINNING":"",i.morphTargets?"#define USE_MORPHTARGETS":"",i.morphNormals&&i.flatShading===!1?"#define USE_MORPHNORMALS":"",i.morphColors?"#define USE_MORPHCOLORS":"",i.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+i.morphTextureStride:"",i.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+i.morphTargetsCount:"",i.doubleSided?"#define DOUBLE_SIDED":"",i.flipSided?"#define FLIP_SIDED":"",i.shadowMapEnabled?"#define USE_SHADOWMAP":"",i.shadowMapEnabled?"#define "+m:"",i.sizeAttenuation?"#define USE_SIZEATTENUATION":"",i.numLightProbes>0?"#define USE_LIGHT_PROBES":"",i.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",i.reversedDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Co).join(`
`),_=[v_(i),"#define SHADER_TYPE "+i.shaderType,"#define SHADER_NAME "+i.shaderName,T,i.useFog&&i.fog?"#define USE_FOG":"",i.useFog&&i.fogExp2?"#define FOG_EXP2":"",i.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",i.map?"#define USE_MAP":"",i.matcap?"#define USE_MATCAP":"",i.envMap?"#define USE_ENVMAP":"",i.envMap?"#define "+p:"",i.envMap?"#define "+v:"",i.envMap?"#define "+g:"",S?"#define CUBEUV_TEXEL_WIDTH "+S.texelWidth:"",S?"#define CUBEUV_TEXEL_HEIGHT "+S.texelHeight:"",S?"#define CUBEUV_MAX_MIP "+S.maxMip+".0":"",i.lightMap?"#define USE_LIGHTMAP":"",i.aoMap?"#define USE_AOMAP":"",i.bumpMap?"#define USE_BUMPMAP":"",i.normalMap?"#define USE_NORMALMAP":"",i.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",i.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",i.emissiveMap?"#define USE_EMISSIVEMAP":"",i.anisotropy?"#define USE_ANISOTROPY":"",i.anisotropyMap?"#define USE_ANISOTROPYMAP":"",i.clearcoat?"#define USE_CLEARCOAT":"",i.clearcoatMap?"#define USE_CLEARCOATMAP":"",i.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",i.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",i.dispersion?"#define USE_DISPERSION":"",i.iridescence?"#define USE_IRIDESCENCE":"",i.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",i.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",i.specularMap?"#define USE_SPECULARMAP":"",i.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",i.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",i.roughnessMap?"#define USE_ROUGHNESSMAP":"",i.metalnessMap?"#define USE_METALNESSMAP":"",i.alphaMap?"#define USE_ALPHAMAP":"",i.alphaTest?"#define USE_ALPHATEST":"",i.alphaHash?"#define USE_ALPHAHASH":"",i.sheen?"#define USE_SHEEN":"",i.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",i.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",i.transmission?"#define USE_TRANSMISSION":"",i.transmissionMap?"#define USE_TRANSMISSIONMAP":"",i.thicknessMap?"#define USE_THICKNESSMAP":"",i.vertexTangents&&i.flatShading===!1?"#define USE_TANGENT":"",i.vertexColors||i.instancingColor||i.batchingColor?"#define USE_COLOR":"",i.vertexAlphas?"#define USE_COLOR_ALPHA":"",i.vertexUv1s?"#define USE_UV1":"",i.vertexUv2s?"#define USE_UV2":"",i.vertexUv3s?"#define USE_UV3":"",i.pointsUvs?"#define USE_POINTS_UV":"",i.gradientMap?"#define USE_GRADIENTMAP":"",i.flatShading?"#define FLAT_SHADED":"",i.doubleSided?"#define DOUBLE_SIDED":"",i.flipSided?"#define FLIP_SIDED":"",i.shadowMapEnabled?"#define USE_SHADOWMAP":"",i.shadowMapEnabled?"#define "+m:"",i.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",i.numLightProbes>0?"#define USE_LIGHT_PROBES":"",i.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",i.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",i.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",i.reversedDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",i.toneMapping!==Ia?"#define TONE_MAPPING":"",i.toneMapping!==Ia?ce.tonemapping_pars_fragment:"",i.toneMapping!==Ia?ob("toneMapping",i.toneMapping):"",i.dithering?"#define DITHERING":"",i.opaque?"#define OPAQUE":"",ce.colorspace_pars_fragment,sb("linearToOutputTexel",i.outputColorSpace),lb(),i.useDepthPacking?"#define DEPTH_PACKING "+i.depthPacking:"",`
`].filter(Co).join(`
`)),d=fh(d),d=m_(d,i),d=g_(d,i),h=fh(h),h=m_(h,i),h=g_(h,i),d=__(d),h=__(h),i.isRawShaderMaterial!==!0&&(I=`#version 300 es
`,y=[M,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+y,_=["#define varying in",i.glslVersion===R0?"":"layout(location = 0) out highp vec4 pc_fragColor;",i.glslVersion===R0?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+_);const z=I+y+d,D=I+_+h,H=d_(l,l.VERTEX_SHADER,z),L=d_(l,l.FRAGMENT_SHADER,D);l.attachShader(R,H),l.attachShader(R,L),i.index0AttributeName!==void 0?l.bindAttribLocation(R,0,i.index0AttributeName):i.morphTargets===!0&&l.bindAttribLocation(R,0,"position"),l.linkProgram(R);function U(N){if(s.debug.checkShaderErrors){const J=l.getProgramInfoLog(R)||"",tt=l.getShaderInfoLog(H)||"",rt=l.getShaderInfoLog(L)||"",ct=J.trim(),B=tt.trim(),q=rt.trim();let j=!0,yt=!0;if(l.getProgramParameter(R,l.LINK_STATUS)===!1)if(j=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(l,R,H,L);else{const St=p_(l,H,"vertex"),P=p_(l,L,"fragment");console.error("THREE.WebGLProgram: Shader Error "+l.getError()+" - VALIDATE_STATUS "+l.getProgramParameter(R,l.VALIDATE_STATUS)+`

Material Name: `+N.name+`
Material Type: `+N.type+`

Program Info Log: `+ct+`
`+St+`
`+P)}else ct!==""?console.warn("THREE.WebGLProgram: Program Info Log:",ct):(B===""||q==="")&&(yt=!1);yt&&(N.diagnostics={runnable:j,programLog:ct,vertexShader:{log:B,prefix:y},fragmentShader:{log:q,prefix:_}})}l.deleteShader(H),l.deleteShader(L),V=new bc(l,R),A=fb(l,R)}let V;this.getUniforms=function(){return V===void 0&&U(this),V};let A;this.getAttributes=function(){return A===void 0&&U(this),A};let w=i.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return w===!1&&(w=l.getProgramParameter(R,nb)),w},this.destroy=function(){r.releaseStatesOfProgram(this),l.deleteProgram(R),this.program=void 0},this.type=i.shaderType,this.name=i.shaderName,this.id=ib++,this.cacheKey=e,this.usedTimes=1,this.program=R,this.vertexShader=H,this.fragmentShader=L,this}let Eb=0;class Tb{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const i=e.vertexShader,r=e.fragmentShader,l=this._getShaderStage(i),c=this._getShaderStage(r),d=this._getShaderCacheForMaterial(e);return d.has(l)===!1&&(d.add(l),l.usedTimes++),d.has(c)===!1&&(d.add(c),c.usedTimes++),this}remove(e){const i=this.materialCache.get(e);for(const r of i)r.usedTimes--,r.usedTimes===0&&this.shaderCache.delete(r.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const i=this.materialCache;let r=i.get(e);return r===void 0&&(r=new Set,i.set(e,r)),r}_getShaderStage(e){const i=this.shaderCache;let r=i.get(e);return r===void 0&&(r=new bb(e),i.set(e,r)),r}}class bb{constructor(e){this.id=Eb++,this.code=e,this.usedTimes=0}}function Ab(s,e,i,r,l,c,d){const h=new bh,m=new Tb,p=new Set,v=[],g=l.logarithmicDepthBuffer,S=l.vertexTextures;let M=l.precision;const T={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function R(A){return p.add(A),A===0?"uv":`uv${A}`}function y(A,w,N,J,tt){const rt=J.fog,ct=tt.geometry,B=A.isMeshStandardMaterial?J.environment:null,q=(A.isMeshStandardMaterial?i:e).get(A.envMap||B),j=q&&q.mapping===Dc?q.image.height:null,yt=T[A.type];A.precision!==null&&(M=l.getMaxPrecision(A.precision),M!==A.precision&&console.warn("THREE.WebGLProgram.getParameters:",A.precision,"not supported, using",M,"instead."));const St=ct.morphAttributes.position||ct.morphAttributes.normal||ct.morphAttributes.color,P=St!==void 0?St.length:0;let et=0;ct.morphAttributes.position!==void 0&&(et=1),ct.morphAttributes.normal!==void 0&&(et=2),ct.morphAttributes.color!==void 0&&(et=3);let X,pt,Y,mt;if(yt){const Ee=Ci[yt];X=Ee.vertexShader,pt=Ee.fragmentShader}else X=A.vertexShader,pt=A.fragmentShader,m.update(A),Y=m.getVertexShaderID(A),mt=m.getFragmentShaderID(A);const ft=s.getRenderTarget(),Ut=s.state.buffers.depth.getReversed(),Dt=tt.isInstancedMesh===!0,$t=tt.isBatchedMesh===!0,Be=!!A.map,fe=!!A.matcap,G=!!q,de=!!A.aoMap,Xt=!!A.lightMap,pe=!!A.bumpMap,Wt=!!A.normalMap,Ne=!!A.displacementMap,Bt=!!A.emissiveMap,ne=!!A.metalnessMap,We=!!A.roughnessMap,je=A.anisotropy>0,O=A.clearcoat>0,E=A.dispersion>0,at=A.iridescence>0,gt=A.sheen>0,Et=A.transmission>0,dt=je&&!!A.anisotropyMap,Zt=O&&!!A.clearcoatMap,Rt=O&&!!A.clearcoatNormalMap,qt=O&&!!A.clearcoatRoughnessMap,Yt=at&&!!A.iridescenceMap,bt=at&&!!A.iridescenceThicknessMap,Ct=gt&&!!A.sheenColorMap,jt=gt&&!!A.sheenRoughnessMap,Pt=!!A.specularMap,Lt=!!A.specularColorMap,re=!!A.specularIntensityMap,W=Et&&!!A.transmissionMap,At=Et&&!!A.thicknessMap,wt=!!A.gradientMap,Ft=!!A.alphaMap,Tt=A.alphaTest>0,xt=!!A.alphaHash,It=!!A.extensions;let ie=Ia;A.toneMapped&&(ft===null||ft.isXRRenderTarget===!0)&&(ie=s.toneMapping);const Oe={shaderID:yt,shaderType:A.type,shaderName:A.name,vertexShader:X,fragmentShader:pt,defines:A.defines,customVertexShaderID:Y,customFragmentShaderID:mt,isRawShaderMaterial:A.isRawShaderMaterial===!0,glslVersion:A.glslVersion,precision:M,batching:$t,batchingColor:$t&&tt._colorsTexture!==null,instancing:Dt,instancingColor:Dt&&tt.instanceColor!==null,instancingMorph:Dt&&tt.morphTexture!==null,supportsVertexTextures:S,outputColorSpace:ft===null?s.outputColorSpace:ft.isXRRenderTarget===!0?ft.texture.colorSpace:Rs,alphaToCoverage:!!A.alphaToCoverage,map:Be,matcap:fe,envMap:G,envMapMode:G&&q.mapping,envMapCubeUVHeight:j,aoMap:de,lightMap:Xt,bumpMap:pe,normalMap:Wt,displacementMap:S&&Ne,emissiveMap:Bt,normalMapObjectSpace:Wt&&A.normalMapType===oy,normalMapTangentSpace:Wt&&A.normalMapType===k_,metalnessMap:ne,roughnessMap:We,anisotropy:je,anisotropyMap:dt,clearcoat:O,clearcoatMap:Zt,clearcoatNormalMap:Rt,clearcoatRoughnessMap:qt,dispersion:E,iridescence:at,iridescenceMap:Yt,iridescenceThicknessMap:bt,sheen:gt,sheenColorMap:Ct,sheenRoughnessMap:jt,specularMap:Pt,specularColorMap:Lt,specularIntensityMap:re,transmission:Et,transmissionMap:W,thicknessMap:At,gradientMap:wt,opaque:A.transparent===!1&&A.blending===ys&&A.alphaToCoverage===!1,alphaMap:Ft,alphaTest:Tt,alphaHash:xt,combine:A.combine,mapUv:Be&&R(A.map.channel),aoMapUv:de&&R(A.aoMap.channel),lightMapUv:Xt&&R(A.lightMap.channel),bumpMapUv:pe&&R(A.bumpMap.channel),normalMapUv:Wt&&R(A.normalMap.channel),displacementMapUv:Ne&&R(A.displacementMap.channel),emissiveMapUv:Bt&&R(A.emissiveMap.channel),metalnessMapUv:ne&&R(A.metalnessMap.channel),roughnessMapUv:We&&R(A.roughnessMap.channel),anisotropyMapUv:dt&&R(A.anisotropyMap.channel),clearcoatMapUv:Zt&&R(A.clearcoatMap.channel),clearcoatNormalMapUv:Rt&&R(A.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:qt&&R(A.clearcoatRoughnessMap.channel),iridescenceMapUv:Yt&&R(A.iridescenceMap.channel),iridescenceThicknessMapUv:bt&&R(A.iridescenceThicknessMap.channel),sheenColorMapUv:Ct&&R(A.sheenColorMap.channel),sheenRoughnessMapUv:jt&&R(A.sheenRoughnessMap.channel),specularMapUv:Pt&&R(A.specularMap.channel),specularColorMapUv:Lt&&R(A.specularColorMap.channel),specularIntensityMapUv:re&&R(A.specularIntensityMap.channel),transmissionMapUv:W&&R(A.transmissionMap.channel),thicknessMapUv:At&&R(A.thicknessMap.channel),alphaMapUv:Ft&&R(A.alphaMap.channel),vertexTangents:!!ct.attributes.tangent&&(Wt||je),vertexColors:A.vertexColors,vertexAlphas:A.vertexColors===!0&&!!ct.attributes.color&&ct.attributes.color.itemSize===4,pointsUvs:tt.isPoints===!0&&!!ct.attributes.uv&&(Be||Ft),fog:!!rt,useFog:A.fog===!0,fogExp2:!!rt&&rt.isFogExp2,flatShading:A.flatShading===!0&&A.wireframe===!1,sizeAttenuation:A.sizeAttenuation===!0,logarithmicDepthBuffer:g,reversedDepthBuffer:Ut,skinning:tt.isSkinnedMesh===!0,morphTargets:ct.morphAttributes.position!==void 0,morphNormals:ct.morphAttributes.normal!==void 0,morphColors:ct.morphAttributes.color!==void 0,morphTargetsCount:P,morphTextureStride:et,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numClippingPlanes:d.numPlanes,numClipIntersection:d.numIntersection,dithering:A.dithering,shadowMapEnabled:s.shadowMap.enabled&&N.length>0,shadowMapType:s.shadowMap.type,toneMapping:ie,decodeVideoTexture:Be&&A.map.isVideoTexture===!0&&we.getTransfer(A.map.colorSpace)===Ge,decodeVideoTextureEmissive:Bt&&A.emissiveMap.isVideoTexture===!0&&we.getTransfer(A.emissiveMap.colorSpace)===Ge,premultipliedAlpha:A.premultipliedAlpha,doubleSided:A.side===aa,flipSided:A.side===Gn,useDepthPacking:A.depthPacking>=0,depthPacking:A.depthPacking||0,index0AttributeName:A.index0AttributeName,extensionClipCullDistance:It&&A.extensions.clipCullDistance===!0&&r.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(It&&A.extensions.multiDraw===!0||$t)&&r.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:r.has("KHR_parallel_shader_compile"),customProgramCacheKey:A.customProgramCacheKey()};return Oe.vertexUv1s=p.has(1),Oe.vertexUv2s=p.has(2),Oe.vertexUv3s=p.has(3),p.clear(),Oe}function _(A){const w=[];if(A.shaderID?w.push(A.shaderID):(w.push(A.customVertexShaderID),w.push(A.customFragmentShaderID)),A.defines!==void 0)for(const N in A.defines)w.push(N),w.push(A.defines[N]);return A.isRawShaderMaterial===!1&&(I(w,A),z(w,A),w.push(s.outputColorSpace)),w.push(A.customProgramCacheKey),w.join()}function I(A,w){A.push(w.precision),A.push(w.outputColorSpace),A.push(w.envMapMode),A.push(w.envMapCubeUVHeight),A.push(w.mapUv),A.push(w.alphaMapUv),A.push(w.lightMapUv),A.push(w.aoMapUv),A.push(w.bumpMapUv),A.push(w.normalMapUv),A.push(w.displacementMapUv),A.push(w.emissiveMapUv),A.push(w.metalnessMapUv),A.push(w.roughnessMapUv),A.push(w.anisotropyMapUv),A.push(w.clearcoatMapUv),A.push(w.clearcoatNormalMapUv),A.push(w.clearcoatRoughnessMapUv),A.push(w.iridescenceMapUv),A.push(w.iridescenceThicknessMapUv),A.push(w.sheenColorMapUv),A.push(w.sheenRoughnessMapUv),A.push(w.specularMapUv),A.push(w.specularColorMapUv),A.push(w.specularIntensityMapUv),A.push(w.transmissionMapUv),A.push(w.thicknessMapUv),A.push(w.combine),A.push(w.fogExp2),A.push(w.sizeAttenuation),A.push(w.morphTargetsCount),A.push(w.morphAttributeCount),A.push(w.numDirLights),A.push(w.numPointLights),A.push(w.numSpotLights),A.push(w.numSpotLightMaps),A.push(w.numHemiLights),A.push(w.numRectAreaLights),A.push(w.numDirLightShadows),A.push(w.numPointLightShadows),A.push(w.numSpotLightShadows),A.push(w.numSpotLightShadowsWithMaps),A.push(w.numLightProbes),A.push(w.shadowMapType),A.push(w.toneMapping),A.push(w.numClippingPlanes),A.push(w.numClipIntersection),A.push(w.depthPacking)}function z(A,w){h.disableAll(),w.supportsVertexTextures&&h.enable(0),w.instancing&&h.enable(1),w.instancingColor&&h.enable(2),w.instancingMorph&&h.enable(3),w.matcap&&h.enable(4),w.envMap&&h.enable(5),w.normalMapObjectSpace&&h.enable(6),w.normalMapTangentSpace&&h.enable(7),w.clearcoat&&h.enable(8),w.iridescence&&h.enable(9),w.alphaTest&&h.enable(10),w.vertexColors&&h.enable(11),w.vertexAlphas&&h.enable(12),w.vertexUv1s&&h.enable(13),w.vertexUv2s&&h.enable(14),w.vertexUv3s&&h.enable(15),w.vertexTangents&&h.enable(16),w.anisotropy&&h.enable(17),w.alphaHash&&h.enable(18),w.batching&&h.enable(19),w.dispersion&&h.enable(20),w.batchingColor&&h.enable(21),w.gradientMap&&h.enable(22),A.push(h.mask),h.disableAll(),w.fog&&h.enable(0),w.useFog&&h.enable(1),w.flatShading&&h.enable(2),w.logarithmicDepthBuffer&&h.enable(3),w.reversedDepthBuffer&&h.enable(4),w.skinning&&h.enable(5),w.morphTargets&&h.enable(6),w.morphNormals&&h.enable(7),w.morphColors&&h.enable(8),w.premultipliedAlpha&&h.enable(9),w.shadowMapEnabled&&h.enable(10),w.doubleSided&&h.enable(11),w.flipSided&&h.enable(12),w.useDepthPacking&&h.enable(13),w.dithering&&h.enable(14),w.transmission&&h.enable(15),w.sheen&&h.enable(16),w.opaque&&h.enable(17),w.pointsUvs&&h.enable(18),w.decodeVideoTexture&&h.enable(19),w.decodeVideoTextureEmissive&&h.enable(20),w.alphaToCoverage&&h.enable(21),A.push(h.mask)}function D(A){const w=T[A.type];let N;if(w){const J=Ci[w];N=Qy.clone(J.uniforms)}else N=A.uniforms;return N}function H(A,w){let N;for(let J=0,tt=v.length;J<tt;J++){const rt=v[J];if(rt.cacheKey===w){N=rt,++N.usedTimes;break}}return N===void 0&&(N=new Mb(s,w,A,c),v.push(N)),N}function L(A){if(--A.usedTimes===0){const w=v.indexOf(A);v[w]=v[v.length-1],v.pop(),A.destroy()}}function U(A){m.remove(A)}function V(){m.dispose()}return{getParameters:y,getProgramCacheKey:_,getUniforms:D,acquireProgram:H,releaseProgram:L,releaseShaderCache:U,programs:v,dispose:V}}function Rb(){let s=new WeakMap;function e(d){return s.has(d)}function i(d){let h=s.get(d);return h===void 0&&(h={},s.set(d,h)),h}function r(d){s.delete(d)}function l(d,h,m){s.get(d)[h]=m}function c(){s=new WeakMap}return{has:e,get:i,remove:r,update:l,dispose:c}}function Cb(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.material.id!==e.material.id?s.material.id-e.material.id:s.z!==e.z?s.z-e.z:s.id-e.id}function x_(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.z!==e.z?e.z-s.z:s.id-e.id}function S_(){const s=[];let e=0;const i=[],r=[],l=[];function c(){e=0,i.length=0,r.length=0,l.length=0}function d(g,S,M,T,R,y){let _=s[e];return _===void 0?(_={id:g.id,object:g,geometry:S,material:M,groupOrder:T,renderOrder:g.renderOrder,z:R,group:y},s[e]=_):(_.id=g.id,_.object=g,_.geometry=S,_.material=M,_.groupOrder=T,_.renderOrder=g.renderOrder,_.z=R,_.group=y),e++,_}function h(g,S,M,T,R,y){const _=d(g,S,M,T,R,y);M.transmission>0?r.push(_):M.transparent===!0?l.push(_):i.push(_)}function m(g,S,M,T,R,y){const _=d(g,S,M,T,R,y);M.transmission>0?r.unshift(_):M.transparent===!0?l.unshift(_):i.unshift(_)}function p(g,S){i.length>1&&i.sort(g||Cb),r.length>1&&r.sort(S||x_),l.length>1&&l.sort(S||x_)}function v(){for(let g=e,S=s.length;g<S;g++){const M=s[g];if(M.id===null)break;M.id=null,M.object=null,M.geometry=null,M.material=null,M.group=null}}return{opaque:i,transmissive:r,transparent:l,init:c,push:h,unshift:m,finish:v,sort:p}}function wb(){let s=new WeakMap;function e(r,l){const c=s.get(r);let d;return c===void 0?(d=new S_,s.set(r,[d])):l>=c.length?(d=new S_,c.push(d)):d=c[l],d}function i(){s=new WeakMap}return{get:e,dispose:i}}function Db(){const s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let i;switch(e.type){case"DirectionalLight":i={direction:new $,color:new be};break;case"SpotLight":i={position:new $,direction:new $,color:new be,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":i={position:new $,color:new be,distance:0,decay:0};break;case"HemisphereLight":i={direction:new $,skyColor:new be,groundColor:new be};break;case"RectAreaLight":i={color:new be,position:new $,halfWidth:new $,halfHeight:new $};break}return s[e.id]=i,i}}}function Ub(){const s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let i;switch(e.type){case"DirectionalLight":i={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae};break;case"SpotLight":i={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae};break;case"PointLight":i={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[e.id]=i,i}}}let Lb=0;function Nb(s,e){return(e.castShadow?2:0)-(s.castShadow?2:0)+(e.map?1:0)-(s.map?1:0)}function Ob(s){const e=new Db,i=Ub(),r={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let p=0;p<9;p++)r.probe.push(new $);const l=new $,c=new $e,d=new $e;function h(p){let v=0,g=0,S=0;for(let A=0;A<9;A++)r.probe[A].set(0,0,0);let M=0,T=0,R=0,y=0,_=0,I=0,z=0,D=0,H=0,L=0,U=0;p.sort(Nb);for(let A=0,w=p.length;A<w;A++){const N=p[A],J=N.color,tt=N.intensity,rt=N.distance,ct=N.shadow&&N.shadow.map?N.shadow.map.texture:null;if(N.isAmbientLight)v+=J.r*tt,g+=J.g*tt,S+=J.b*tt;else if(N.isLightProbe){for(let B=0;B<9;B++)r.probe[B].addScaledVector(N.sh.coefficients[B],tt);U++}else if(N.isDirectionalLight){const B=e.get(N);if(B.color.copy(N.color).multiplyScalar(N.intensity),N.castShadow){const q=N.shadow,j=i.get(N);j.shadowIntensity=q.intensity,j.shadowBias=q.bias,j.shadowNormalBias=q.normalBias,j.shadowRadius=q.radius,j.shadowMapSize=q.mapSize,r.directionalShadow[M]=j,r.directionalShadowMap[M]=ct,r.directionalShadowMatrix[M]=N.shadow.matrix,I++}r.directional[M]=B,M++}else if(N.isSpotLight){const B=e.get(N);B.position.setFromMatrixPosition(N.matrixWorld),B.color.copy(J).multiplyScalar(tt),B.distance=rt,B.coneCos=Math.cos(N.angle),B.penumbraCos=Math.cos(N.angle*(1-N.penumbra)),B.decay=N.decay,r.spot[R]=B;const q=N.shadow;if(N.map&&(r.spotLightMap[H]=N.map,H++,q.updateMatrices(N),N.castShadow&&L++),r.spotLightMatrix[R]=q.matrix,N.castShadow){const j=i.get(N);j.shadowIntensity=q.intensity,j.shadowBias=q.bias,j.shadowNormalBias=q.normalBias,j.shadowRadius=q.radius,j.shadowMapSize=q.mapSize,r.spotShadow[R]=j,r.spotShadowMap[R]=ct,D++}R++}else if(N.isRectAreaLight){const B=e.get(N);B.color.copy(J).multiplyScalar(tt),B.halfWidth.set(N.width*.5,0,0),B.halfHeight.set(0,N.height*.5,0),r.rectArea[y]=B,y++}else if(N.isPointLight){const B=e.get(N);if(B.color.copy(N.color).multiplyScalar(N.intensity),B.distance=N.distance,B.decay=N.decay,N.castShadow){const q=N.shadow,j=i.get(N);j.shadowIntensity=q.intensity,j.shadowBias=q.bias,j.shadowNormalBias=q.normalBias,j.shadowRadius=q.radius,j.shadowMapSize=q.mapSize,j.shadowCameraNear=q.camera.near,j.shadowCameraFar=q.camera.far,r.pointShadow[T]=j,r.pointShadowMap[T]=ct,r.pointShadowMatrix[T]=N.shadow.matrix,z++}r.point[T]=B,T++}else if(N.isHemisphereLight){const B=e.get(N);B.skyColor.copy(N.color).multiplyScalar(tt),B.groundColor.copy(N.groundColor).multiplyScalar(tt),r.hemi[_]=B,_++}}y>0&&(s.has("OES_texture_float_linear")===!0?(r.rectAreaLTC1=Ot.LTC_FLOAT_1,r.rectAreaLTC2=Ot.LTC_FLOAT_2):(r.rectAreaLTC1=Ot.LTC_HALF_1,r.rectAreaLTC2=Ot.LTC_HALF_2)),r.ambient[0]=v,r.ambient[1]=g,r.ambient[2]=S;const V=r.hash;(V.directionalLength!==M||V.pointLength!==T||V.spotLength!==R||V.rectAreaLength!==y||V.hemiLength!==_||V.numDirectionalShadows!==I||V.numPointShadows!==z||V.numSpotShadows!==D||V.numSpotMaps!==H||V.numLightProbes!==U)&&(r.directional.length=M,r.spot.length=R,r.rectArea.length=y,r.point.length=T,r.hemi.length=_,r.directionalShadow.length=I,r.directionalShadowMap.length=I,r.pointShadow.length=z,r.pointShadowMap.length=z,r.spotShadow.length=D,r.spotShadowMap.length=D,r.directionalShadowMatrix.length=I,r.pointShadowMatrix.length=z,r.spotLightMatrix.length=D+H-L,r.spotLightMap.length=H,r.numSpotLightShadowsWithMaps=L,r.numLightProbes=U,V.directionalLength=M,V.pointLength=T,V.spotLength=R,V.rectAreaLength=y,V.hemiLength=_,V.numDirectionalShadows=I,V.numPointShadows=z,V.numSpotShadows=D,V.numSpotMaps=H,V.numLightProbes=U,r.version=Lb++)}function m(p,v){let g=0,S=0,M=0,T=0,R=0;const y=v.matrixWorldInverse;for(let _=0,I=p.length;_<I;_++){const z=p[_];if(z.isDirectionalLight){const D=r.directional[g];D.direction.setFromMatrixPosition(z.matrixWorld),l.setFromMatrixPosition(z.target.matrixWorld),D.direction.sub(l),D.direction.transformDirection(y),g++}else if(z.isSpotLight){const D=r.spot[M];D.position.setFromMatrixPosition(z.matrixWorld),D.position.applyMatrix4(y),D.direction.setFromMatrixPosition(z.matrixWorld),l.setFromMatrixPosition(z.target.matrixWorld),D.direction.sub(l),D.direction.transformDirection(y),M++}else if(z.isRectAreaLight){const D=r.rectArea[T];D.position.setFromMatrixPosition(z.matrixWorld),D.position.applyMatrix4(y),d.identity(),c.copy(z.matrixWorld),c.premultiply(y),d.extractRotation(c),D.halfWidth.set(z.width*.5,0,0),D.halfHeight.set(0,z.height*.5,0),D.halfWidth.applyMatrix4(d),D.halfHeight.applyMatrix4(d),T++}else if(z.isPointLight){const D=r.point[S];D.position.setFromMatrixPosition(z.matrixWorld),D.position.applyMatrix4(y),S++}else if(z.isHemisphereLight){const D=r.hemi[R];D.direction.setFromMatrixPosition(z.matrixWorld),D.direction.transformDirection(y),R++}}}return{setup:h,setupView:m,state:r}}function y_(s){const e=new Ob(s),i=[],r=[];function l(v){p.camera=v,i.length=0,r.length=0}function c(v){i.push(v)}function d(v){r.push(v)}function h(){e.setup(i)}function m(v){e.setupView(i,v)}const p={lightsArray:i,shadowsArray:r,camera:null,lights:e,transmissionRenderTarget:{}};return{init:l,state:p,setupLights:h,setupLightsView:m,pushLight:c,pushShadow:d}}function zb(s){let e=new WeakMap;function i(l,c=0){const d=e.get(l);let h;return d===void 0?(h=new y_(s),e.set(l,[h])):c>=d.length?(h=new y_(s),d.push(h)):h=d[c],h}function r(){e=new WeakMap}return{get:i,dispose:r}}const Pb=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Bb=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function Fb(s,e,i){let r=new Ah;const l=new Ae,c=new Ae,d=new Je,h=new oM({depthPacking:sy}),m=new lM,p={},v=i.maxTextureSize,g={[Ha]:Gn,[Gn]:Ha,[aa]:aa},S=new Ga({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ae},radius:{value:4}},vertexShader:Pb,fragmentShader:Bb}),M=S.clone();M.defines.HORIZONTAL_PASS=1;const T=new yi;T.setAttribute("position",new $n(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const R=new Hn(T,S),y=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=N_;let _=this.type;this.render=function(L,U,V){if(y.enabled===!1||y.autoUpdate===!1&&y.needsUpdate===!1||L.length===0)return;const A=s.getRenderTarget(),w=s.getActiveCubeFace(),N=s.getActiveMipmapLevel(),J=s.state;J.setBlending(Fa),J.buffers.depth.getReversed()?J.buffers.color.setClear(0,0,0,0):J.buffers.color.setClear(1,1,1,1),J.buffers.depth.setTest(!0),J.setScissorTest(!1);const tt=_!==ia&&this.type===ia,rt=_===ia&&this.type!==ia;for(let ct=0,B=L.length;ct<B;ct++){const q=L[ct],j=q.shadow;if(j===void 0){console.warn("THREE.WebGLShadowMap:",q,"has no shadow.");continue}if(j.autoUpdate===!1&&j.needsUpdate===!1)continue;l.copy(j.mapSize);const yt=j.getFrameExtents();if(l.multiply(yt),c.copy(j.mapSize),(l.x>v||l.y>v)&&(l.x>v&&(c.x=Math.floor(v/yt.x),l.x=c.x*yt.x,j.mapSize.x=c.x),l.y>v&&(c.y=Math.floor(v/yt.y),l.y=c.y*yt.y,j.mapSize.y=c.y)),j.map===null||tt===!0||rt===!0){const P=this.type!==ia?{minFilter:Si,magFilter:Si}:{};j.map!==null&&j.map.dispose(),j.map=new yr(l.x,l.y,P),j.map.texture.name=q.name+".shadowMap",j.camera.updateProjectionMatrix()}s.setRenderTarget(j.map),s.clear();const St=j.getViewportCount();for(let P=0;P<St;P++){const et=j.getViewport(P);d.set(c.x*et.x,c.y*et.y,c.x*et.z,c.y*et.w),J.viewport(d),j.updateMatrices(q,P),r=j.getFrustum(),D(U,V,j.camera,q,this.type)}j.isPointLightShadow!==!0&&this.type===ia&&I(j,V),j.needsUpdate=!1}_=this.type,y.needsUpdate=!1,s.setRenderTarget(A,w,N)};function I(L,U){const V=e.update(R);S.defines.VSM_SAMPLES!==L.blurSamples&&(S.defines.VSM_SAMPLES=L.blurSamples,M.defines.VSM_SAMPLES=L.blurSamples,S.needsUpdate=!0,M.needsUpdate=!0),L.mapPass===null&&(L.mapPass=new yr(l.x,l.y)),S.uniforms.shadow_pass.value=L.map.texture,S.uniforms.resolution.value=L.mapSize,S.uniforms.radius.value=L.radius,s.setRenderTarget(L.mapPass),s.clear(),s.renderBufferDirect(U,null,V,S,R,null),M.uniforms.shadow_pass.value=L.mapPass.texture,M.uniforms.resolution.value=L.mapSize,M.uniforms.radius.value=L.radius,s.setRenderTarget(L.map),s.clear(),s.renderBufferDirect(U,null,V,M,R,null)}function z(L,U,V,A){let w=null;const N=V.isPointLight===!0?L.customDistanceMaterial:L.customDepthMaterial;if(N!==void 0)w=N;else if(w=V.isPointLight===!0?m:h,s.localClippingEnabled&&U.clipShadows===!0&&Array.isArray(U.clippingPlanes)&&U.clippingPlanes.length!==0||U.displacementMap&&U.displacementScale!==0||U.alphaMap&&U.alphaTest>0||U.map&&U.alphaTest>0||U.alphaToCoverage===!0){const J=w.uuid,tt=U.uuid;let rt=p[J];rt===void 0&&(rt={},p[J]=rt);let ct=rt[tt];ct===void 0&&(ct=w.clone(),rt[tt]=ct,U.addEventListener("dispose",H)),w=ct}if(w.visible=U.visible,w.wireframe=U.wireframe,A===ia?w.side=U.shadowSide!==null?U.shadowSide:U.side:w.side=U.shadowSide!==null?U.shadowSide:g[U.side],w.alphaMap=U.alphaMap,w.alphaTest=U.alphaToCoverage===!0?.5:U.alphaTest,w.map=U.map,w.clipShadows=U.clipShadows,w.clippingPlanes=U.clippingPlanes,w.clipIntersection=U.clipIntersection,w.displacementMap=U.displacementMap,w.displacementScale=U.displacementScale,w.displacementBias=U.displacementBias,w.wireframeLinewidth=U.wireframeLinewidth,w.linewidth=U.linewidth,V.isPointLight===!0&&w.isMeshDistanceMaterial===!0){const J=s.properties.get(w);J.light=V}return w}function D(L,U,V,A,w){if(L.visible===!1)return;if(L.layers.test(U.layers)&&(L.isMesh||L.isLine||L.isPoints)&&(L.castShadow||L.receiveShadow&&w===ia)&&(!L.frustumCulled||r.intersectsObject(L))){L.modelViewMatrix.multiplyMatrices(V.matrixWorldInverse,L.matrixWorld);const tt=e.update(L),rt=L.material;if(Array.isArray(rt)){const ct=tt.groups;for(let B=0,q=ct.length;B<q;B++){const j=ct[B],yt=rt[j.materialIndex];if(yt&&yt.visible){const St=z(L,yt,A,w);L.onBeforeShadow(s,L,U,V,tt,St,j),s.renderBufferDirect(V,null,tt,St,L,j),L.onAfterShadow(s,L,U,V,tt,St,j)}}}else if(rt.visible){const ct=z(L,rt,A,w);L.onBeforeShadow(s,L,U,V,tt,ct,null),s.renderBufferDirect(V,null,tt,ct,L,null),L.onAfterShadow(s,L,U,V,tt,ct,null)}}const J=L.children;for(let tt=0,rt=J.length;tt<rt;tt++)D(J[tt],U,V,A,w)}function H(L){L.target.removeEventListener("dispose",H);for(const V in p){const A=p[V],w=L.target.uuid;w in A&&(A[w].dispose(),delete A[w])}}}const Ib={[Rd]:Cd,[wd]:Ld,[Dd]:Nd,[Ts]:Ud,[Cd]:Rd,[Ld]:wd,[Nd]:Dd,[Ud]:Ts};function Hb(s,e){function i(){let W=!1;const At=new Je;let wt=null;const Ft=new Je(0,0,0,0);return{setMask:function(Tt){wt!==Tt&&!W&&(s.colorMask(Tt,Tt,Tt,Tt),wt=Tt)},setLocked:function(Tt){W=Tt},setClear:function(Tt,xt,It,ie,Oe){Oe===!0&&(Tt*=ie,xt*=ie,It*=ie),At.set(Tt,xt,It,ie),Ft.equals(At)===!1&&(s.clearColor(Tt,xt,It,ie),Ft.copy(At))},reset:function(){W=!1,wt=null,Ft.set(-1,0,0,0)}}}function r(){let W=!1,At=!1,wt=null,Ft=null,Tt=null;return{setReversed:function(xt){if(At!==xt){const It=e.get("EXT_clip_control");xt?It.clipControlEXT(It.LOWER_LEFT_EXT,It.ZERO_TO_ONE_EXT):It.clipControlEXT(It.LOWER_LEFT_EXT,It.NEGATIVE_ONE_TO_ONE_EXT),At=xt;const ie=Tt;Tt=null,this.setClear(ie)}},getReversed:function(){return At},setTest:function(xt){xt?ft(s.DEPTH_TEST):Ut(s.DEPTH_TEST)},setMask:function(xt){wt!==xt&&!W&&(s.depthMask(xt),wt=xt)},setFunc:function(xt){if(At&&(xt=Ib[xt]),Ft!==xt){switch(xt){case Rd:s.depthFunc(s.NEVER);break;case Cd:s.depthFunc(s.ALWAYS);break;case wd:s.depthFunc(s.LESS);break;case Ts:s.depthFunc(s.LEQUAL);break;case Dd:s.depthFunc(s.EQUAL);break;case Ud:s.depthFunc(s.GEQUAL);break;case Ld:s.depthFunc(s.GREATER);break;case Nd:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}Ft=xt}},setLocked:function(xt){W=xt},setClear:function(xt){Tt!==xt&&(At&&(xt=1-xt),s.clearDepth(xt),Tt=xt)},reset:function(){W=!1,wt=null,Ft=null,Tt=null,At=!1}}}function l(){let W=!1,At=null,wt=null,Ft=null,Tt=null,xt=null,It=null,ie=null,Oe=null;return{setTest:function(Ee){W||(Ee?ft(s.STENCIL_TEST):Ut(s.STENCIL_TEST))},setMask:function(Ee){At!==Ee&&!W&&(s.stencilMask(Ee),At=Ee)},setFunc:function(Ee,wn,ti){(wt!==Ee||Ft!==wn||Tt!==ti)&&(s.stencilFunc(Ee,wn,ti),wt=Ee,Ft=wn,Tt=ti)},setOp:function(Ee,wn,ti){(xt!==Ee||It!==wn||ie!==ti)&&(s.stencilOp(Ee,wn,ti),xt=Ee,It=wn,ie=ti)},setLocked:function(Ee){W=Ee},setClear:function(Ee){Oe!==Ee&&(s.clearStencil(Ee),Oe=Ee)},reset:function(){W=!1,At=null,wt=null,Ft=null,Tt=null,xt=null,It=null,ie=null,Oe=null}}}const c=new i,d=new r,h=new l,m=new WeakMap,p=new WeakMap;let v={},g={},S=new WeakMap,M=[],T=null,R=!1,y=null,_=null,I=null,z=null,D=null,H=null,L=null,U=new be(0,0,0),V=0,A=!1,w=null,N=null,J=null,tt=null,rt=null;const ct=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let B=!1,q=0;const j=s.getParameter(s.VERSION);j.indexOf("WebGL")!==-1?(q=parseFloat(/^WebGL (\d)/.exec(j)[1]),B=q>=1):j.indexOf("OpenGL ES")!==-1&&(q=parseFloat(/^OpenGL ES (\d)/.exec(j)[1]),B=q>=2);let yt=null,St={};const P=s.getParameter(s.SCISSOR_BOX),et=s.getParameter(s.VIEWPORT),X=new Je().fromArray(P),pt=new Je().fromArray(et);function Y(W,At,wt,Ft){const Tt=new Uint8Array(4),xt=s.createTexture();s.bindTexture(W,xt),s.texParameteri(W,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(W,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let It=0;It<wt;It++)W===s.TEXTURE_3D||W===s.TEXTURE_2D_ARRAY?s.texImage3D(At,0,s.RGBA,1,1,Ft,0,s.RGBA,s.UNSIGNED_BYTE,Tt):s.texImage2D(At+It,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,Tt);return xt}const mt={};mt[s.TEXTURE_2D]=Y(s.TEXTURE_2D,s.TEXTURE_2D,1),mt[s.TEXTURE_CUBE_MAP]=Y(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),mt[s.TEXTURE_2D_ARRAY]=Y(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),mt[s.TEXTURE_3D]=Y(s.TEXTURE_3D,s.TEXTURE_3D,1,1),c.setClear(0,0,0,1),d.setClear(1),h.setClear(0),ft(s.DEPTH_TEST),d.setFunc(Ts),pe(!1),Wt(y0),ft(s.CULL_FACE),de(Fa);function ft(W){v[W]!==!0&&(s.enable(W),v[W]=!0)}function Ut(W){v[W]!==!1&&(s.disable(W),v[W]=!1)}function Dt(W,At){return g[W]!==At?(s.bindFramebuffer(W,At),g[W]=At,W===s.DRAW_FRAMEBUFFER&&(g[s.FRAMEBUFFER]=At),W===s.FRAMEBUFFER&&(g[s.DRAW_FRAMEBUFFER]=At),!0):!1}function $t(W,At){let wt=M,Ft=!1;if(W){wt=S.get(At),wt===void 0&&(wt=[],S.set(At,wt));const Tt=W.textures;if(wt.length!==Tt.length||wt[0]!==s.COLOR_ATTACHMENT0){for(let xt=0,It=Tt.length;xt<It;xt++)wt[xt]=s.COLOR_ATTACHMENT0+xt;wt.length=Tt.length,Ft=!0}}else wt[0]!==s.BACK&&(wt[0]=s.BACK,Ft=!0);Ft&&s.drawBuffers(wt)}function Be(W){return T!==W?(s.useProgram(W),T=W,!0):!1}const fe={[mr]:s.FUNC_ADD,[LS]:s.FUNC_SUBTRACT,[NS]:s.FUNC_REVERSE_SUBTRACT};fe[OS]=s.MIN,fe[zS]=s.MAX;const G={[PS]:s.ZERO,[BS]:s.ONE,[FS]:s.SRC_COLOR,[bd]:s.SRC_ALPHA,[XS]:s.SRC_ALPHA_SATURATE,[VS]:s.DST_COLOR,[HS]:s.DST_ALPHA,[IS]:s.ONE_MINUS_SRC_COLOR,[Ad]:s.ONE_MINUS_SRC_ALPHA,[kS]:s.ONE_MINUS_DST_COLOR,[GS]:s.ONE_MINUS_DST_ALPHA,[WS]:s.CONSTANT_COLOR,[qS]:s.ONE_MINUS_CONSTANT_COLOR,[YS]:s.CONSTANT_ALPHA,[ZS]:s.ONE_MINUS_CONSTANT_ALPHA};function de(W,At,wt,Ft,Tt,xt,It,ie,Oe,Ee){if(W===Fa){R===!0&&(Ut(s.BLEND),R=!1);return}if(R===!1&&(ft(s.BLEND),R=!0),W!==US){if(W!==y||Ee!==A){if((_!==mr||D!==mr)&&(s.blendEquation(s.FUNC_ADD),_=mr,D=mr),Ee)switch(W){case ys:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case M0:s.blendFunc(s.ONE,s.ONE);break;case E0:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case T0:s.blendFuncSeparate(s.DST_COLOR,s.ONE_MINUS_SRC_ALPHA,s.ZERO,s.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",W);break}else switch(W){case ys:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case M0:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE,s.ONE,s.ONE);break;case E0:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case T0:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",W);break}I=null,z=null,H=null,L=null,U.set(0,0,0),V=0,y=W,A=Ee}return}Tt=Tt||At,xt=xt||wt,It=It||Ft,(At!==_||Tt!==D)&&(s.blendEquationSeparate(fe[At],fe[Tt]),_=At,D=Tt),(wt!==I||Ft!==z||xt!==H||It!==L)&&(s.blendFuncSeparate(G[wt],G[Ft],G[xt],G[It]),I=wt,z=Ft,H=xt,L=It),(ie.equals(U)===!1||Oe!==V)&&(s.blendColor(ie.r,ie.g,ie.b,Oe),U.copy(ie),V=Oe),y=W,A=!1}function Xt(W,At){W.side===aa?Ut(s.CULL_FACE):ft(s.CULL_FACE);let wt=W.side===Gn;At&&(wt=!wt),pe(wt),W.blending===ys&&W.transparent===!1?de(Fa):de(W.blending,W.blendEquation,W.blendSrc,W.blendDst,W.blendEquationAlpha,W.blendSrcAlpha,W.blendDstAlpha,W.blendColor,W.blendAlpha,W.premultipliedAlpha),d.setFunc(W.depthFunc),d.setTest(W.depthTest),d.setMask(W.depthWrite),c.setMask(W.colorWrite);const Ft=W.stencilWrite;h.setTest(Ft),Ft&&(h.setMask(W.stencilWriteMask),h.setFunc(W.stencilFunc,W.stencilRef,W.stencilFuncMask),h.setOp(W.stencilFail,W.stencilZFail,W.stencilZPass)),Bt(W.polygonOffset,W.polygonOffsetFactor,W.polygonOffsetUnits),W.alphaToCoverage===!0?ft(s.SAMPLE_ALPHA_TO_COVERAGE):Ut(s.SAMPLE_ALPHA_TO_COVERAGE)}function pe(W){w!==W&&(W?s.frontFace(s.CW):s.frontFace(s.CCW),w=W)}function Wt(W){W!==CS?(ft(s.CULL_FACE),W!==N&&(W===y0?s.cullFace(s.BACK):W===wS?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):Ut(s.CULL_FACE),N=W}function Ne(W){W!==J&&(B&&s.lineWidth(W),J=W)}function Bt(W,At,wt){W?(ft(s.POLYGON_OFFSET_FILL),(tt!==At||rt!==wt)&&(s.polygonOffset(At,wt),tt=At,rt=wt)):Ut(s.POLYGON_OFFSET_FILL)}function ne(W){W?ft(s.SCISSOR_TEST):Ut(s.SCISSOR_TEST)}function We(W){W===void 0&&(W=s.TEXTURE0+ct-1),yt!==W&&(s.activeTexture(W),yt=W)}function je(W,At,wt){wt===void 0&&(yt===null?wt=s.TEXTURE0+ct-1:wt=yt);let Ft=St[wt];Ft===void 0&&(Ft={type:void 0,texture:void 0},St[wt]=Ft),(Ft.type!==W||Ft.texture!==At)&&(yt!==wt&&(s.activeTexture(wt),yt=wt),s.bindTexture(W,At||mt[W]),Ft.type=W,Ft.texture=At)}function O(){const W=St[yt];W!==void 0&&W.type!==void 0&&(s.bindTexture(W.type,null),W.type=void 0,W.texture=void 0)}function E(){try{s.compressedTexImage2D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function at(){try{s.compressedTexImage3D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function gt(){try{s.texSubImage2D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Et(){try{s.texSubImage3D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function dt(){try{s.compressedTexSubImage2D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Zt(){try{s.compressedTexSubImage3D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Rt(){try{s.texStorage2D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function qt(){try{s.texStorage3D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Yt(){try{s.texImage2D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function bt(){try{s.texImage3D(...arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Ct(W){X.equals(W)===!1&&(s.scissor(W.x,W.y,W.z,W.w),X.copy(W))}function jt(W){pt.equals(W)===!1&&(s.viewport(W.x,W.y,W.z,W.w),pt.copy(W))}function Pt(W,At){let wt=p.get(At);wt===void 0&&(wt=new WeakMap,p.set(At,wt));let Ft=wt.get(W);Ft===void 0&&(Ft=s.getUniformBlockIndex(At,W.name),wt.set(W,Ft))}function Lt(W,At){const Ft=p.get(At).get(W);m.get(At)!==Ft&&(s.uniformBlockBinding(At,Ft,W.__bindingPointIndex),m.set(At,Ft))}function re(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),d.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),v={},yt=null,St={},g={},S=new WeakMap,M=[],T=null,R=!1,y=null,_=null,I=null,z=null,D=null,H=null,L=null,U=new be(0,0,0),V=0,A=!1,w=null,N=null,J=null,tt=null,rt=null,X.set(0,0,s.canvas.width,s.canvas.height),pt.set(0,0,s.canvas.width,s.canvas.height),c.reset(),d.reset(),h.reset()}return{buffers:{color:c,depth:d,stencil:h},enable:ft,disable:Ut,bindFramebuffer:Dt,drawBuffers:$t,useProgram:Be,setBlending:de,setMaterial:Xt,setFlipSided:pe,setCullFace:Wt,setLineWidth:Ne,setPolygonOffset:Bt,setScissorTest:ne,activeTexture:We,bindTexture:je,unbindTexture:O,compressedTexImage2D:E,compressedTexImage3D:at,texImage2D:Yt,texImage3D:bt,updateUBOMapping:Pt,uniformBlockBinding:Lt,texStorage2D:Rt,texStorage3D:qt,texSubImage2D:gt,texSubImage3D:Et,compressedTexSubImage2D:dt,compressedTexSubImage3D:Zt,scissor:Ct,viewport:jt,reset:re}}function Gb(s,e,i,r,l,c,d){const h=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,m=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),p=new Ae,v=new WeakMap;let g;const S=new WeakMap;let M=!1;try{M=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function T(O,E){return M?new OffscreenCanvas(O,E):wc("canvas")}function R(O,E,at){let gt=1;const Et=je(O);if((Et.width>at||Et.height>at)&&(gt=at/Math.max(Et.width,Et.height)),gt<1)if(typeof HTMLImageElement<"u"&&O instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&O instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&O instanceof ImageBitmap||typeof VideoFrame<"u"&&O instanceof VideoFrame){const dt=Math.floor(gt*Et.width),Zt=Math.floor(gt*Et.height);g===void 0&&(g=T(dt,Zt));const Rt=E?T(dt,Zt):g;return Rt.width=dt,Rt.height=Zt,Rt.getContext("2d").drawImage(O,0,0,dt,Zt),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Et.width+"x"+Et.height+") to ("+dt+"x"+Zt+")."),Rt}else return"data"in O&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Et.width+"x"+Et.height+")."),O;return O}function y(O){return O.generateMipmaps}function _(O){s.generateMipmap(O)}function I(O){return O.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:O.isWebGL3DRenderTarget?s.TEXTURE_3D:O.isWebGLArrayRenderTarget||O.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function z(O,E,at,gt,Et=!1){if(O!==null){if(s[O]!==void 0)return s[O];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+O+"'")}let dt=E;if(E===s.RED&&(at===s.FLOAT&&(dt=s.R32F),at===s.HALF_FLOAT&&(dt=s.R16F),at===s.UNSIGNED_BYTE&&(dt=s.R8)),E===s.RED_INTEGER&&(at===s.UNSIGNED_BYTE&&(dt=s.R8UI),at===s.UNSIGNED_SHORT&&(dt=s.R16UI),at===s.UNSIGNED_INT&&(dt=s.R32UI),at===s.BYTE&&(dt=s.R8I),at===s.SHORT&&(dt=s.R16I),at===s.INT&&(dt=s.R32I)),E===s.RG&&(at===s.FLOAT&&(dt=s.RG32F),at===s.HALF_FLOAT&&(dt=s.RG16F),at===s.UNSIGNED_BYTE&&(dt=s.RG8)),E===s.RG_INTEGER&&(at===s.UNSIGNED_BYTE&&(dt=s.RG8UI),at===s.UNSIGNED_SHORT&&(dt=s.RG16UI),at===s.UNSIGNED_INT&&(dt=s.RG32UI),at===s.BYTE&&(dt=s.RG8I),at===s.SHORT&&(dt=s.RG16I),at===s.INT&&(dt=s.RG32I)),E===s.RGB_INTEGER&&(at===s.UNSIGNED_BYTE&&(dt=s.RGB8UI),at===s.UNSIGNED_SHORT&&(dt=s.RGB16UI),at===s.UNSIGNED_INT&&(dt=s.RGB32UI),at===s.BYTE&&(dt=s.RGB8I),at===s.SHORT&&(dt=s.RGB16I),at===s.INT&&(dt=s.RGB32I)),E===s.RGBA_INTEGER&&(at===s.UNSIGNED_BYTE&&(dt=s.RGBA8UI),at===s.UNSIGNED_SHORT&&(dt=s.RGBA16UI),at===s.UNSIGNED_INT&&(dt=s.RGBA32UI),at===s.BYTE&&(dt=s.RGBA8I),at===s.SHORT&&(dt=s.RGBA16I),at===s.INT&&(dt=s.RGBA32I)),E===s.RGB&&at===s.UNSIGNED_INT_5_9_9_9_REV&&(dt=s.RGB9_E5),E===s.RGBA){const Zt=Et?Rc:we.getTransfer(gt);at===s.FLOAT&&(dt=s.RGBA32F),at===s.HALF_FLOAT&&(dt=s.RGBA16F),at===s.UNSIGNED_BYTE&&(dt=Zt===Ge?s.SRGB8_ALPHA8:s.RGBA8),at===s.UNSIGNED_SHORT_4_4_4_4&&(dt=s.RGBA4),at===s.UNSIGNED_SHORT_5_5_5_1&&(dt=s.RGB5_A1)}return(dt===s.R16F||dt===s.R32F||dt===s.RG16F||dt===s.RG32F||dt===s.RGBA16F||dt===s.RGBA32F)&&e.get("EXT_color_buffer_float"),dt}function D(O,E){let at;return O?E===null||E===Sr||E===Lo?at=s.DEPTH24_STENCIL8:E===ra?at=s.DEPTH32F_STENCIL8:E===Uo&&(at=s.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):E===null||E===Sr||E===Lo?at=s.DEPTH_COMPONENT24:E===ra?at=s.DEPTH_COMPONENT32F:E===Uo&&(at=s.DEPTH_COMPONENT16),at}function H(O,E){return y(O)===!0||O.isFramebufferTexture&&O.minFilter!==Si&&O.minFilter!==wi?Math.log2(Math.max(E.width,E.height))+1:O.mipmaps!==void 0&&O.mipmaps.length>0?O.mipmaps.length:O.isCompressedTexture&&Array.isArray(O.image)?E.mipmaps.length:1}function L(O){const E=O.target;E.removeEventListener("dispose",L),V(E),E.isVideoTexture&&v.delete(E)}function U(O){const E=O.target;E.removeEventListener("dispose",U),w(E)}function V(O){const E=r.get(O);if(E.__webglInit===void 0)return;const at=O.source,gt=S.get(at);if(gt){const Et=gt[E.__cacheKey];Et.usedTimes--,Et.usedTimes===0&&A(O),Object.keys(gt).length===0&&S.delete(at)}r.remove(O)}function A(O){const E=r.get(O);s.deleteTexture(E.__webglTexture);const at=O.source,gt=S.get(at);delete gt[E.__cacheKey],d.memory.textures--}function w(O){const E=r.get(O);if(O.depthTexture&&(O.depthTexture.dispose(),r.remove(O.depthTexture)),O.isWebGLCubeRenderTarget)for(let gt=0;gt<6;gt++){if(Array.isArray(E.__webglFramebuffer[gt]))for(let Et=0;Et<E.__webglFramebuffer[gt].length;Et++)s.deleteFramebuffer(E.__webglFramebuffer[gt][Et]);else s.deleteFramebuffer(E.__webglFramebuffer[gt]);E.__webglDepthbuffer&&s.deleteRenderbuffer(E.__webglDepthbuffer[gt])}else{if(Array.isArray(E.__webglFramebuffer))for(let gt=0;gt<E.__webglFramebuffer.length;gt++)s.deleteFramebuffer(E.__webglFramebuffer[gt]);else s.deleteFramebuffer(E.__webglFramebuffer);if(E.__webglDepthbuffer&&s.deleteRenderbuffer(E.__webglDepthbuffer),E.__webglMultisampledFramebuffer&&s.deleteFramebuffer(E.__webglMultisampledFramebuffer),E.__webglColorRenderbuffer)for(let gt=0;gt<E.__webglColorRenderbuffer.length;gt++)E.__webglColorRenderbuffer[gt]&&s.deleteRenderbuffer(E.__webglColorRenderbuffer[gt]);E.__webglDepthRenderbuffer&&s.deleteRenderbuffer(E.__webglDepthRenderbuffer)}const at=O.textures;for(let gt=0,Et=at.length;gt<Et;gt++){const dt=r.get(at[gt]);dt.__webglTexture&&(s.deleteTexture(dt.__webglTexture),d.memory.textures--),r.remove(at[gt])}r.remove(O)}let N=0;function J(){N=0}function tt(){const O=N;return O>=l.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+O+" texture units while this GPU supports only "+l.maxTextures),N+=1,O}function rt(O){const E=[];return E.push(O.wrapS),E.push(O.wrapT),E.push(O.wrapR||0),E.push(O.magFilter),E.push(O.minFilter),E.push(O.anisotropy),E.push(O.internalFormat),E.push(O.format),E.push(O.type),E.push(O.generateMipmaps),E.push(O.premultiplyAlpha),E.push(O.flipY),E.push(O.unpackAlignment),E.push(O.colorSpace),E.join()}function ct(O,E){const at=r.get(O);if(O.isVideoTexture&&ne(O),O.isRenderTargetTexture===!1&&O.isExternalTexture!==!0&&O.version>0&&at.__version!==O.version){const gt=O.image;if(gt===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(gt.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{mt(at,O,E);return}}else O.isExternalTexture&&(at.__webglTexture=O.sourceTexture?O.sourceTexture:null);i.bindTexture(s.TEXTURE_2D,at.__webglTexture,s.TEXTURE0+E)}function B(O,E){const at=r.get(O);if(O.isRenderTargetTexture===!1&&O.version>0&&at.__version!==O.version){mt(at,O,E);return}i.bindTexture(s.TEXTURE_2D_ARRAY,at.__webglTexture,s.TEXTURE0+E)}function q(O,E){const at=r.get(O);if(O.isRenderTargetTexture===!1&&O.version>0&&at.__version!==O.version){mt(at,O,E);return}i.bindTexture(s.TEXTURE_3D,at.__webglTexture,s.TEXTURE0+E)}function j(O,E){const at=r.get(O);if(O.version>0&&at.__version!==O.version){ft(at,O,E);return}i.bindTexture(s.TEXTURE_CUBE_MAP,at.__webglTexture,s.TEXTURE0+E)}const yt={[Pd]:s.REPEAT,[_r]:s.CLAMP_TO_EDGE,[Bd]:s.MIRRORED_REPEAT},St={[Si]:s.NEAREST,[ay]:s.NEAREST_MIPMAP_NEAREST,[Kl]:s.NEAREST_MIPMAP_LINEAR,[wi]:s.LINEAR,[qf]:s.LINEAR_MIPMAP_NEAREST,[vr]:s.LINEAR_MIPMAP_LINEAR},P={[ly]:s.NEVER,[py]:s.ALWAYS,[cy]:s.LESS,[X_]:s.LEQUAL,[uy]:s.EQUAL,[hy]:s.GEQUAL,[fy]:s.GREATER,[dy]:s.NOTEQUAL};function et(O,E){if(E.type===ra&&e.has("OES_texture_float_linear")===!1&&(E.magFilter===wi||E.magFilter===qf||E.magFilter===Kl||E.magFilter===vr||E.minFilter===wi||E.minFilter===qf||E.minFilter===Kl||E.minFilter===vr)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(O,s.TEXTURE_WRAP_S,yt[E.wrapS]),s.texParameteri(O,s.TEXTURE_WRAP_T,yt[E.wrapT]),(O===s.TEXTURE_3D||O===s.TEXTURE_2D_ARRAY)&&s.texParameteri(O,s.TEXTURE_WRAP_R,yt[E.wrapR]),s.texParameteri(O,s.TEXTURE_MAG_FILTER,St[E.magFilter]),s.texParameteri(O,s.TEXTURE_MIN_FILTER,St[E.minFilter]),E.compareFunction&&(s.texParameteri(O,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(O,s.TEXTURE_COMPARE_FUNC,P[E.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(E.magFilter===Si||E.minFilter!==Kl&&E.minFilter!==vr||E.type===ra&&e.has("OES_texture_float_linear")===!1)return;if(E.anisotropy>1||r.get(E).__currentAnisotropy){const at=e.get("EXT_texture_filter_anisotropic");s.texParameterf(O,at.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(E.anisotropy,l.getMaxAnisotropy())),r.get(E).__currentAnisotropy=E.anisotropy}}}function X(O,E){let at=!1;O.__webglInit===void 0&&(O.__webglInit=!0,E.addEventListener("dispose",L));const gt=E.source;let Et=S.get(gt);Et===void 0&&(Et={},S.set(gt,Et));const dt=rt(E);if(dt!==O.__cacheKey){Et[dt]===void 0&&(Et[dt]={texture:s.createTexture(),usedTimes:0},d.memory.textures++,at=!0),Et[dt].usedTimes++;const Zt=Et[O.__cacheKey];Zt!==void 0&&(Et[O.__cacheKey].usedTimes--,Zt.usedTimes===0&&A(E)),O.__cacheKey=dt,O.__webglTexture=Et[dt].texture}return at}function pt(O,E,at){return Math.floor(Math.floor(O/at)/E)}function Y(O,E,at,gt){const dt=O.updateRanges;if(dt.length===0)i.texSubImage2D(s.TEXTURE_2D,0,0,0,E.width,E.height,at,gt,E.data);else{dt.sort((bt,Ct)=>bt.start-Ct.start);let Zt=0;for(let bt=1;bt<dt.length;bt++){const Ct=dt[Zt],jt=dt[bt],Pt=Ct.start+Ct.count,Lt=pt(jt.start,E.width,4),re=pt(Ct.start,E.width,4);jt.start<=Pt+1&&Lt===re&&pt(jt.start+jt.count-1,E.width,4)===Lt?Ct.count=Math.max(Ct.count,jt.start+jt.count-Ct.start):(++Zt,dt[Zt]=jt)}dt.length=Zt+1;const Rt=s.getParameter(s.UNPACK_ROW_LENGTH),qt=s.getParameter(s.UNPACK_SKIP_PIXELS),Yt=s.getParameter(s.UNPACK_SKIP_ROWS);s.pixelStorei(s.UNPACK_ROW_LENGTH,E.width);for(let bt=0,Ct=dt.length;bt<Ct;bt++){const jt=dt[bt],Pt=Math.floor(jt.start/4),Lt=Math.ceil(jt.count/4),re=Pt%E.width,W=Math.floor(Pt/E.width),At=Lt,wt=1;s.pixelStorei(s.UNPACK_SKIP_PIXELS,re),s.pixelStorei(s.UNPACK_SKIP_ROWS,W),i.texSubImage2D(s.TEXTURE_2D,0,re,W,At,wt,at,gt,E.data)}O.clearUpdateRanges(),s.pixelStorei(s.UNPACK_ROW_LENGTH,Rt),s.pixelStorei(s.UNPACK_SKIP_PIXELS,qt),s.pixelStorei(s.UNPACK_SKIP_ROWS,Yt)}}function mt(O,E,at){let gt=s.TEXTURE_2D;(E.isDataArrayTexture||E.isCompressedArrayTexture)&&(gt=s.TEXTURE_2D_ARRAY),E.isData3DTexture&&(gt=s.TEXTURE_3D);const Et=X(O,E),dt=E.source;i.bindTexture(gt,O.__webglTexture,s.TEXTURE0+at);const Zt=r.get(dt);if(dt.version!==Zt.__version||Et===!0){i.activeTexture(s.TEXTURE0+at);const Rt=we.getPrimaries(we.workingColorSpace),qt=E.colorSpace===Ba?null:we.getPrimaries(E.colorSpace),Yt=E.colorSpace===Ba||Rt===qt?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,E.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,E.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,Yt);let bt=R(E.image,!1,l.maxTextureSize);bt=We(E,bt);const Ct=c.convert(E.format,E.colorSpace),jt=c.convert(E.type);let Pt=z(E.internalFormat,Ct,jt,E.colorSpace,E.isVideoTexture);et(gt,E);let Lt;const re=E.mipmaps,W=E.isVideoTexture!==!0,At=Zt.__version===void 0||Et===!0,wt=dt.dataReady,Ft=H(E,bt);if(E.isDepthTexture)Pt=D(E.format===Oo,E.type),At&&(W?i.texStorage2D(s.TEXTURE_2D,1,Pt,bt.width,bt.height):i.texImage2D(s.TEXTURE_2D,0,Pt,bt.width,bt.height,0,Ct,jt,null));else if(E.isDataTexture)if(re.length>0){W&&At&&i.texStorage2D(s.TEXTURE_2D,Ft,Pt,re[0].width,re[0].height);for(let Tt=0,xt=re.length;Tt<xt;Tt++)Lt=re[Tt],W?wt&&i.texSubImage2D(s.TEXTURE_2D,Tt,0,0,Lt.width,Lt.height,Ct,jt,Lt.data):i.texImage2D(s.TEXTURE_2D,Tt,Pt,Lt.width,Lt.height,0,Ct,jt,Lt.data);E.generateMipmaps=!1}else W?(At&&i.texStorage2D(s.TEXTURE_2D,Ft,Pt,bt.width,bt.height),wt&&Y(E,bt,Ct,jt)):i.texImage2D(s.TEXTURE_2D,0,Pt,bt.width,bt.height,0,Ct,jt,bt.data);else if(E.isCompressedTexture)if(E.isCompressedArrayTexture){W&&At&&i.texStorage3D(s.TEXTURE_2D_ARRAY,Ft,Pt,re[0].width,re[0].height,bt.depth);for(let Tt=0,xt=re.length;Tt<xt;Tt++)if(Lt=re[Tt],E.format!==xi)if(Ct!==null)if(W){if(wt)if(E.layerUpdates.size>0){const It=Q0(Lt.width,Lt.height,E.format,E.type);for(const ie of E.layerUpdates){const Oe=Lt.data.subarray(ie*It/Lt.data.BYTES_PER_ELEMENT,(ie+1)*It/Lt.data.BYTES_PER_ELEMENT);i.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,Tt,0,0,ie,Lt.width,Lt.height,1,Ct,Oe)}E.clearLayerUpdates()}else i.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,Tt,0,0,0,Lt.width,Lt.height,bt.depth,Ct,Lt.data)}else i.compressedTexImage3D(s.TEXTURE_2D_ARRAY,Tt,Pt,Lt.width,Lt.height,bt.depth,0,Lt.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else W?wt&&i.texSubImage3D(s.TEXTURE_2D_ARRAY,Tt,0,0,0,Lt.width,Lt.height,bt.depth,Ct,jt,Lt.data):i.texImage3D(s.TEXTURE_2D_ARRAY,Tt,Pt,Lt.width,Lt.height,bt.depth,0,Ct,jt,Lt.data)}else{W&&At&&i.texStorage2D(s.TEXTURE_2D,Ft,Pt,re[0].width,re[0].height);for(let Tt=0,xt=re.length;Tt<xt;Tt++)Lt=re[Tt],E.format!==xi?Ct!==null?W?wt&&i.compressedTexSubImage2D(s.TEXTURE_2D,Tt,0,0,Lt.width,Lt.height,Ct,Lt.data):i.compressedTexImage2D(s.TEXTURE_2D,Tt,Pt,Lt.width,Lt.height,0,Lt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):W?wt&&i.texSubImage2D(s.TEXTURE_2D,Tt,0,0,Lt.width,Lt.height,Ct,jt,Lt.data):i.texImage2D(s.TEXTURE_2D,Tt,Pt,Lt.width,Lt.height,0,Ct,jt,Lt.data)}else if(E.isDataArrayTexture)if(W){if(At&&i.texStorage3D(s.TEXTURE_2D_ARRAY,Ft,Pt,bt.width,bt.height,bt.depth),wt)if(E.layerUpdates.size>0){const Tt=Q0(bt.width,bt.height,E.format,E.type);for(const xt of E.layerUpdates){const It=bt.data.subarray(xt*Tt/bt.data.BYTES_PER_ELEMENT,(xt+1)*Tt/bt.data.BYTES_PER_ELEMENT);i.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,xt,bt.width,bt.height,1,Ct,jt,It)}E.clearLayerUpdates()}else i.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,bt.width,bt.height,bt.depth,Ct,jt,bt.data)}else i.texImage3D(s.TEXTURE_2D_ARRAY,0,Pt,bt.width,bt.height,bt.depth,0,Ct,jt,bt.data);else if(E.isData3DTexture)W?(At&&i.texStorage3D(s.TEXTURE_3D,Ft,Pt,bt.width,bt.height,bt.depth),wt&&i.texSubImage3D(s.TEXTURE_3D,0,0,0,0,bt.width,bt.height,bt.depth,Ct,jt,bt.data)):i.texImage3D(s.TEXTURE_3D,0,Pt,bt.width,bt.height,bt.depth,0,Ct,jt,bt.data);else if(E.isFramebufferTexture){if(At)if(W)i.texStorage2D(s.TEXTURE_2D,Ft,Pt,bt.width,bt.height);else{let Tt=bt.width,xt=bt.height;for(let It=0;It<Ft;It++)i.texImage2D(s.TEXTURE_2D,It,Pt,Tt,xt,0,Ct,jt,null),Tt>>=1,xt>>=1}}else if(re.length>0){if(W&&At){const Tt=je(re[0]);i.texStorage2D(s.TEXTURE_2D,Ft,Pt,Tt.width,Tt.height)}for(let Tt=0,xt=re.length;Tt<xt;Tt++)Lt=re[Tt],W?wt&&i.texSubImage2D(s.TEXTURE_2D,Tt,0,0,Ct,jt,Lt):i.texImage2D(s.TEXTURE_2D,Tt,Pt,Ct,jt,Lt);E.generateMipmaps=!1}else if(W){if(At){const Tt=je(bt);i.texStorage2D(s.TEXTURE_2D,Ft,Pt,Tt.width,Tt.height)}wt&&i.texSubImage2D(s.TEXTURE_2D,0,0,0,Ct,jt,bt)}else i.texImage2D(s.TEXTURE_2D,0,Pt,Ct,jt,bt);y(E)&&_(gt),Zt.__version=dt.version,E.onUpdate&&E.onUpdate(E)}O.__version=E.version}function ft(O,E,at){if(E.image.length!==6)return;const gt=X(O,E),Et=E.source;i.bindTexture(s.TEXTURE_CUBE_MAP,O.__webglTexture,s.TEXTURE0+at);const dt=r.get(Et);if(Et.version!==dt.__version||gt===!0){i.activeTexture(s.TEXTURE0+at);const Zt=we.getPrimaries(we.workingColorSpace),Rt=E.colorSpace===Ba?null:we.getPrimaries(E.colorSpace),qt=E.colorSpace===Ba||Zt===Rt?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,E.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,E.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,qt);const Yt=E.isCompressedTexture||E.image[0].isCompressedTexture,bt=E.image[0]&&E.image[0].isDataTexture,Ct=[];for(let xt=0;xt<6;xt++)!Yt&&!bt?Ct[xt]=R(E.image[xt],!0,l.maxCubemapSize):Ct[xt]=bt?E.image[xt].image:E.image[xt],Ct[xt]=We(E,Ct[xt]);const jt=Ct[0],Pt=c.convert(E.format,E.colorSpace),Lt=c.convert(E.type),re=z(E.internalFormat,Pt,Lt,E.colorSpace),W=E.isVideoTexture!==!0,At=dt.__version===void 0||gt===!0,wt=Et.dataReady;let Ft=H(E,jt);et(s.TEXTURE_CUBE_MAP,E);let Tt;if(Yt){W&&At&&i.texStorage2D(s.TEXTURE_CUBE_MAP,Ft,re,jt.width,jt.height);for(let xt=0;xt<6;xt++){Tt=Ct[xt].mipmaps;for(let It=0;It<Tt.length;It++){const ie=Tt[It];E.format!==xi?Pt!==null?W?wt&&i.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It,0,0,ie.width,ie.height,Pt,ie.data):i.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It,re,ie.width,ie.height,0,ie.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):W?wt&&i.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It,0,0,ie.width,ie.height,Pt,Lt,ie.data):i.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It,re,ie.width,ie.height,0,Pt,Lt,ie.data)}}}else{if(Tt=E.mipmaps,W&&At){Tt.length>0&&Ft++;const xt=je(Ct[0]);i.texStorage2D(s.TEXTURE_CUBE_MAP,Ft,re,xt.width,xt.height)}for(let xt=0;xt<6;xt++)if(bt){W?wt&&i.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,0,0,0,Ct[xt].width,Ct[xt].height,Pt,Lt,Ct[xt].data):i.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,0,re,Ct[xt].width,Ct[xt].height,0,Pt,Lt,Ct[xt].data);for(let It=0;It<Tt.length;It++){const Oe=Tt[It].image[xt].image;W?wt&&i.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It+1,0,0,Oe.width,Oe.height,Pt,Lt,Oe.data):i.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It+1,re,Oe.width,Oe.height,0,Pt,Lt,Oe.data)}}else{W?wt&&i.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,0,0,0,Pt,Lt,Ct[xt]):i.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,0,re,Pt,Lt,Ct[xt]);for(let It=0;It<Tt.length;It++){const ie=Tt[It];W?wt&&i.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It+1,0,0,Pt,Lt,ie.image[xt]):i.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+xt,It+1,re,Pt,Lt,ie.image[xt])}}}y(E)&&_(s.TEXTURE_CUBE_MAP),dt.__version=Et.version,E.onUpdate&&E.onUpdate(E)}O.__version=E.version}function Ut(O,E,at,gt,Et,dt){const Zt=c.convert(at.format,at.colorSpace),Rt=c.convert(at.type),qt=z(at.internalFormat,Zt,Rt,at.colorSpace),Yt=r.get(E),bt=r.get(at);if(bt.__renderTarget=E,!Yt.__hasExternalTextures){const Ct=Math.max(1,E.width>>dt),jt=Math.max(1,E.height>>dt);Et===s.TEXTURE_3D||Et===s.TEXTURE_2D_ARRAY?i.texImage3D(Et,dt,qt,Ct,jt,E.depth,0,Zt,Rt,null):i.texImage2D(Et,dt,qt,Ct,jt,0,Zt,Rt,null)}i.bindFramebuffer(s.FRAMEBUFFER,O),Bt(E)?h.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,gt,Et,bt.__webglTexture,0,Ne(E)):(Et===s.TEXTURE_2D||Et>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&Et<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,gt,Et,bt.__webglTexture,dt),i.bindFramebuffer(s.FRAMEBUFFER,null)}function Dt(O,E,at){if(s.bindRenderbuffer(s.RENDERBUFFER,O),E.depthBuffer){const gt=E.depthTexture,Et=gt&&gt.isDepthTexture?gt.type:null,dt=D(E.stencilBuffer,Et),Zt=E.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Rt=Ne(E);Bt(E)?h.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Rt,dt,E.width,E.height):at?s.renderbufferStorageMultisample(s.RENDERBUFFER,Rt,dt,E.width,E.height):s.renderbufferStorage(s.RENDERBUFFER,dt,E.width,E.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,Zt,s.RENDERBUFFER,O)}else{const gt=E.textures;for(let Et=0;Et<gt.length;Et++){const dt=gt[Et],Zt=c.convert(dt.format,dt.colorSpace),Rt=c.convert(dt.type),qt=z(dt.internalFormat,Zt,Rt,dt.colorSpace),Yt=Ne(E);at&&Bt(E)===!1?s.renderbufferStorageMultisample(s.RENDERBUFFER,Yt,qt,E.width,E.height):Bt(E)?h.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Yt,qt,E.width,E.height):s.renderbufferStorage(s.RENDERBUFFER,qt,E.width,E.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function $t(O,E){if(E&&E.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(i.bindFramebuffer(s.FRAMEBUFFER,O),!(E.depthTexture&&E.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const gt=r.get(E.depthTexture);gt.__renderTarget=E,(!gt.__webglTexture||E.depthTexture.image.width!==E.width||E.depthTexture.image.height!==E.height)&&(E.depthTexture.image.width=E.width,E.depthTexture.image.height=E.height,E.depthTexture.needsUpdate=!0),ct(E.depthTexture,0);const Et=gt.__webglTexture,dt=Ne(E);if(E.depthTexture.format===No)Bt(E)?h.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Et,0,dt):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Et,0);else if(E.depthTexture.format===Oo)Bt(E)?h.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Et,0,dt):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Et,0);else throw new Error("Unknown depthTexture format")}function Be(O){const E=r.get(O),at=O.isWebGLCubeRenderTarget===!0;if(E.__boundDepthTexture!==O.depthTexture){const gt=O.depthTexture;if(E.__depthDisposeCallback&&E.__depthDisposeCallback(),gt){const Et=()=>{delete E.__boundDepthTexture,delete E.__depthDisposeCallback,gt.removeEventListener("dispose",Et)};gt.addEventListener("dispose",Et),E.__depthDisposeCallback=Et}E.__boundDepthTexture=gt}if(O.depthTexture&&!E.__autoAllocateDepthBuffer){if(at)throw new Error("target.depthTexture not supported in Cube render targets");const gt=O.texture.mipmaps;gt&&gt.length>0?$t(E.__webglFramebuffer[0],O):$t(E.__webglFramebuffer,O)}else if(at){E.__webglDepthbuffer=[];for(let gt=0;gt<6;gt++)if(i.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer[gt]),E.__webglDepthbuffer[gt]===void 0)E.__webglDepthbuffer[gt]=s.createRenderbuffer(),Dt(E.__webglDepthbuffer[gt],O,!1);else{const Et=O.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,dt=E.__webglDepthbuffer[gt];s.bindRenderbuffer(s.RENDERBUFFER,dt),s.framebufferRenderbuffer(s.FRAMEBUFFER,Et,s.RENDERBUFFER,dt)}}else{const gt=O.texture.mipmaps;if(gt&&gt.length>0?i.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer[0]):i.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer),E.__webglDepthbuffer===void 0)E.__webglDepthbuffer=s.createRenderbuffer(),Dt(E.__webglDepthbuffer,O,!1);else{const Et=O.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,dt=E.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,dt),s.framebufferRenderbuffer(s.FRAMEBUFFER,Et,s.RENDERBUFFER,dt)}}i.bindFramebuffer(s.FRAMEBUFFER,null)}function fe(O,E,at){const gt=r.get(O);E!==void 0&&Ut(gt.__webglFramebuffer,O,O.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),at!==void 0&&Be(O)}function G(O){const E=O.texture,at=r.get(O),gt=r.get(E);O.addEventListener("dispose",U);const Et=O.textures,dt=O.isWebGLCubeRenderTarget===!0,Zt=Et.length>1;if(Zt||(gt.__webglTexture===void 0&&(gt.__webglTexture=s.createTexture()),gt.__version=E.version,d.memory.textures++),dt){at.__webglFramebuffer=[];for(let Rt=0;Rt<6;Rt++)if(E.mipmaps&&E.mipmaps.length>0){at.__webglFramebuffer[Rt]=[];for(let qt=0;qt<E.mipmaps.length;qt++)at.__webglFramebuffer[Rt][qt]=s.createFramebuffer()}else at.__webglFramebuffer[Rt]=s.createFramebuffer()}else{if(E.mipmaps&&E.mipmaps.length>0){at.__webglFramebuffer=[];for(let Rt=0;Rt<E.mipmaps.length;Rt++)at.__webglFramebuffer[Rt]=s.createFramebuffer()}else at.__webglFramebuffer=s.createFramebuffer();if(Zt)for(let Rt=0,qt=Et.length;Rt<qt;Rt++){const Yt=r.get(Et[Rt]);Yt.__webglTexture===void 0&&(Yt.__webglTexture=s.createTexture(),d.memory.textures++)}if(O.samples>0&&Bt(O)===!1){at.__webglMultisampledFramebuffer=s.createFramebuffer(),at.__webglColorRenderbuffer=[],i.bindFramebuffer(s.FRAMEBUFFER,at.__webglMultisampledFramebuffer);for(let Rt=0;Rt<Et.length;Rt++){const qt=Et[Rt];at.__webglColorRenderbuffer[Rt]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,at.__webglColorRenderbuffer[Rt]);const Yt=c.convert(qt.format,qt.colorSpace),bt=c.convert(qt.type),Ct=z(qt.internalFormat,Yt,bt,qt.colorSpace,O.isXRRenderTarget===!0),jt=Ne(O);s.renderbufferStorageMultisample(s.RENDERBUFFER,jt,Ct,O.width,O.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Rt,s.RENDERBUFFER,at.__webglColorRenderbuffer[Rt])}s.bindRenderbuffer(s.RENDERBUFFER,null),O.depthBuffer&&(at.__webglDepthRenderbuffer=s.createRenderbuffer(),Dt(at.__webglDepthRenderbuffer,O,!0)),i.bindFramebuffer(s.FRAMEBUFFER,null)}}if(dt){i.bindTexture(s.TEXTURE_CUBE_MAP,gt.__webglTexture),et(s.TEXTURE_CUBE_MAP,E);for(let Rt=0;Rt<6;Rt++)if(E.mipmaps&&E.mipmaps.length>0)for(let qt=0;qt<E.mipmaps.length;qt++)Ut(at.__webglFramebuffer[Rt][qt],O,E,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+Rt,qt);else Ut(at.__webglFramebuffer[Rt],O,E,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+Rt,0);y(E)&&_(s.TEXTURE_CUBE_MAP),i.unbindTexture()}else if(Zt){for(let Rt=0,qt=Et.length;Rt<qt;Rt++){const Yt=Et[Rt],bt=r.get(Yt);let Ct=s.TEXTURE_2D;(O.isWebGL3DRenderTarget||O.isWebGLArrayRenderTarget)&&(Ct=O.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),i.bindTexture(Ct,bt.__webglTexture),et(Ct,Yt),Ut(at.__webglFramebuffer,O,Yt,s.COLOR_ATTACHMENT0+Rt,Ct,0),y(Yt)&&_(Ct)}i.unbindTexture()}else{let Rt=s.TEXTURE_2D;if((O.isWebGL3DRenderTarget||O.isWebGLArrayRenderTarget)&&(Rt=O.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),i.bindTexture(Rt,gt.__webglTexture),et(Rt,E),E.mipmaps&&E.mipmaps.length>0)for(let qt=0;qt<E.mipmaps.length;qt++)Ut(at.__webglFramebuffer[qt],O,E,s.COLOR_ATTACHMENT0,Rt,qt);else Ut(at.__webglFramebuffer,O,E,s.COLOR_ATTACHMENT0,Rt,0);y(E)&&_(Rt),i.unbindTexture()}O.depthBuffer&&Be(O)}function de(O){const E=O.textures;for(let at=0,gt=E.length;at<gt;at++){const Et=E[at];if(y(Et)){const dt=I(O),Zt=r.get(Et).__webglTexture;i.bindTexture(dt,Zt),_(dt),i.unbindTexture()}}}const Xt=[],pe=[];function Wt(O){if(O.samples>0){if(Bt(O)===!1){const E=O.textures,at=O.width,gt=O.height;let Et=s.COLOR_BUFFER_BIT;const dt=O.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Zt=r.get(O),Rt=E.length>1;if(Rt)for(let Yt=0;Yt<E.length;Yt++)i.bindFramebuffer(s.FRAMEBUFFER,Zt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Yt,s.RENDERBUFFER,null),i.bindFramebuffer(s.FRAMEBUFFER,Zt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Yt,s.TEXTURE_2D,null,0);i.bindFramebuffer(s.READ_FRAMEBUFFER,Zt.__webglMultisampledFramebuffer);const qt=O.texture.mipmaps;qt&&qt.length>0?i.bindFramebuffer(s.DRAW_FRAMEBUFFER,Zt.__webglFramebuffer[0]):i.bindFramebuffer(s.DRAW_FRAMEBUFFER,Zt.__webglFramebuffer);for(let Yt=0;Yt<E.length;Yt++){if(O.resolveDepthBuffer&&(O.depthBuffer&&(Et|=s.DEPTH_BUFFER_BIT),O.stencilBuffer&&O.resolveStencilBuffer&&(Et|=s.STENCIL_BUFFER_BIT)),Rt){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,Zt.__webglColorRenderbuffer[Yt]);const bt=r.get(E[Yt]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,bt,0)}s.blitFramebuffer(0,0,at,gt,0,0,at,gt,Et,s.NEAREST),m===!0&&(Xt.length=0,pe.length=0,Xt.push(s.COLOR_ATTACHMENT0+Yt),O.depthBuffer&&O.resolveDepthBuffer===!1&&(Xt.push(dt),pe.push(dt),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,pe)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,Xt))}if(i.bindFramebuffer(s.READ_FRAMEBUFFER,null),i.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),Rt)for(let Yt=0;Yt<E.length;Yt++){i.bindFramebuffer(s.FRAMEBUFFER,Zt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Yt,s.RENDERBUFFER,Zt.__webglColorRenderbuffer[Yt]);const bt=r.get(E[Yt]).__webglTexture;i.bindFramebuffer(s.FRAMEBUFFER,Zt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Yt,s.TEXTURE_2D,bt,0)}i.bindFramebuffer(s.DRAW_FRAMEBUFFER,Zt.__webglMultisampledFramebuffer)}else if(O.depthBuffer&&O.resolveDepthBuffer===!1&&m){const E=O.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[E])}}}function Ne(O){return Math.min(l.maxSamples,O.samples)}function Bt(O){const E=r.get(O);return O.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&E.__useRenderToTexture!==!1}function ne(O){const E=d.render.frame;v.get(O)!==E&&(v.set(O,E),O.update())}function We(O,E){const at=O.colorSpace,gt=O.format,Et=O.type;return O.isCompressedTexture===!0||O.isVideoTexture===!0||at!==Rs&&at!==Ba&&(we.getTransfer(at)===Ge?(gt!==xi||Et!==Li)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",at)),E}function je(O){return typeof HTMLImageElement<"u"&&O instanceof HTMLImageElement?(p.width=O.naturalWidth||O.width,p.height=O.naturalHeight||O.height):typeof VideoFrame<"u"&&O instanceof VideoFrame?(p.width=O.displayWidth,p.height=O.displayHeight):(p.width=O.width,p.height=O.height),p}this.allocateTextureUnit=tt,this.resetTextureUnits=J,this.setTexture2D=ct,this.setTexture2DArray=B,this.setTexture3D=q,this.setTextureCube=j,this.rebindTextures=fe,this.setupRenderTarget=G,this.updateRenderTargetMipmap=de,this.updateMultisampleRenderTarget=Wt,this.setupDepthRenderbuffer=Be,this.setupFrameBufferTexture=Ut,this.useMultisampledRTT=Bt}function Vb(s,e){function i(r,l=Ba){let c;const d=we.getTransfer(l);if(r===Li)return s.UNSIGNED_BYTE;if(r===_h)return s.UNSIGNED_SHORT_4_4_4_4;if(r===vh)return s.UNSIGNED_SHORT_5_5_5_1;if(r===B_)return s.UNSIGNED_INT_5_9_9_9_REV;if(r===z_)return s.BYTE;if(r===P_)return s.SHORT;if(r===Uo)return s.UNSIGNED_SHORT;if(r===gh)return s.INT;if(r===Sr)return s.UNSIGNED_INT;if(r===ra)return s.FLOAT;if(r===Po)return s.HALF_FLOAT;if(r===F_)return s.ALPHA;if(r===I_)return s.RGB;if(r===xi)return s.RGBA;if(r===No)return s.DEPTH_COMPONENT;if(r===Oo)return s.DEPTH_STENCIL;if(r===H_)return s.RED;if(r===xh)return s.RED_INTEGER;if(r===G_)return s.RG;if(r===Sh)return s.RG_INTEGER;if(r===yh)return s.RGBA_INTEGER;if(r===Sc||r===yc||r===Mc||r===Ec)if(d===Ge)if(c=e.get("WEBGL_compressed_texture_s3tc_srgb"),c!==null){if(r===Sc)return c.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(r===yc)return c.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(r===Mc)return c.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(r===Ec)return c.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(c=e.get("WEBGL_compressed_texture_s3tc"),c!==null){if(r===Sc)return c.COMPRESSED_RGB_S3TC_DXT1_EXT;if(r===yc)return c.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(r===Mc)return c.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(r===Ec)return c.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(r===Fd||r===Id||r===Hd||r===Gd)if(c=e.get("WEBGL_compressed_texture_pvrtc"),c!==null){if(r===Fd)return c.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(r===Id)return c.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(r===Hd)return c.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(r===Gd)return c.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(r===Vd||r===kd||r===Xd)if(c=e.get("WEBGL_compressed_texture_etc"),c!==null){if(r===Vd||r===kd)return d===Ge?c.COMPRESSED_SRGB8_ETC2:c.COMPRESSED_RGB8_ETC2;if(r===Xd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:c.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(r===Wd||r===qd||r===Yd||r===Zd||r===jd||r===Kd||r===Qd||r===Jd||r===$d||r===th||r===eh||r===nh||r===ih||r===ah)if(c=e.get("WEBGL_compressed_texture_astc"),c!==null){if(r===Wd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:c.COMPRESSED_RGBA_ASTC_4x4_KHR;if(r===qd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:c.COMPRESSED_RGBA_ASTC_5x4_KHR;if(r===Yd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:c.COMPRESSED_RGBA_ASTC_5x5_KHR;if(r===Zd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:c.COMPRESSED_RGBA_ASTC_6x5_KHR;if(r===jd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:c.COMPRESSED_RGBA_ASTC_6x6_KHR;if(r===Kd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:c.COMPRESSED_RGBA_ASTC_8x5_KHR;if(r===Qd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:c.COMPRESSED_RGBA_ASTC_8x6_KHR;if(r===Jd)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:c.COMPRESSED_RGBA_ASTC_8x8_KHR;if(r===$d)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:c.COMPRESSED_RGBA_ASTC_10x5_KHR;if(r===th)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:c.COMPRESSED_RGBA_ASTC_10x6_KHR;if(r===eh)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:c.COMPRESSED_RGBA_ASTC_10x8_KHR;if(r===nh)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:c.COMPRESSED_RGBA_ASTC_10x10_KHR;if(r===ih)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:c.COMPRESSED_RGBA_ASTC_12x10_KHR;if(r===ah)return d===Ge?c.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:c.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(r===Tc||r===rh||r===sh)if(c=e.get("EXT_texture_compression_bptc"),c!==null){if(r===Tc)return d===Ge?c.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:c.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(r===rh)return c.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(r===sh)return c.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(r===V_||r===oh||r===lh||r===ch)if(c=e.get("EXT_texture_compression_rgtc"),c!==null){if(r===Tc)return c.COMPRESSED_RED_RGTC1_EXT;if(r===oh)return c.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(r===lh)return c.COMPRESSED_RED_GREEN_RGTC2_EXT;if(r===ch)return c.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return r===Lo?s.UNSIGNED_INT_24_8:s[r]!==void 0?s[r]:null}return{convert:i}}class cv extends Vn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}}const kb=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Xb=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Wb{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,i){if(this.texture===null){const r=new cv(e.texture);(e.depthNear!==i.depthNear||e.depthFar!==i.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=r}}getMesh(e){if(this.texture!==null&&this.mesh===null){const i=e.cameras[0].viewport,r=new Ga({vertexShader:kb,fragmentShader:Xb,uniforms:{depthColor:{value:this.texture},depthWidth:{value:i.z},depthHeight:{value:i.w}}});this.mesh=new Hn(new Lc(20,20),r)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class qb extends ws{constructor(e,i){super();const r=this;let l=null,c=1,d=null,h="local-floor",m=1,p=null,v=null,g=null,S=null,M=null,T=null;const R=new Wb,y={},_=i.getContextAttributes();let I=null,z=null;const D=[],H=[],L=new Ae;let U=null;const V=new fi;V.viewport=new Je;const A=new fi;A.viewport=new Je;const w=[V,A],N=new dM;let J=null,tt=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Y){let mt=D[Y];return mt===void 0&&(mt=new hd,D[Y]=mt),mt.getTargetRaySpace()},this.getControllerGrip=function(Y){let mt=D[Y];return mt===void 0&&(mt=new hd,D[Y]=mt),mt.getGripSpace()},this.getHand=function(Y){let mt=D[Y];return mt===void 0&&(mt=new hd,D[Y]=mt),mt.getHandSpace()};function rt(Y){const mt=H.indexOf(Y.inputSource);if(mt===-1)return;const ft=D[mt];ft!==void 0&&(ft.update(Y.inputSource,Y.frame,p||d),ft.dispatchEvent({type:Y.type,data:Y.inputSource}))}function ct(){l.removeEventListener("select",rt),l.removeEventListener("selectstart",rt),l.removeEventListener("selectend",rt),l.removeEventListener("squeeze",rt),l.removeEventListener("squeezestart",rt),l.removeEventListener("squeezeend",rt),l.removeEventListener("end",ct),l.removeEventListener("inputsourceschange",B);for(let Y=0;Y<D.length;Y++){const mt=H[Y];mt!==null&&(H[Y]=null,D[Y].disconnect(mt))}J=null,tt=null,R.reset();for(const Y in y)delete y[Y];e.setRenderTarget(I),M=null,S=null,g=null,l=null,z=null,pt.stop(),r.isPresenting=!1,e.setPixelRatio(U),e.setSize(L.width,L.height,!1),r.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Y){c=Y,r.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Y){h=Y,r.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return p||d},this.setReferenceSpace=function(Y){p=Y},this.getBaseLayer=function(){return S!==null?S:M},this.getBinding=function(){return g},this.getFrame=function(){return T},this.getSession=function(){return l},this.setSession=async function(Y){if(l=Y,l!==null){if(I=e.getRenderTarget(),l.addEventListener("select",rt),l.addEventListener("selectstart",rt),l.addEventListener("selectend",rt),l.addEventListener("squeeze",rt),l.addEventListener("squeezestart",rt),l.addEventListener("squeezeend",rt),l.addEventListener("end",ct),l.addEventListener("inputsourceschange",B),_.xrCompatible!==!0&&await i.makeXRCompatible(),U=e.getPixelRatio(),e.getSize(L),typeof XRWebGLBinding<"u"&&(g=new XRWebGLBinding(l,i)),g!==null&&"createProjectionLayer"in XRWebGLBinding.prototype){let ft=null,Ut=null,Dt=null;_.depth&&(Dt=_.stencil?i.DEPTH24_STENCIL8:i.DEPTH_COMPONENT24,ft=_.stencil?Oo:No,Ut=_.stencil?Lo:Sr);const $t={colorFormat:i.RGBA8,depthFormat:Dt,scaleFactor:c};S=g.createProjectionLayer($t),l.updateRenderState({layers:[S]}),e.setPixelRatio(1),e.setSize(S.textureWidth,S.textureHeight,!1),z=new yr(S.textureWidth,S.textureHeight,{format:xi,type:Li,depthTexture:new ev(S.textureWidth,S.textureHeight,Ut,void 0,void 0,void 0,void 0,void 0,void 0,ft),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:S.ignoreDepthValues===!1,resolveStencilBuffer:S.ignoreDepthValues===!1})}else{const ft={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:c};M=new XRWebGLLayer(l,i,ft),l.updateRenderState({baseLayer:M}),e.setPixelRatio(1),e.setSize(M.framebufferWidth,M.framebufferHeight,!1),z=new yr(M.framebufferWidth,M.framebufferHeight,{format:xi,type:Li,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:M.ignoreDepthValues===!1,resolveStencilBuffer:M.ignoreDepthValues===!1})}z.isXRRenderTarget=!0,this.setFoveation(m),p=null,d=await l.requestReferenceSpace(h),pt.setContext(l),pt.start(),r.isPresenting=!0,r.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(l!==null)return l.environmentBlendMode},this.getDepthTexture=function(){return R.getDepthTexture()};function B(Y){for(let mt=0;mt<Y.removed.length;mt++){const ft=Y.removed[mt],Ut=H.indexOf(ft);Ut>=0&&(H[Ut]=null,D[Ut].disconnect(ft))}for(let mt=0;mt<Y.added.length;mt++){const ft=Y.added[mt];let Ut=H.indexOf(ft);if(Ut===-1){for(let $t=0;$t<D.length;$t++)if($t>=H.length){H.push(ft),Ut=$t;break}else if(H[$t]===null){H[$t]=ft,Ut=$t;break}if(Ut===-1)break}const Dt=D[Ut];Dt&&Dt.connect(ft)}}const q=new $,j=new $;function yt(Y,mt,ft){q.setFromMatrixPosition(mt.matrixWorld),j.setFromMatrixPosition(ft.matrixWorld);const Ut=q.distanceTo(j),Dt=mt.projectionMatrix.elements,$t=ft.projectionMatrix.elements,Be=Dt[14]/(Dt[10]-1),fe=Dt[14]/(Dt[10]+1),G=(Dt[9]+1)/Dt[5],de=(Dt[9]-1)/Dt[5],Xt=(Dt[8]-1)/Dt[0],pe=($t[8]+1)/$t[0],Wt=Be*Xt,Ne=Be*pe,Bt=Ut/(-Xt+pe),ne=Bt*-Xt;if(mt.matrixWorld.decompose(Y.position,Y.quaternion,Y.scale),Y.translateX(ne),Y.translateZ(Bt),Y.matrixWorld.compose(Y.position,Y.quaternion,Y.scale),Y.matrixWorldInverse.copy(Y.matrixWorld).invert(),Dt[10]===-1)Y.projectionMatrix.copy(mt.projectionMatrix),Y.projectionMatrixInverse.copy(mt.projectionMatrixInverse);else{const We=Be+Bt,je=fe+Bt,O=Wt-ne,E=Ne+(Ut-ne),at=G*fe/je*We,gt=de*fe/je*We;Y.projectionMatrix.makePerspective(O,E,at,gt,We,je),Y.projectionMatrixInverse.copy(Y.projectionMatrix).invert()}}function St(Y,mt){mt===null?Y.matrixWorld.copy(Y.matrix):Y.matrixWorld.multiplyMatrices(mt.matrixWorld,Y.matrix),Y.matrixWorldInverse.copy(Y.matrixWorld).invert()}this.updateCamera=function(Y){if(l===null)return;let mt=Y.near,ft=Y.far;R.texture!==null&&(R.depthNear>0&&(mt=R.depthNear),R.depthFar>0&&(ft=R.depthFar)),N.near=A.near=V.near=mt,N.far=A.far=V.far=ft,(J!==N.near||tt!==N.far)&&(l.updateRenderState({depthNear:N.near,depthFar:N.far}),J=N.near,tt=N.far),N.layers.mask=Y.layers.mask|6,V.layers.mask=N.layers.mask&3,A.layers.mask=N.layers.mask&5;const Ut=Y.parent,Dt=N.cameras;St(N,Ut);for(let $t=0;$t<Dt.length;$t++)St(Dt[$t],Ut);Dt.length===2?yt(N,V,A):N.projectionMatrix.copy(V.projectionMatrix),P(Y,N,Ut)};function P(Y,mt,ft){ft===null?Y.matrix.copy(mt.matrixWorld):(Y.matrix.copy(ft.matrixWorld),Y.matrix.invert(),Y.matrix.multiply(mt.matrixWorld)),Y.matrix.decompose(Y.position,Y.quaternion,Y.scale),Y.updateMatrixWorld(!0),Y.projectionMatrix.copy(mt.projectionMatrix),Y.projectionMatrixInverse.copy(mt.projectionMatrixInverse),Y.isPerspectiveCamera&&(Y.fov=zo*2*Math.atan(1/Y.projectionMatrix.elements[5]),Y.zoom=1)}this.getCamera=function(){return N},this.getFoveation=function(){if(!(S===null&&M===null))return m},this.setFoveation=function(Y){m=Y,S!==null&&(S.fixedFoveation=Y),M!==null&&M.fixedFoveation!==void 0&&(M.fixedFoveation=Y)},this.hasDepthSensing=function(){return R.texture!==null},this.getDepthSensingMesh=function(){return R.getMesh(N)},this.getCameraTexture=function(Y){return y[Y]};let et=null;function X(Y,mt){if(v=mt.getViewerPose(p||d),T=mt,v!==null){const ft=v.views;M!==null&&(e.setRenderTargetFramebuffer(z,M.framebuffer),e.setRenderTarget(z));let Ut=!1;ft.length!==N.cameras.length&&(N.cameras.length=0,Ut=!0);for(let fe=0;fe<ft.length;fe++){const G=ft[fe];let de=null;if(M!==null)de=M.getViewport(G);else{const pe=g.getViewSubImage(S,G);de=pe.viewport,fe===0&&(e.setRenderTargetTextures(z,pe.colorTexture,pe.depthStencilTexture),e.setRenderTarget(z))}let Xt=w[fe];Xt===void 0&&(Xt=new fi,Xt.layers.enable(fe),Xt.viewport=new Je,w[fe]=Xt),Xt.matrix.fromArray(G.transform.matrix),Xt.matrix.decompose(Xt.position,Xt.quaternion,Xt.scale),Xt.projectionMatrix.fromArray(G.projectionMatrix),Xt.projectionMatrixInverse.copy(Xt.projectionMatrix).invert(),Xt.viewport.set(de.x,de.y,de.width,de.height),fe===0&&(N.matrix.copy(Xt.matrix),N.matrix.decompose(N.position,N.quaternion,N.scale)),Ut===!0&&N.cameras.push(Xt)}const Dt=l.enabledFeatures;if(Dt&&Dt.includes("depth-sensing")&&l.depthUsage=="gpu-optimized"&&g){const fe=g.getDepthInformation(ft[0]);fe&&fe.isValid&&fe.texture&&R.init(fe,l.renderState)}if(Dt&&Dt.includes("camera-access")&&(e.state.unbindTexture(),g))for(let fe=0;fe<ft.length;fe++){const G=ft[fe].camera;if(G){let de=y[G];de||(de=new cv,y[G]=de);const Xt=g.getCameraImage(G);de.sourceTexture=Xt}}}for(let ft=0;ft<D.length;ft++){const Ut=H[ft],Dt=D[ft];Ut!==null&&Dt!==void 0&&Dt.update(Ut,mt,p||d)}et&&et(Y,mt),mt.detectedPlanes&&r.dispatchEvent({type:"planesdetected",data:mt}),T=null}const pt=new av;pt.setAnimationLoop(X),this.setAnimationLoop=function(Y){et=Y},this.dispose=function(){}}}const dr=new Ni,Yb=new $e;function Zb(s,e){function i(y,_){y.matrixAutoUpdate===!0&&y.updateMatrix(),_.value.copy(y.matrix)}function r(y,_){_.color.getRGB(y.fogColor.value,J_(s)),_.isFog?(y.fogNear.value=_.near,y.fogFar.value=_.far):_.isFogExp2&&(y.fogDensity.value=_.density)}function l(y,_,I,z,D){_.isMeshBasicMaterial||_.isMeshLambertMaterial?c(y,_):_.isMeshToonMaterial?(c(y,_),g(y,_)):_.isMeshPhongMaterial?(c(y,_),v(y,_)):_.isMeshStandardMaterial?(c(y,_),S(y,_),_.isMeshPhysicalMaterial&&M(y,_,D)):_.isMeshMatcapMaterial?(c(y,_),T(y,_)):_.isMeshDepthMaterial?c(y,_):_.isMeshDistanceMaterial?(c(y,_),R(y,_)):_.isMeshNormalMaterial?c(y,_):_.isLineBasicMaterial?(d(y,_),_.isLineDashedMaterial&&h(y,_)):_.isPointsMaterial?m(y,_,I,z):_.isSpriteMaterial?p(y,_):_.isShadowMaterial?(y.color.value.copy(_.color),y.opacity.value=_.opacity):_.isShaderMaterial&&(_.uniformsNeedUpdate=!1)}function c(y,_){y.opacity.value=_.opacity,_.color&&y.diffuse.value.copy(_.color),_.emissive&&y.emissive.value.copy(_.emissive).multiplyScalar(_.emissiveIntensity),_.map&&(y.map.value=_.map,i(_.map,y.mapTransform)),_.alphaMap&&(y.alphaMap.value=_.alphaMap,i(_.alphaMap,y.alphaMapTransform)),_.bumpMap&&(y.bumpMap.value=_.bumpMap,i(_.bumpMap,y.bumpMapTransform),y.bumpScale.value=_.bumpScale,_.side===Gn&&(y.bumpScale.value*=-1)),_.normalMap&&(y.normalMap.value=_.normalMap,i(_.normalMap,y.normalMapTransform),y.normalScale.value.copy(_.normalScale),_.side===Gn&&y.normalScale.value.negate()),_.displacementMap&&(y.displacementMap.value=_.displacementMap,i(_.displacementMap,y.displacementMapTransform),y.displacementScale.value=_.displacementScale,y.displacementBias.value=_.displacementBias),_.emissiveMap&&(y.emissiveMap.value=_.emissiveMap,i(_.emissiveMap,y.emissiveMapTransform)),_.specularMap&&(y.specularMap.value=_.specularMap,i(_.specularMap,y.specularMapTransform)),_.alphaTest>0&&(y.alphaTest.value=_.alphaTest);const I=e.get(_),z=I.envMap,D=I.envMapRotation;z&&(y.envMap.value=z,dr.copy(D),dr.x*=-1,dr.y*=-1,dr.z*=-1,z.isCubeTexture&&z.isRenderTargetTexture===!1&&(dr.y*=-1,dr.z*=-1),y.envMapRotation.value.setFromMatrix4(Yb.makeRotationFromEuler(dr)),y.flipEnvMap.value=z.isCubeTexture&&z.isRenderTargetTexture===!1?-1:1,y.reflectivity.value=_.reflectivity,y.ior.value=_.ior,y.refractionRatio.value=_.refractionRatio),_.lightMap&&(y.lightMap.value=_.lightMap,y.lightMapIntensity.value=_.lightMapIntensity,i(_.lightMap,y.lightMapTransform)),_.aoMap&&(y.aoMap.value=_.aoMap,y.aoMapIntensity.value=_.aoMapIntensity,i(_.aoMap,y.aoMapTransform))}function d(y,_){y.diffuse.value.copy(_.color),y.opacity.value=_.opacity,_.map&&(y.map.value=_.map,i(_.map,y.mapTransform))}function h(y,_){y.dashSize.value=_.dashSize,y.totalSize.value=_.dashSize+_.gapSize,y.scale.value=_.scale}function m(y,_,I,z){y.diffuse.value.copy(_.color),y.opacity.value=_.opacity,y.size.value=_.size*I,y.scale.value=z*.5,_.map&&(y.map.value=_.map,i(_.map,y.uvTransform)),_.alphaMap&&(y.alphaMap.value=_.alphaMap,i(_.alphaMap,y.alphaMapTransform)),_.alphaTest>0&&(y.alphaTest.value=_.alphaTest)}function p(y,_){y.diffuse.value.copy(_.color),y.opacity.value=_.opacity,y.rotation.value=_.rotation,_.map&&(y.map.value=_.map,i(_.map,y.mapTransform)),_.alphaMap&&(y.alphaMap.value=_.alphaMap,i(_.alphaMap,y.alphaMapTransform)),_.alphaTest>0&&(y.alphaTest.value=_.alphaTest)}function v(y,_){y.specular.value.copy(_.specular),y.shininess.value=Math.max(_.shininess,1e-4)}function g(y,_){_.gradientMap&&(y.gradientMap.value=_.gradientMap)}function S(y,_){y.metalness.value=_.metalness,_.metalnessMap&&(y.metalnessMap.value=_.metalnessMap,i(_.metalnessMap,y.metalnessMapTransform)),y.roughness.value=_.roughness,_.roughnessMap&&(y.roughnessMap.value=_.roughnessMap,i(_.roughnessMap,y.roughnessMapTransform)),_.envMap&&(y.envMapIntensity.value=_.envMapIntensity)}function M(y,_,I){y.ior.value=_.ior,_.sheen>0&&(y.sheenColor.value.copy(_.sheenColor).multiplyScalar(_.sheen),y.sheenRoughness.value=_.sheenRoughness,_.sheenColorMap&&(y.sheenColorMap.value=_.sheenColorMap,i(_.sheenColorMap,y.sheenColorMapTransform)),_.sheenRoughnessMap&&(y.sheenRoughnessMap.value=_.sheenRoughnessMap,i(_.sheenRoughnessMap,y.sheenRoughnessMapTransform))),_.clearcoat>0&&(y.clearcoat.value=_.clearcoat,y.clearcoatRoughness.value=_.clearcoatRoughness,_.clearcoatMap&&(y.clearcoatMap.value=_.clearcoatMap,i(_.clearcoatMap,y.clearcoatMapTransform)),_.clearcoatRoughnessMap&&(y.clearcoatRoughnessMap.value=_.clearcoatRoughnessMap,i(_.clearcoatRoughnessMap,y.clearcoatRoughnessMapTransform)),_.clearcoatNormalMap&&(y.clearcoatNormalMap.value=_.clearcoatNormalMap,i(_.clearcoatNormalMap,y.clearcoatNormalMapTransform),y.clearcoatNormalScale.value.copy(_.clearcoatNormalScale),_.side===Gn&&y.clearcoatNormalScale.value.negate())),_.dispersion>0&&(y.dispersion.value=_.dispersion),_.iridescence>0&&(y.iridescence.value=_.iridescence,y.iridescenceIOR.value=_.iridescenceIOR,y.iridescenceThicknessMinimum.value=_.iridescenceThicknessRange[0],y.iridescenceThicknessMaximum.value=_.iridescenceThicknessRange[1],_.iridescenceMap&&(y.iridescenceMap.value=_.iridescenceMap,i(_.iridescenceMap,y.iridescenceMapTransform)),_.iridescenceThicknessMap&&(y.iridescenceThicknessMap.value=_.iridescenceThicknessMap,i(_.iridescenceThicknessMap,y.iridescenceThicknessMapTransform))),_.transmission>0&&(y.transmission.value=_.transmission,y.transmissionSamplerMap.value=I.texture,y.transmissionSamplerSize.value.set(I.width,I.height),_.transmissionMap&&(y.transmissionMap.value=_.transmissionMap,i(_.transmissionMap,y.transmissionMapTransform)),y.thickness.value=_.thickness,_.thicknessMap&&(y.thicknessMap.value=_.thicknessMap,i(_.thicknessMap,y.thicknessMapTransform)),y.attenuationDistance.value=_.attenuationDistance,y.attenuationColor.value.copy(_.attenuationColor)),_.anisotropy>0&&(y.anisotropyVector.value.set(_.anisotropy*Math.cos(_.anisotropyRotation),_.anisotropy*Math.sin(_.anisotropyRotation)),_.anisotropyMap&&(y.anisotropyMap.value=_.anisotropyMap,i(_.anisotropyMap,y.anisotropyMapTransform))),y.specularIntensity.value=_.specularIntensity,y.specularColor.value.copy(_.specularColor),_.specularColorMap&&(y.specularColorMap.value=_.specularColorMap,i(_.specularColorMap,y.specularColorMapTransform)),_.specularIntensityMap&&(y.specularIntensityMap.value=_.specularIntensityMap,i(_.specularIntensityMap,y.specularIntensityMapTransform))}function T(y,_){_.matcap&&(y.matcap.value=_.matcap)}function R(y,_){const I=e.get(_).light;y.referencePosition.value.setFromMatrixPosition(I.matrixWorld),y.nearDistance.value=I.shadow.camera.near,y.farDistance.value=I.shadow.camera.far}return{refreshFogUniforms:r,refreshMaterialUniforms:l}}function jb(s,e,i,r){let l={},c={},d=[];const h=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function m(I,z){const D=z.program;r.uniformBlockBinding(I,D)}function p(I,z){let D=l[I.id];D===void 0&&(T(I),D=v(I),l[I.id]=D,I.addEventListener("dispose",y));const H=z.program;r.updateUBOMapping(I,H);const L=e.render.frame;c[I.id]!==L&&(S(I),c[I.id]=L)}function v(I){const z=g();I.__bindingPointIndex=z;const D=s.createBuffer(),H=I.__size,L=I.usage;return s.bindBuffer(s.UNIFORM_BUFFER,D),s.bufferData(s.UNIFORM_BUFFER,H,L),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,z,D),D}function g(){for(let I=0;I<h;I++)if(d.indexOf(I)===-1)return d.push(I),I;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function S(I){const z=l[I.id],D=I.uniforms,H=I.__cache;s.bindBuffer(s.UNIFORM_BUFFER,z);for(let L=0,U=D.length;L<U;L++){const V=Array.isArray(D[L])?D[L]:[D[L]];for(let A=0,w=V.length;A<w;A++){const N=V[A];if(M(N,L,A,H)===!0){const J=N.__offset,tt=Array.isArray(N.value)?N.value:[N.value];let rt=0;for(let ct=0;ct<tt.length;ct++){const B=tt[ct],q=R(B);typeof B=="number"||typeof B=="boolean"?(N.__data[0]=B,s.bufferSubData(s.UNIFORM_BUFFER,J+rt,N.__data)):B.isMatrix3?(N.__data[0]=B.elements[0],N.__data[1]=B.elements[1],N.__data[2]=B.elements[2],N.__data[3]=0,N.__data[4]=B.elements[3],N.__data[5]=B.elements[4],N.__data[6]=B.elements[5],N.__data[7]=0,N.__data[8]=B.elements[6],N.__data[9]=B.elements[7],N.__data[10]=B.elements[8],N.__data[11]=0):(B.toArray(N.__data,rt),rt+=q.storage/Float32Array.BYTES_PER_ELEMENT)}s.bufferSubData(s.UNIFORM_BUFFER,J,N.__data)}}}s.bindBuffer(s.UNIFORM_BUFFER,null)}function M(I,z,D,H){const L=I.value,U=z+"_"+D;if(H[U]===void 0)return typeof L=="number"||typeof L=="boolean"?H[U]=L:H[U]=L.clone(),!0;{const V=H[U];if(typeof L=="number"||typeof L=="boolean"){if(V!==L)return H[U]=L,!0}else if(V.equals(L)===!1)return V.copy(L),!0}return!1}function T(I){const z=I.uniforms;let D=0;const H=16;for(let U=0,V=z.length;U<V;U++){const A=Array.isArray(z[U])?z[U]:[z[U]];for(let w=0,N=A.length;w<N;w++){const J=A[w],tt=Array.isArray(J.value)?J.value:[J.value];for(let rt=0,ct=tt.length;rt<ct;rt++){const B=tt[rt],q=R(B),j=D%H,yt=j%q.boundary,St=j+yt;D+=yt,St!==0&&H-St<q.storage&&(D+=H-St),J.__data=new Float32Array(q.storage/Float32Array.BYTES_PER_ELEMENT),J.__offset=D,D+=q.storage}}}const L=D%H;return L>0&&(D+=H-L),I.__size=D,I.__cache={},this}function R(I){const z={boundary:0,storage:0};return typeof I=="number"||typeof I=="boolean"?(z.boundary=4,z.storage=4):I.isVector2?(z.boundary=8,z.storage=8):I.isVector3||I.isColor?(z.boundary=16,z.storage=12):I.isVector4?(z.boundary=16,z.storage=16):I.isMatrix3?(z.boundary=48,z.storage=48):I.isMatrix4?(z.boundary=64,z.storage=64):I.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",I),z}function y(I){const z=I.target;z.removeEventListener("dispose",y);const D=d.indexOf(z.__bindingPointIndex);d.splice(D,1),s.deleteBuffer(l[z.id]),delete l[z.id],delete c[z.id]}function _(){for(const I in l)s.deleteBuffer(l[I]);d=[],l={},c={}}return{bind:m,update:p,dispose:_}}class Kb{constructor(e={}){const{canvas:i=Uy(),context:r=null,depth:l=!0,stencil:c=!1,alpha:d=!1,antialias:h=!1,premultipliedAlpha:m=!0,preserveDrawingBuffer:p=!1,powerPreference:v="default",failIfMajorPerformanceCaveat:g=!1,reversedDepthBuffer:S=!1}=e;this.isWebGLRenderer=!0;let M;if(r!==null){if(typeof WebGLRenderingContext<"u"&&r instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");M=r.getContextAttributes().alpha}else M=d;const T=new Uint32Array(4),R=new Int32Array(4);let y=null,_=null;const I=[],z=[];this.domElement=i,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Ia,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const D=this;let H=!1;this._outputColorSpace=ui;let L=0,U=0,V=null,A=-1,w=null;const N=new Je,J=new Je;let tt=null;const rt=new be(0);let ct=0,B=i.width,q=i.height,j=1,yt=null,St=null;const P=new Je(0,0,B,q),et=new Je(0,0,B,q);let X=!1;const pt=new Ah;let Y=!1,mt=!1;const ft=new $e,Ut=new $,Dt=new Je,$t={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Be=!1;function fe(){return V===null?j:1}let G=r;function de(C,Z){return i.getContext(C,Z)}try{const C={alpha:!0,depth:l,stencil:c,antialias:h,premultipliedAlpha:m,preserveDrawingBuffer:p,powerPreference:v,failIfMajorPerformanceCaveat:g};if("setAttribute"in i&&i.setAttribute("data-engine",`three.js r${ph}`),i.addEventListener("webglcontextlost",wt,!1),i.addEventListener("webglcontextrestored",Ft,!1),i.addEventListener("webglcontextcreationerror",Tt,!1),G===null){const Z="webgl2";if(G=de(Z,C),G===null)throw de(Z)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(C){throw console.error("THREE.WebGLRenderer: "+C.message),C}let Xt,pe,Wt,Ne,Bt,ne,We,je,O,E,at,gt,Et,dt,Zt,Rt,qt,Yt,bt,Ct,jt,Pt,Lt,re;function W(){Xt=new s1(G),Xt.init(),Pt=new Vb(G,Xt),pe=new $T(G,Xt,e,Pt),Wt=new Hb(G,Xt),pe.reversedDepthBuffer&&S&&Wt.buffers.depth.setReversed(!0),Ne=new c1(G),Bt=new Rb,ne=new Gb(G,Xt,Wt,Bt,pe,Pt,Ne),We=new e1(D),je=new r1(D),O=new mM(G),Lt=new QT(G,O),E=new o1(G,O,Ne,Lt),at=new f1(G,E,O,Ne),bt=new u1(G,pe,ne),Rt=new t1(Bt),gt=new Ab(D,We,je,Xt,pe,Lt,Rt),Et=new Zb(D,Bt),dt=new wb,Zt=new zb(Xt),Yt=new KT(D,We,je,Wt,at,M,m),qt=new Fb(D,at,pe),re=new jb(G,Ne,pe,Wt),Ct=new JT(G,Xt,Ne),jt=new l1(G,Xt,Ne),Ne.programs=gt.programs,D.capabilities=pe,D.extensions=Xt,D.properties=Bt,D.renderLists=dt,D.shadowMap=qt,D.state=Wt,D.info=Ne}W();const At=new qb(D,G);this.xr=At,this.getContext=function(){return G},this.getContextAttributes=function(){return G.getContextAttributes()},this.forceContextLoss=function(){const C=Xt.get("WEBGL_lose_context");C&&C.loseContext()},this.forceContextRestore=function(){const C=Xt.get("WEBGL_lose_context");C&&C.restoreContext()},this.getPixelRatio=function(){return j},this.setPixelRatio=function(C){C!==void 0&&(j=C,this.setSize(B,q,!1))},this.getSize=function(C){return C.set(B,q)},this.setSize=function(C,Z,ot=!0){if(At.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}B=C,q=Z,i.width=Math.floor(C*j),i.height=Math.floor(Z*j),ot===!0&&(i.style.width=C+"px",i.style.height=Z+"px"),this.setViewport(0,0,C,Z)},this.getDrawingBufferSize=function(C){return C.set(B*j,q*j).floor()},this.setDrawingBufferSize=function(C,Z,ot){B=C,q=Z,j=ot,i.width=Math.floor(C*ot),i.height=Math.floor(Z*ot),this.setViewport(0,0,C,Z)},this.getCurrentViewport=function(C){return C.copy(N)},this.getViewport=function(C){return C.copy(P)},this.setViewport=function(C,Z,ot,lt){C.isVector4?P.set(C.x,C.y,C.z,C.w):P.set(C,Z,ot,lt),Wt.viewport(N.copy(P).multiplyScalar(j).round())},this.getScissor=function(C){return C.copy(et)},this.setScissor=function(C,Z,ot,lt){C.isVector4?et.set(C.x,C.y,C.z,C.w):et.set(C,Z,ot,lt),Wt.scissor(J.copy(et).multiplyScalar(j).round())},this.getScissorTest=function(){return X},this.setScissorTest=function(C){Wt.setScissorTest(X=C)},this.setOpaqueSort=function(C){yt=C},this.setTransparentSort=function(C){St=C},this.getClearColor=function(C){return C.copy(Yt.getClearColor())},this.setClearColor=function(){Yt.setClearColor(...arguments)},this.getClearAlpha=function(){return Yt.getClearAlpha()},this.setClearAlpha=function(){Yt.setClearAlpha(...arguments)},this.clear=function(C=!0,Z=!0,ot=!0){let lt=0;if(C){let K=!1;if(V!==null){const Mt=V.texture.format;K=Mt===yh||Mt===Sh||Mt===xh}if(K){const Mt=V.texture.type,Nt=Mt===Li||Mt===Sr||Mt===Uo||Mt===Lo||Mt===_h||Mt===vh,Gt=Yt.getClearColor(),zt=Yt.getClearAlpha(),Kt=Gt.r,ee=Gt.g,Qt=Gt.b;Nt?(T[0]=Kt,T[1]=ee,T[2]=Qt,T[3]=zt,G.clearBufferuiv(G.COLOR,0,T)):(R[0]=Kt,R[1]=ee,R[2]=Qt,R[3]=zt,G.clearBufferiv(G.COLOR,0,R))}else lt|=G.COLOR_BUFFER_BIT}Z&&(lt|=G.DEPTH_BUFFER_BIT),ot&&(lt|=G.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),G.clear(lt)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){i.removeEventListener("webglcontextlost",wt,!1),i.removeEventListener("webglcontextrestored",Ft,!1),i.removeEventListener("webglcontextcreationerror",Tt,!1),Yt.dispose(),dt.dispose(),Zt.dispose(),Bt.dispose(),We.dispose(),je.dispose(),at.dispose(),Lt.dispose(),re.dispose(),gt.dispose(),At.dispose(),At.removeEventListener("sessionstart",ti),At.removeEventListener("sessionend",Ls),Mi.stop()};function wt(C){C.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),H=!0}function Ft(){console.log("THREE.WebGLRenderer: Context Restored."),H=!1;const C=Ne.autoReset,Z=qt.enabled,ot=qt.autoUpdate,lt=qt.needsUpdate,K=qt.type;W(),Ne.autoReset=C,qt.enabled=Z,qt.autoUpdate=ot,qt.needsUpdate=lt,qt.type=K}function Tt(C){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",C.statusMessage)}function xt(C){const Z=C.target;Z.removeEventListener("dispose",xt),It(Z)}function It(C){ie(C),Bt.remove(C)}function ie(C){const Z=Bt.get(C).programs;Z!==void 0&&(Z.forEach(function(ot){gt.releaseProgram(ot)}),C.isShaderMaterial&&gt.releaseShaderCache(C))}this.renderBufferDirect=function(C,Z,ot,lt,K,Mt){Z===null&&(Z=$t);const Nt=K.isMesh&&K.matrixWorld.determinant()<0,Gt=oa(C,Z,ot,lt,K);Wt.setMaterial(lt,Nt);let zt=ot.index,Kt=1;if(lt.wireframe===!0){if(zt=E.getWireframeAttribute(ot),zt===void 0)return;Kt=2}const ee=ot.drawRange,Qt=ot.attributes.position;let he=ee.start*Kt,Ue=(ee.start+ee.count)*Kt;Mt!==null&&(he=Math.max(he,Mt.start*Kt),Ue=Math.min(Ue,(Mt.start+Mt.count)*Kt)),zt!==null?(he=Math.max(he,0),Ue=Math.min(Ue,zt.count)):Qt!=null&&(he=Math.max(he,0),Ue=Math.min(Ue,Qt.count));const Ve=Ue-he;if(Ve<0||Ve===1/0)return;Lt.setup(K,lt,Gt,ot,zt);let Le,me=Ct;if(zt!==null&&(Le=O.get(zt),me=jt,me.setIndex(Le)),K.isMesh)lt.wireframe===!0?(Wt.setLineWidth(lt.wireframeLinewidth*fe()),me.setMode(G.LINES)):me.setMode(G.TRIANGLES);else if(K.isLine){let Vt=lt.linewidth;Vt===void 0&&(Vt=1),Wt.setLineWidth(Vt*fe()),K.isLineSegments?me.setMode(G.LINES):K.isLineLoop?me.setMode(G.LINE_LOOP):me.setMode(G.LINE_STRIP)}else K.isPoints?me.setMode(G.POINTS):K.isSprite&&me.setMode(G.TRIANGLES);if(K.isBatchedMesh)if(K._multiDrawInstances!==null)Ms("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),me.renderMultiDrawInstances(K._multiDrawStarts,K._multiDrawCounts,K._multiDrawCount,K._multiDrawInstances);else if(Xt.get("WEBGL_multi_draw"))me.renderMultiDraw(K._multiDrawStarts,K._multiDrawCounts,K._multiDrawCount);else{const Vt=K._multiDrawStarts,Xe=K._multiDrawCounts,Te=K._multiDrawCount,vn=zt?O.get(zt).bytesPerElement:1,Oi=Bt.get(lt).currentProgram.getUniforms();for(let pn=0;pn<Te;pn++)Oi.setValue(G,"_gl_DrawID",pn),me.render(Vt[pn]/vn,Xe[pn])}else if(K.isInstancedMesh)me.renderInstances(he,Ve,K.count);else if(ot.isInstancedBufferGeometry){const Vt=ot._maxInstanceCount!==void 0?ot._maxInstanceCount:1/0,Xe=Math.min(ot.instanceCount,Vt);me.renderInstances(he,Ve,Xe)}else me.render(he,Ve)};function Oe(C,Z,ot){C.transparent===!0&&C.side===aa&&C.forceSinglePass===!1?(C.side=Gn,C.needsUpdate=!0,kn(C,Z,ot),C.side=Ha,C.needsUpdate=!0,kn(C,Z,ot),C.side=aa):kn(C,Z,ot)}this.compile=function(C,Z,ot=null){ot===null&&(ot=C),_=Zt.get(ot),_.init(Z),z.push(_),ot.traverseVisible(function(K){K.isLight&&K.layers.test(Z.layers)&&(_.pushLight(K),K.castShadow&&_.pushShadow(K))}),C!==ot&&C.traverseVisible(function(K){K.isLight&&K.layers.test(Z.layers)&&(_.pushLight(K),K.castShadow&&_.pushShadow(K))}),_.setupLights();const lt=new Set;return C.traverse(function(K){if(!(K.isMesh||K.isPoints||K.isLine||K.isSprite))return;const Mt=K.material;if(Mt)if(Array.isArray(Mt))for(let Nt=0;Nt<Mt.length;Nt++){const Gt=Mt[Nt];Oe(Gt,ot,K),lt.add(Gt)}else Oe(Mt,ot,K),lt.add(Mt)}),_=z.pop(),lt},this.compileAsync=function(C,Z,ot=null){const lt=this.compile(C,Z,ot);return new Promise(K=>{function Mt(){if(lt.forEach(function(Nt){Bt.get(Nt).currentProgram.isReady()&&lt.delete(Nt)}),lt.size===0){K(C);return}setTimeout(Mt,10)}Xt.get("KHR_parallel_shader_compile")!==null?Mt():setTimeout(Mt,10)})};let Ee=null;function wn(C){Ee&&Ee(C)}function ti(){Mi.stop()}function Ls(){Mi.start()}const Mi=new av;Mi.setAnimationLoop(wn),typeof self<"u"&&Mi.setContext(self),this.setAnimationLoop=function(C){Ee=C,At.setAnimationLoop(C),C===null?Mi.stop():Mi.start()},At.addEventListener("sessionstart",ti),At.addEventListener("sessionend",Ls),this.render=function(C,Z){if(Z!==void 0&&Z.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(H===!0)return;if(C.matrixWorldAutoUpdate===!0&&C.updateMatrixWorld(),Z.parent===null&&Z.matrixWorldAutoUpdate===!0&&Z.updateMatrixWorld(),At.enabled===!0&&At.isPresenting===!0&&(At.cameraAutoUpdate===!0&&At.updateCamera(Z),Z=At.getCamera()),C.isScene===!0&&C.onBeforeRender(D,C,Z,V),_=Zt.get(C,z.length),_.init(Z),z.push(_),ft.multiplyMatrices(Z.projectionMatrix,Z.matrixWorldInverse),pt.setFromProjectionMatrix(ft,Di,Z.reversedDepth),mt=this.localClippingEnabled,Y=Rt.init(this.clippingPlanes,mt),y=dt.get(C,I.length),y.init(),I.push(y),At.enabled===!0&&At.isPresenting===!0){const Mt=D.xr.getDepthSensingMesh();Mt!==null&&Er(Mt,Z,-1/0,D.sortObjects)}Er(C,Z,0,D.sortObjects),y.finish(),D.sortObjects===!0&&y.sort(yt,St),Be=At.enabled===!1||At.isPresenting===!1||At.hasDepthSensing()===!1,Be&&Yt.addToRenderList(y,C),this.info.render.frame++,Y===!0&&Rt.beginShadows();const ot=_.state.shadowsArray;qt.render(ot,C,Z),Y===!0&&Rt.endShadows(),this.info.autoReset===!0&&this.info.reset();const lt=y.opaque,K=y.transmissive;if(_.setupLights(),Z.isArrayCamera){const Mt=Z.cameras;if(K.length>0)for(let Nt=0,Gt=Mt.length;Nt<Gt;Nt++){const zt=Mt[Nt];br(lt,K,C,zt)}Be&&Yt.render(C);for(let Nt=0,Gt=Mt.length;Nt<Gt;Nt++){const zt=Mt[Nt];Tr(y,C,zt,zt.viewport)}}else K.length>0&&br(lt,K,C,Z),Be&&Yt.render(C),Tr(y,C,Z);V!==null&&U===0&&(ne.updateMultisampleRenderTarget(V),ne.updateRenderTargetMipmap(V)),C.isScene===!0&&C.onAfterRender(D,C,Z),Lt.resetDefaultState(),A=-1,w=null,z.pop(),z.length>0?(_=z[z.length-1],Y===!0&&Rt.setGlobalState(D.clippingPlanes,_.state.camera)):_=null,I.pop(),I.length>0?y=I[I.length-1]:y=null};function Er(C,Z,ot,lt){if(C.visible===!1)return;if(C.layers.test(Z.layers)){if(C.isGroup)ot=C.renderOrder;else if(C.isLOD)C.autoUpdate===!0&&C.update(Z);else if(C.isLight)_.pushLight(C),C.castShadow&&_.pushShadow(C);else if(C.isSprite){if(!C.frustumCulled||pt.intersectsSprite(C)){lt&&Dt.setFromMatrixPosition(C.matrixWorld).applyMatrix4(ft);const Nt=at.update(C),Gt=C.material;Gt.visible&&y.push(C,Nt,Gt,ot,Dt.z,null)}}else if((C.isMesh||C.isLine||C.isPoints)&&(!C.frustumCulled||pt.intersectsObject(C))){const Nt=at.update(C),Gt=C.material;if(lt&&(C.boundingSphere!==void 0?(C.boundingSphere===null&&C.computeBoundingSphere(),Dt.copy(C.boundingSphere.center)):(Nt.boundingSphere===null&&Nt.computeBoundingSphere(),Dt.copy(Nt.boundingSphere.center)),Dt.applyMatrix4(C.matrixWorld).applyMatrix4(ft)),Array.isArray(Gt)){const zt=Nt.groups;for(let Kt=0,ee=zt.length;Kt<ee;Kt++){const Qt=zt[Kt],he=Gt[Qt.materialIndex];he&&he.visible&&y.push(C,Nt,he,ot,Dt.z,Qt)}}else Gt.visible&&y.push(C,Nt,Gt,ot,Dt.z,null)}}const Mt=C.children;for(let Nt=0,Gt=Mt.length;Nt<Gt;Nt++)Er(Mt[Nt],Z,ot,lt)}function Tr(C,Z,ot,lt){const K=C.opaque,Mt=C.transmissive,Nt=C.transparent;_.setupLightsView(ot),Y===!0&&Rt.setGlobalState(D.clippingPlanes,ot),lt&&Wt.viewport(N.copy(lt)),K.length>0&&Va(K,Z,ot),Mt.length>0&&Va(Mt,Z,ot),Nt.length>0&&Va(Nt,Z,ot),Wt.buffers.depth.setTest(!0),Wt.buffers.depth.setMask(!0),Wt.buffers.color.setMask(!0),Wt.setPolygonOffset(!1)}function br(C,Z,ot,lt){if((ot.isScene===!0?ot.overrideMaterial:null)!==null)return;_.state.transmissionRenderTarget[lt.id]===void 0&&(_.state.transmissionRenderTarget[lt.id]=new yr(1,1,{generateMipmaps:!0,type:Xt.has("EXT_color_buffer_half_float")||Xt.has("EXT_color_buffer_float")?Po:Li,minFilter:vr,samples:4,stencilBuffer:c,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:we.workingColorSpace}));const Mt=_.state.transmissionRenderTarget[lt.id],Nt=lt.viewport||N;Mt.setSize(Nt.z*D.transmissionResolutionScale,Nt.w*D.transmissionResolutionScale);const Gt=D.getRenderTarget(),zt=D.getActiveCubeFace(),Kt=D.getActiveMipmapLevel();D.setRenderTarget(Mt),D.getClearColor(rt),ct=D.getClearAlpha(),ct<1&&D.setClearColor(16777215,.5),D.clear(),Be&&Yt.render(ot);const ee=D.toneMapping;D.toneMapping=Ia;const Qt=lt.viewport;if(lt.viewport!==void 0&&(lt.viewport=void 0),_.setupLightsView(lt),Y===!0&&Rt.setGlobalState(D.clippingPlanes,lt),Va(C,ot,lt),ne.updateMultisampleRenderTarget(Mt),ne.updateRenderTargetMipmap(Mt),Xt.has("WEBGL_multisampled_render_to_texture")===!1){let he=!1;for(let Ue=0,Ve=Z.length;Ue<Ve;Ue++){const Le=Z[Ue],me=Le.object,Vt=Le.geometry,Xe=Le.material,Te=Le.group;if(Xe.side===aa&&me.layers.test(lt.layers)){const vn=Xe.side;Xe.side=Gn,Xe.needsUpdate=!0,Ns(me,ot,lt,Vt,Xe,Te),Xe.side=vn,Xe.needsUpdate=!0,he=!0}}he===!0&&(ne.updateMultisampleRenderTarget(Mt),ne.updateRenderTargetMipmap(Mt))}D.setRenderTarget(Gt,zt,Kt),D.setClearColor(rt,ct),Qt!==void 0&&(lt.viewport=Qt),D.toneMapping=ee}function Va(C,Z,ot){const lt=Z.isScene===!0?Z.overrideMaterial:null;for(let K=0,Mt=C.length;K<Mt;K++){const Nt=C[K],Gt=Nt.object,zt=Nt.geometry,Kt=Nt.group;let ee=Nt.material;ee.allowOverride===!0&&lt!==null&&(ee=lt),Gt.layers.test(ot.layers)&&Ns(Gt,Z,ot,zt,ee,Kt)}}function Ns(C,Z,ot,lt,K,Mt){C.onBeforeRender(D,Z,ot,lt,K,Mt),C.modelViewMatrix.multiplyMatrices(ot.matrixWorldInverse,C.matrixWorld),C.normalMatrix.getNormalMatrix(C.modelViewMatrix),K.onBeforeRender(D,Z,ot,lt,C,Mt),K.transparent===!0&&K.side===aa&&K.forceSinglePass===!1?(K.side=Gn,K.needsUpdate=!0,D.renderBufferDirect(ot,Z,lt,K,C,Mt),K.side=Ha,K.needsUpdate=!0,D.renderBufferDirect(ot,Z,lt,K,C,Mt),K.side=aa):D.renderBufferDirect(ot,Z,lt,K,C,Mt),C.onAfterRender(D,Z,ot,lt,K,Mt)}function kn(C,Z,ot){Z.isScene!==!0&&(Z=$t);const lt=Bt.get(C),K=_.state.lights,Mt=_.state.shadowsArray,Nt=K.state.version,Gt=gt.getParameters(C,K.state,Mt,Z,ot),zt=gt.getProgramCacheKey(Gt);let Kt=lt.programs;lt.environment=C.isMeshStandardMaterial?Z.environment:null,lt.fog=Z.fog,lt.envMap=(C.isMeshStandardMaterial?je:We).get(C.envMap||lt.environment),lt.envMapRotation=lt.environment!==null&&C.envMap===null?Z.environmentRotation:C.envMapRotation,Kt===void 0&&(C.addEventListener("dispose",xt),Kt=new Map,lt.programs=Kt);let ee=Kt.get(zt);if(ee!==void 0){if(lt.currentProgram===ee&&lt.lightsStateVersion===Nt)return _n(C,Gt),ee}else Gt.uniforms=gt.getUniforms(C),C.onBeforeCompile(Gt,D),ee=gt.acquireProgram(Gt,zt),Kt.set(zt,ee),lt.uniforms=Gt.uniforms;const Qt=lt.uniforms;return(!C.isShaderMaterial&&!C.isRawShaderMaterial||C.clipping===!0)&&(Qt.clippingPlanes=Rt.uniform),_n(C,Gt),lt.needsLights=Oc(C),lt.lightsStateVersion=Nt,lt.needsLights&&(Qt.ambientLightColor.value=K.state.ambient,Qt.lightProbe.value=K.state.probe,Qt.directionalLights.value=K.state.directional,Qt.directionalLightShadows.value=K.state.directionalShadow,Qt.spotLights.value=K.state.spot,Qt.spotLightShadows.value=K.state.spotShadow,Qt.rectAreaLights.value=K.state.rectArea,Qt.ltc_1.value=K.state.rectAreaLTC1,Qt.ltc_2.value=K.state.rectAreaLTC2,Qt.pointLights.value=K.state.point,Qt.pointLightShadows.value=K.state.pointShadow,Qt.hemisphereLights.value=K.state.hemi,Qt.directionalShadowMap.value=K.state.directionalShadowMap,Qt.directionalShadowMatrix.value=K.state.directionalShadowMatrix,Qt.spotShadowMap.value=K.state.spotShadowMap,Qt.spotLightMatrix.value=K.state.spotLightMatrix,Qt.spotLightMap.value=K.state.spotLightMap,Qt.pointShadowMap.value=K.state.pointShadowMap,Qt.pointShadowMatrix.value=K.state.pointShadowMatrix),lt.currentProgram=ee,lt.uniformsList=null,ee}function an(C){if(C.uniformsList===null){const Z=C.currentProgram.getUniforms();C.uniformsList=bc.seqWithValue(Z.seq,C.uniforms)}return C.uniformsList}function _n(C,Z){const ot=Bt.get(C);ot.outputColorSpace=Z.outputColorSpace,ot.batching=Z.batching,ot.batchingColor=Z.batchingColor,ot.instancing=Z.instancing,ot.instancingColor=Z.instancingColor,ot.instancingMorph=Z.instancingMorph,ot.skinning=Z.skinning,ot.morphTargets=Z.morphTargets,ot.morphNormals=Z.morphNormals,ot.morphColors=Z.morphColors,ot.morphTargetsCount=Z.morphTargetsCount,ot.numClippingPlanes=Z.numClippingPlanes,ot.numIntersection=Z.numClipIntersection,ot.vertexAlphas=Z.vertexAlphas,ot.vertexTangents=Z.vertexTangents,ot.toneMapping=Z.toneMapping}function oa(C,Z,ot,lt,K){Z.isScene!==!0&&(Z=$t),ne.resetTextureUnits();const Mt=Z.fog,Nt=lt.isMeshStandardMaterial?Z.environment:null,Gt=V===null?D.outputColorSpace:V.isXRRenderTarget===!0?V.texture.colorSpace:Rs,zt=(lt.isMeshStandardMaterial?je:We).get(lt.envMap||Nt),Kt=lt.vertexColors===!0&&!!ot.attributes.color&&ot.attributes.color.itemSize===4,ee=!!ot.attributes.tangent&&(!!lt.normalMap||lt.anisotropy>0),Qt=!!ot.morphAttributes.position,he=!!ot.morphAttributes.normal,Ue=!!ot.morphAttributes.color;let Ve=Ia;lt.toneMapped&&(V===null||V.isXRRenderTarget===!0)&&(Ve=D.toneMapping);const Le=ot.morphAttributes.position||ot.morphAttributes.normal||ot.morphAttributes.color,me=Le!==void 0?Le.length:0,Vt=Bt.get(lt),Xe=_.state.lights;if(Y===!0&&(mt===!0||C!==w)){const un=C===w&&lt.id===A;Rt.setState(lt,C,un)}let Te=!1;lt.version===Vt.__version?(Vt.needsLights&&Vt.lightsStateVersion!==Xe.state.version||Vt.outputColorSpace!==Gt||K.isBatchedMesh&&Vt.batching===!1||!K.isBatchedMesh&&Vt.batching===!0||K.isBatchedMesh&&Vt.batchingColor===!0&&K.colorTexture===null||K.isBatchedMesh&&Vt.batchingColor===!1&&K.colorTexture!==null||K.isInstancedMesh&&Vt.instancing===!1||!K.isInstancedMesh&&Vt.instancing===!0||K.isSkinnedMesh&&Vt.skinning===!1||!K.isSkinnedMesh&&Vt.skinning===!0||K.isInstancedMesh&&Vt.instancingColor===!0&&K.instanceColor===null||K.isInstancedMesh&&Vt.instancingColor===!1&&K.instanceColor!==null||K.isInstancedMesh&&Vt.instancingMorph===!0&&K.morphTexture===null||K.isInstancedMesh&&Vt.instancingMorph===!1&&K.morphTexture!==null||Vt.envMap!==zt||lt.fog===!0&&Vt.fog!==Mt||Vt.numClippingPlanes!==void 0&&(Vt.numClippingPlanes!==Rt.numPlanes||Vt.numIntersection!==Rt.numIntersection)||Vt.vertexAlphas!==Kt||Vt.vertexTangents!==ee||Vt.morphTargets!==Qt||Vt.morphNormals!==he||Vt.morphColors!==Ue||Vt.toneMapping!==Ve||Vt.morphTargetsCount!==me)&&(Te=!0):(Te=!0,Vt.__version=lt.version);let vn=Vt.currentProgram;Te===!0&&(vn=kn(lt,Z,K));let Oi=!1,pn=!1,Xa=!1;const ve=vn.getUniforms(),En=Vt.uniforms;if(Wt.useProgram(vn.program)&&(Oi=!0,pn=!0,Xa=!0),lt.id!==A&&(A=lt.id,pn=!0),Oi||w!==C){Wt.buffers.depth.getReversed()&&C.reversedDepth!==!0&&(C._reversedDepth=!0,C.updateProjectionMatrix()),ve.setValue(G,"projectionMatrix",C.projectionMatrix),ve.setValue(G,"viewMatrix",C.matrixWorldInverse);const tn=ve.map.cameraPosition;tn!==void 0&&tn.setValue(G,Ut.setFromMatrixPosition(C.matrixWorld)),pe.logarithmicDepthBuffer&&ve.setValue(G,"logDepthBufFC",2/(Math.log(C.far+1)/Math.LN2)),(lt.isMeshPhongMaterial||lt.isMeshToonMaterial||lt.isMeshLambertMaterial||lt.isMeshBasicMaterial||lt.isMeshStandardMaterial||lt.isShaderMaterial)&&ve.setValue(G,"isOrthographic",C.isOrthographicCamera===!0),w!==C&&(w=C,pn=!0,Xa=!0)}if(K.isSkinnedMesh){ve.setOptional(G,K,"bindMatrix"),ve.setOptional(G,K,"bindMatrixInverse");const un=K.skeleton;un&&(un.boneTexture===null&&un.computeBoneTexture(),ve.setValue(G,"boneTexture",un.boneTexture,ne))}K.isBatchedMesh&&(ve.setOptional(G,K,"batchingTexture"),ve.setValue(G,"batchingTexture",K._matricesTexture,ne),ve.setOptional(G,K,"batchingIdTexture"),ve.setValue(G,"batchingIdTexture",K._indirectTexture,ne),ve.setOptional(G,K,"batchingColorTexture"),K._colorsTexture!==null&&ve.setValue(G,"batchingColorTexture",K._colorsTexture,ne));const Dn=ot.morphAttributes;if((Dn.position!==void 0||Dn.normal!==void 0||Dn.color!==void 0)&&bt.update(K,ot,vn),(pn||Vt.receiveShadow!==K.receiveShadow)&&(Vt.receiveShadow=K.receiveShadow,ve.setValue(G,"receiveShadow",K.receiveShadow)),lt.isMeshGouraudMaterial&&lt.envMap!==null&&(En.envMap.value=zt,En.flipEnvMap.value=zt.isCubeTexture&&zt.isRenderTargetTexture===!1?-1:1),lt.isMeshStandardMaterial&&lt.envMap===null&&Z.environment!==null&&(En.envMapIntensity.value=Z.environmentIntensity),pn&&(ve.setValue(G,"toneMappingExposure",D.toneMappingExposure),Vt.needsLights&&Os(En,Xa),Mt&&lt.fog===!0&&Et.refreshFogUniforms(En,Mt),Et.refreshMaterialUniforms(En,lt,j,q,_.state.transmissionRenderTarget[C.id]),bc.upload(G,an(Vt),En,ne)),lt.isShaderMaterial&&lt.uniformsNeedUpdate===!0&&(bc.upload(G,an(Vt),En,ne),lt.uniformsNeedUpdate=!1),lt.isSpriteMaterial&&ve.setValue(G,"center",K.center),ve.setValue(G,"modelViewMatrix",K.modelViewMatrix),ve.setValue(G,"normalMatrix",K.normalMatrix),ve.setValue(G,"modelMatrix",K.matrixWorld),lt.isShaderMaterial||lt.isRawShaderMaterial){const un=lt.uniformsGroups;for(let tn=0,Ar=un.length;tn<Ar;tn++){const Ei=un[tn];re.update(Ei,vn),re.bind(Ei,vn)}}return vn}function Os(C,Z){C.ambientLightColor.needsUpdate=Z,C.lightProbe.needsUpdate=Z,C.directionalLights.needsUpdate=Z,C.directionalLightShadows.needsUpdate=Z,C.pointLights.needsUpdate=Z,C.pointLightShadows.needsUpdate=Z,C.spotLights.needsUpdate=Z,C.spotLightShadows.needsUpdate=Z,C.rectAreaLights.needsUpdate=Z,C.hemisphereLights.needsUpdate=Z}function Oc(C){return C.isMeshLambertMaterial||C.isMeshToonMaterial||C.isMeshPhongMaterial||C.isMeshStandardMaterial||C.isShadowMaterial||C.isShaderMaterial&&C.lights===!0}this.getActiveCubeFace=function(){return L},this.getActiveMipmapLevel=function(){return U},this.getRenderTarget=function(){return V},this.setRenderTargetTextures=function(C,Z,ot){const lt=Bt.get(C);lt.__autoAllocateDepthBuffer=C.resolveDepthBuffer===!1,lt.__autoAllocateDepthBuffer===!1&&(lt.__useRenderToTexture=!1),Bt.get(C.texture).__webglTexture=Z,Bt.get(C.depthTexture).__webglTexture=lt.__autoAllocateDepthBuffer?void 0:ot,lt.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(C,Z){const ot=Bt.get(C);ot.__webglFramebuffer=Z,ot.__useDefaultFramebuffer=Z===void 0};const zc=G.createFramebuffer();this.setRenderTarget=function(C,Z=0,ot=0){V=C,L=Z,U=ot;let lt=!0,K=null,Mt=!1,Nt=!1;if(C){const zt=Bt.get(C);if(zt.__useDefaultFramebuffer!==void 0)Wt.bindFramebuffer(G.FRAMEBUFFER,null),lt=!1;else if(zt.__webglFramebuffer===void 0)ne.setupRenderTarget(C);else if(zt.__hasExternalTextures)ne.rebindTextures(C,Bt.get(C.texture).__webglTexture,Bt.get(C.depthTexture).__webglTexture);else if(C.depthBuffer){const Qt=C.depthTexture;if(zt.__boundDepthTexture!==Qt){if(Qt!==null&&Bt.has(Qt)&&(C.width!==Qt.image.width||C.height!==Qt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");ne.setupDepthRenderbuffer(C)}}const Kt=C.texture;(Kt.isData3DTexture||Kt.isDataArrayTexture||Kt.isCompressedArrayTexture)&&(Nt=!0);const ee=Bt.get(C).__webglFramebuffer;C.isWebGLCubeRenderTarget?(Array.isArray(ee[Z])?K=ee[Z][ot]:K=ee[Z],Mt=!0):C.samples>0&&ne.useMultisampledRTT(C)===!1?K=Bt.get(C).__webglMultisampledFramebuffer:Array.isArray(ee)?K=ee[ot]:K=ee,N.copy(C.viewport),J.copy(C.scissor),tt=C.scissorTest}else N.copy(P).multiplyScalar(j).floor(),J.copy(et).multiplyScalar(j).floor(),tt=X;if(ot!==0&&(K=zc),Wt.bindFramebuffer(G.FRAMEBUFFER,K)&&lt&&Wt.drawBuffers(C,K),Wt.viewport(N),Wt.scissor(J),Wt.setScissorTest(tt),Mt){const zt=Bt.get(C.texture);G.framebufferTexture2D(G.FRAMEBUFFER,G.COLOR_ATTACHMENT0,G.TEXTURE_CUBE_MAP_POSITIVE_X+Z,zt.__webglTexture,ot)}else if(Nt){const zt=Z;for(let Kt=0;Kt<C.textures.length;Kt++){const ee=Bt.get(C.textures[Kt]);G.framebufferTextureLayer(G.FRAMEBUFFER,G.COLOR_ATTACHMENT0+Kt,ee.__webglTexture,ot,zt)}}else if(C!==null&&ot!==0){const zt=Bt.get(C.texture);G.framebufferTexture2D(G.FRAMEBUFFER,G.COLOR_ATTACHMENT0,G.TEXTURE_2D,zt.__webglTexture,ot)}A=-1},this.readRenderTargetPixels=function(C,Z,ot,lt,K,Mt,Nt,Gt=0){if(!(C&&C.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let zt=Bt.get(C).__webglFramebuffer;if(C.isWebGLCubeRenderTarget&&Nt!==void 0&&(zt=zt[Nt]),zt){Wt.bindFramebuffer(G.FRAMEBUFFER,zt);try{const Kt=C.textures[Gt],ee=Kt.format,Qt=Kt.type;if(!pe.textureFormatReadable(ee)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!pe.textureTypeReadable(Qt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}Z>=0&&Z<=C.width-lt&&ot>=0&&ot<=C.height-K&&(C.textures.length>1&&G.readBuffer(G.COLOR_ATTACHMENT0+Gt),G.readPixels(Z,ot,lt,K,Pt.convert(ee),Pt.convert(Qt),Mt))}finally{const Kt=V!==null?Bt.get(V).__webglFramebuffer:null;Wt.bindFramebuffer(G.FRAMEBUFFER,Kt)}}},this.readRenderTargetPixelsAsync=async function(C,Z,ot,lt,K,Mt,Nt,Gt=0){if(!(C&&C.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let zt=Bt.get(C).__webglFramebuffer;if(C.isWebGLCubeRenderTarget&&Nt!==void 0&&(zt=zt[Nt]),zt)if(Z>=0&&Z<=C.width-lt&&ot>=0&&ot<=C.height-K){Wt.bindFramebuffer(G.FRAMEBUFFER,zt);const Kt=C.textures[Gt],ee=Kt.format,Qt=Kt.type;if(!pe.textureFormatReadable(ee))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!pe.textureTypeReadable(Qt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const he=G.createBuffer();G.bindBuffer(G.PIXEL_PACK_BUFFER,he),G.bufferData(G.PIXEL_PACK_BUFFER,Mt.byteLength,G.STREAM_READ),C.textures.length>1&&G.readBuffer(G.COLOR_ATTACHMENT0+Gt),G.readPixels(Z,ot,lt,K,Pt.convert(ee),Pt.convert(Qt),0);const Ue=V!==null?Bt.get(V).__webglFramebuffer:null;Wt.bindFramebuffer(G.FRAMEBUFFER,Ue);const Ve=G.fenceSync(G.SYNC_GPU_COMMANDS_COMPLETE,0);return G.flush(),await Ly(G,Ve,4),G.bindBuffer(G.PIXEL_PACK_BUFFER,he),G.getBufferSubData(G.PIXEL_PACK_BUFFER,0,Mt),G.deleteBuffer(he),G.deleteSync(Ve),Mt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(C,Z=null,ot=0){const lt=Math.pow(2,-ot),K=Math.floor(C.image.width*lt),Mt=Math.floor(C.image.height*lt),Nt=Z!==null?Z.x:0,Gt=Z!==null?Z.y:0;ne.setTexture2D(C,0),G.copyTexSubImage2D(G.TEXTURE_2D,ot,0,0,Nt,Gt,K,Mt),Wt.unbindTexture()};const Ho=G.createFramebuffer(),ka=G.createFramebuffer();this.copyTextureToTexture=function(C,Z,ot=null,lt=null,K=0,Mt=null){Mt===null&&(K!==0?(Ms("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),Mt=K,K=0):Mt=0);let Nt,Gt,zt,Kt,ee,Qt,he,Ue,Ve;const Le=C.isCompressedTexture?C.mipmaps[Mt]:C.image;if(ot!==null)Nt=ot.max.x-ot.min.x,Gt=ot.max.y-ot.min.y,zt=ot.isBox3?ot.max.z-ot.min.z:1,Kt=ot.min.x,ee=ot.min.y,Qt=ot.isBox3?ot.min.z:0;else{const Dn=Math.pow(2,-K);Nt=Math.floor(Le.width*Dn),Gt=Math.floor(Le.height*Dn),C.isDataArrayTexture?zt=Le.depth:C.isData3DTexture?zt=Math.floor(Le.depth*Dn):zt=1,Kt=0,ee=0,Qt=0}lt!==null?(he=lt.x,Ue=lt.y,Ve=lt.z):(he=0,Ue=0,Ve=0);const me=Pt.convert(Z.format),Vt=Pt.convert(Z.type);let Xe;Z.isData3DTexture?(ne.setTexture3D(Z,0),Xe=G.TEXTURE_3D):Z.isDataArrayTexture||Z.isCompressedArrayTexture?(ne.setTexture2DArray(Z,0),Xe=G.TEXTURE_2D_ARRAY):(ne.setTexture2D(Z,0),Xe=G.TEXTURE_2D),G.pixelStorei(G.UNPACK_FLIP_Y_WEBGL,Z.flipY),G.pixelStorei(G.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Z.premultiplyAlpha),G.pixelStorei(G.UNPACK_ALIGNMENT,Z.unpackAlignment);const Te=G.getParameter(G.UNPACK_ROW_LENGTH),vn=G.getParameter(G.UNPACK_IMAGE_HEIGHT),Oi=G.getParameter(G.UNPACK_SKIP_PIXELS),pn=G.getParameter(G.UNPACK_SKIP_ROWS),Xa=G.getParameter(G.UNPACK_SKIP_IMAGES);G.pixelStorei(G.UNPACK_ROW_LENGTH,Le.width),G.pixelStorei(G.UNPACK_IMAGE_HEIGHT,Le.height),G.pixelStorei(G.UNPACK_SKIP_PIXELS,Kt),G.pixelStorei(G.UNPACK_SKIP_ROWS,ee),G.pixelStorei(G.UNPACK_SKIP_IMAGES,Qt);const ve=C.isDataArrayTexture||C.isData3DTexture,En=Z.isDataArrayTexture||Z.isData3DTexture;if(C.isDepthTexture){const Dn=Bt.get(C),un=Bt.get(Z),tn=Bt.get(Dn.__renderTarget),Ar=Bt.get(un.__renderTarget);Wt.bindFramebuffer(G.READ_FRAMEBUFFER,tn.__webglFramebuffer),Wt.bindFramebuffer(G.DRAW_FRAMEBUFFER,Ar.__webglFramebuffer);for(let Ei=0;Ei<zt;Ei++)ve&&(G.framebufferTextureLayer(G.READ_FRAMEBUFFER,G.COLOR_ATTACHMENT0,Bt.get(C).__webglTexture,K,Qt+Ei),G.framebufferTextureLayer(G.DRAW_FRAMEBUFFER,G.COLOR_ATTACHMENT0,Bt.get(Z).__webglTexture,Mt,Ve+Ei)),G.blitFramebuffer(Kt,ee,Nt,Gt,he,Ue,Nt,Gt,G.DEPTH_BUFFER_BIT,G.NEAREST);Wt.bindFramebuffer(G.READ_FRAMEBUFFER,null),Wt.bindFramebuffer(G.DRAW_FRAMEBUFFER,null)}else if(K!==0||C.isRenderTargetTexture||Bt.has(C)){const Dn=Bt.get(C),un=Bt.get(Z);Wt.bindFramebuffer(G.READ_FRAMEBUFFER,Ho),Wt.bindFramebuffer(G.DRAW_FRAMEBUFFER,ka);for(let tn=0;tn<zt;tn++)ve?G.framebufferTextureLayer(G.READ_FRAMEBUFFER,G.COLOR_ATTACHMENT0,Dn.__webglTexture,K,Qt+tn):G.framebufferTexture2D(G.READ_FRAMEBUFFER,G.COLOR_ATTACHMENT0,G.TEXTURE_2D,Dn.__webglTexture,K),En?G.framebufferTextureLayer(G.DRAW_FRAMEBUFFER,G.COLOR_ATTACHMENT0,un.__webglTexture,Mt,Ve+tn):G.framebufferTexture2D(G.DRAW_FRAMEBUFFER,G.COLOR_ATTACHMENT0,G.TEXTURE_2D,un.__webglTexture,Mt),K!==0?G.blitFramebuffer(Kt,ee,Nt,Gt,he,Ue,Nt,Gt,G.COLOR_BUFFER_BIT,G.NEAREST):En?G.copyTexSubImage3D(Xe,Mt,he,Ue,Ve+tn,Kt,ee,Nt,Gt):G.copyTexSubImage2D(Xe,Mt,he,Ue,Kt,ee,Nt,Gt);Wt.bindFramebuffer(G.READ_FRAMEBUFFER,null),Wt.bindFramebuffer(G.DRAW_FRAMEBUFFER,null)}else En?C.isDataTexture||C.isData3DTexture?G.texSubImage3D(Xe,Mt,he,Ue,Ve,Nt,Gt,zt,me,Vt,Le.data):Z.isCompressedArrayTexture?G.compressedTexSubImage3D(Xe,Mt,he,Ue,Ve,Nt,Gt,zt,me,Le.data):G.texSubImage3D(Xe,Mt,he,Ue,Ve,Nt,Gt,zt,me,Vt,Le):C.isDataTexture?G.texSubImage2D(G.TEXTURE_2D,Mt,he,Ue,Nt,Gt,me,Vt,Le.data):C.isCompressedTexture?G.compressedTexSubImage2D(G.TEXTURE_2D,Mt,he,Ue,Le.width,Le.height,me,Le.data):G.texSubImage2D(G.TEXTURE_2D,Mt,he,Ue,Nt,Gt,me,Vt,Le);G.pixelStorei(G.UNPACK_ROW_LENGTH,Te),G.pixelStorei(G.UNPACK_IMAGE_HEIGHT,vn),G.pixelStorei(G.UNPACK_SKIP_PIXELS,Oi),G.pixelStorei(G.UNPACK_SKIP_ROWS,pn),G.pixelStorei(G.UNPACK_SKIP_IMAGES,Xa),Mt===0&&Z.generateMipmaps&&G.generateMipmap(Xe),Wt.unbindTexture()},this.copyTextureToTexture3D=function(C,Z,ot=null,lt=null,K=0){return Ms('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(C,Z,ot,lt,K)},this.initRenderTarget=function(C){Bt.get(C).__webglFramebuffer===void 0&&ne.setupRenderTarget(C)},this.initTexture=function(C){C.isCubeTexture?ne.setTextureCube(C,0):C.isData3DTexture?ne.setTexture3D(C,0):C.isDataArrayTexture||C.isCompressedArrayTexture?ne.setTexture2DArray(C,0):ne.setTexture2D(C,0),Wt.unbindTexture()},this.resetState=function(){L=0,U=0,V=null,Wt.reset(),Lt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Di}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const i=this.getContext();i.drawingBufferColorSpace=we._getDrawingBufferColorSpace(e),i.unpackColorSpace=we._getUnpackColorSpace()}}const M_=[.32,.5,.72],Qb="0.0.22",E_=`https://cdn.jsdelivr.net/npm/occt-import-js@${Qb}/dist/`,Md=[{id:"pla",label:"PLA",tensile:37,flexural:80,density:1.24},{id:"petg",label:"PETG",tensile:53,flexural:72,density:1.27},{id:"abs",label:"ABS",tensile:40,flexural:68,density:1.05},{id:"asa",label:"ASA",tensile:48,flexural:74,density:1.07},{id:"tpu",label:"TPU 95A",tensile:30,flexural:12,density:1.21},{id:"nylon",label:"Nylon PA12",tensile:48,flexural:68,density:1.01},{id:"pc",label:"Polycarbonate",tensile:68,flexural:90,density:1.2},{id:"cf_pla",label:"CF-PLA",tensile:58,flexural:102,density:1.3}],_c={critical:{color:"#ff3d3d",bg:"#2a0808"},high:{color:"#ff8c42",bg:"#261508"},medium:{color:"#ffd166",bg:"#261e08"},low:{color:"#06d6a0",bg:"#08261e"}},T_=[{label:"+X",vec:[1,0,0]},{label:"-X",vec:[-1,0,0]},{label:"+Y",vec:[0,1,0]},{label:"-Y",vec:[0,-1,0]},{label:"+Z",vec:[0,0,1]},{label:"-Z",vec:[0,0,-1]}],dh=[{id:"poor",label:"Poor",factor:.32},{id:"normal",label:"Normal",factor:.45},{id:"tuned",label:"Tuned",factor:.58}],b_={flat:new $(0,1,0),upright:new $(0,0,1),angled:new $(.707,.707,0)};let vc=null;function Jb(){return typeof window<"u"&&typeof document<"u"}function uv(s,e,i){if(!s||s.byteLength<e)throw new Error(i)}function $b(s){uv(s,84,"STL file is too small to be valid.");const e=new TextDecoder("utf-8",{fatal:!1}).decode(s.slice(0,256));if(e.trimStart().startsWith("solid")&&!e.includes("\0"))try{return tA(new TextDecoder("utf-8",{fatal:!1}).decode(s))}catch{return A_(s)}return A_(s)}function A_(s){uv(s,84,"Binary STL file is missing its header.");const e=new DataView(s),i=e.getUint32(80,!0),r=84+i*50;if(i<=0||r>s.byteLength)throw new Error("Binary STL triangle count is invalid or truncated.");const l=new Float32Array(i*9),c=new Float32Array(i*9);let d=84,h=0;for(let m=0;m<i;m+=1){const p=e.getFloat32(d,!0),v=e.getFloat32(d+4,!0),g=e.getFloat32(d+8,!0);d+=12;for(let S=0;S<3;S+=1)l[h]=e.getFloat32(d,!0),l[h+1]=e.getFloat32(d+4,!0),l[h+2]=e.getFloat32(d+8,!0),c[h]=p,c[h+1]=v,c[h+2]=g,h+=3,d+=12;d+=2}return{positions:l,normals:c,triangleCount:i}}function tA(s){const e=[],i=[],r=/facet\s+normal\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)[\s\S]*?outer\s+loop([\s\S]*?)endloop/gi,l=/vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;let c;for(;c=r.exec(s);){const d=[Number(c[1]),Number(c[2]),Number(c[3])],h=[...c[4].matchAll(l)];h.length===3&&h.forEach(m=>{e.push(Number(m[1]),Number(m[2]),Number(m[3])),i.push(...d)})}if(e.length===0||e.length%9!==0)throw new Error("ASCII STL contained no valid triangular facets.");return{positions:new Float32Array(e),normals:new Float32Array(i),triangleCount:e.length/9}}function eA(){return Jb()?vc||(vc=new Promise((s,e)=>{const i=()=>{window.occtimportjs({locateFile:l=>`${E_}${l}`}).then(s).catch(e)};if(window.occtimportjs){i();return}const r=document.createElement("script");r.src=`${E_}occt-import-js.js`,r.async=!0,r.onload=i,r.onerror=()=>e(new Error("Failed to load the OCCT STEP engine.")),document.head.appendChild(r)}),vc):Promise.reject(new Error("STEP parsing is only available in a browser."))}async function nA(s,e=()=>{}){e("Loading STEP engine...");const i=await eA();e("Tessellating STEP geometry...");const r=i.ReadStepFile(new Uint8Array(s),{linearDeflection:.1,angularDeflection:.5});if(!r?.success)throw new Error("STEP parse failed. The file may be corrupt or unsupported.");const l=[],c=[];for(const d of r.meshes??[]){const h=d.attributes?.position?.array,m=d.attributes?.normal?.array;if(h?.length)if(d.index?.array?.length)for(const p of d.index.array){const v=p*3;l.push(h[v],h[v+1],h[v+2]),c.push(m?.[v]??0,m?.[v+1]??1,m?.[v+2]??0)}else for(let p=0;p<h.length;p+=3)l.push(h[p],h[p+1],h[p+2]),c.push(m?.[p]??0,m?.[p+1]??1,m?.[p+2]??0)}if(l.length===0||l.length%9!==0)throw new Error("STEP file contained no triangular mesh geometry.");return{positions:new Float32Array(l),normals:new Float32Array(c),triangleCount:l.length/9}}function iA(s){const{positions:e}=s;let i=1/0,r=-1/0,l=1/0,c=-1/0,d=1/0,h=-1/0;for(let m=0;m<e.length;m+=3)i=Math.min(i,e[m]),r=Math.max(r,e[m]),l=Math.min(l,e[m+1]),c=Math.max(c,e[m+1]),d=Math.min(d,e[m+2]),h=Math.max(h,e[m+2]);return{triangles:s.triangleCount,dims:{x:r-i,y:c-l,z:h-d},bounds:{minX:i,maxX:r,minY:l,maxY:c,minZ:d,maxZ:h}}}function aA(s){const e=[[.08,.2,.85],[0,.75,.85],[.1,.82,.2],[1,.82,0],[1,.1,.05]],i=Ui.clamp(s,0,1)*(e.length-1),r=Math.min(Math.floor(i),e.length-2),l=i-r;return e[r].map((c,d)=>c+l*(e[r+1][d]-c))}function Lh(s){const e=new $(...s);return e.lengthSq()>0?e.normalize():new $(0,-1,0)}function rA(s,e,i,r){const l=new xr,c=Lh(s),d=i*.78,h=i*.22,m=new Dh({color:r,emissive:r,emissiveIntensity:.3}),p=new Hn(new Uc(i*.03,i*.03,d,10),m),v=new Hn(new Rh(i*.09,h,12),m);return p.position.y=d/2,v.position.y=d+h/2,l.add(p,v),l.position.copy(e),l.setRotationFromQuaternion(new Mr().setFromUnitVectors(new $(0,1,0),c)),l}function sA(s,e,i=58879){const r=new xr,l=new Dh({color:i,emissive:i,emissiveIntensity:.4,transparent:!0,opacity:.9}),c=new Hn(new Ch(.04,16,16),l),d=new Hn(new wh(.07,.012,8,28),l),h=e.lengthSq()>0?e.clone().normalize():new $(0,0,1);return d.setRotationFromQuaternion(new Mr().setFromUnitVectors(new $(0,0,1),h)),r.position.copy(s),r.add(c,d),r}function Ed(s){s.traverse(e=>{e.geometry&&e.geometry.dispose(),Array.isArray(e.material)?e.material.forEach(i=>i.dispose()):e.material&&e.material.dispose()})}function R_(s,e){return new $(s.x,s.y,s.z).sub(e)}function oA(s){return(b_[s.orientation]??b_.flat).clone().normalize()}function lA(s){return dh.find(e=>e.id===s.layerAdhesion)??dh[1]}function fv(s,e){const r=[...[s.dims.x,s.dims.y,s.dims.z].map(g=>Math.max(g,1))].sort((g,S)=>g-S),l=r[0],c=r[1],d=r[2],h=Math.max(e.wallCount*e.lineWidth,e.nozzleDiameter),m=Ui.clamp(2*h/Math.max(l,.1),.08,.92),p=Ui.clamp(e.infill/100,.05,1),v=Ui.clamp(m+(1-m)*p*.55,.08,1);return{minDim:l,midDim:c,maxDim:d,wallThickness:h,shellRatio:m,infillRatio:p,effectiveAreaRatio:v}}function dv(s,e){const i=lA(e),r=e.enclosure?1.08:.94,l=Ui.clamp(e.nozzleDiameter/Math.max(e.layerHeight,.05)/2,.72,1.18),c=Ui.clamp(.65+e.wallCount*.07,.72,1.28),d=.32+e.infill/100*.48,h=s.tensile*c*d*r,m=h*i.factor*l,p=s.flexural*(.38+e.infill/140)*c*r,v=Math.min(m*.62,s.tensile*i.factor*.72);return{xyTensile:h,zTensile:m,xyFlexural:p,zShear:v,adhesion:i,layerHeightFactor:l,chamberFactor:r}}function hv(s,e){const i=oA(e),r=Math.max(s.reduce((d,h)=>d+h.magnitude,0),1);let l=0,c=0;for(const d of s){const h=Lh(d.dir),m=Math.abs(h.dot(i));l+=d.magnitude*m,c+=d.magnitude*Math.sqrt(Math.max(0,1-m*m))}return{buildAxis:i,peelRatio:l/r,shearRatio:c/r}}function Td(s){return s<1?"critical":s<1.5?"high":s<2.25?"medium":"low"}function cA({stlData:s,stlStats:e,bolts:i,forces:r,material:l,settings:c}){const d=s.positions.length/3,h=new Float32Array(d),{minX:m,maxX:p,minY:v,maxY:g,minZ:S,maxZ:M}=e.bounds,T=p-m||1,R=g-v||1,y=M-S||1,_=Math.max(...r.map(L=>L.magnitude),1),I=dv(l,c),z=fv(e,c),D=hv(r,c),H=Ui.clamp(1-I.zTensile/Math.max(I.xyTensile,1),0,.45);for(let L=0;L<d;L+=1){const U=s.positions[L*3],V=s.positions[L*3+1],A=s.positions[L*3+2],w=(U-m)/T,N=(V-v)/R,J=(A-S)/y;let tt=.08;for(const St of i){const P=(U-St.origPos.x)/T,et=(V-St.origPos.y)/R,X=(A-St.origPos.z)/y,pt=Math.sqrt(P*P+et*et+X*X);pt<.22&&(tt=Math.max(tt,.55*(1-pt/.22)))}for(const St of r){const P=Math.min(1,St.magnitude/_),et=(U-St.origPos.x)/T,X=(V-St.origPos.y)/R,pt=(A-St.origPos.z)/y,Y=Math.sqrt(et*et+X*X+pt*pt);Y<.28&&(tt=Math.max(tt,(.45+.35*P)*(1-Y/.28)));const mt=i.reduce((ft,Ut)=>{const Dt=((St.origPos.x-Ut.origPos.x)/T)**2+((St.origPos.y-Ut.origPos.y)/R)**2+((St.origPos.z-Ut.origPos.z)/y)**2;return Dt<ft.distance?{bolt:Ut,distance:Dt}:ft},{bolt:i[0],distance:1/0}).bolt;if(mt){const ft=(St.origPos.x-m)/T,Ut=(St.origPos.y-v)/R,Dt=(St.origPos.z-S)/y,$t=(mt.origPos.x-m)/T,Be=(mt.origPos.y-v)/R,fe=(mt.origPos.z-S)/y,G=$t-ft,de=Be-Ut,Xt=fe-Dt,pe=G*G+de*de+Xt*Xt;if(pe>1e-4){const Wt=Ui.clamp(((w-ft)*G+(N-Ut)*de+(J-Dt)*Xt)/pe,0,1),Ne=ft+Wt*G,Bt=Ut+Wt*de,ne=Dt+Wt*Xt,We=Math.sqrt((w-Ne)**2+(N-Bt)**2+(J-ne)**2);We<.1&&(tt=Math.max(tt,(.34+.22*P)*(1-We/.1)))}}}const rt=new $(w-.5,N-.5,J-.5),ct=Math.abs(rt.dot(D.buildAxis)),q=Math.max(Math.abs(w-.5),Math.abs(N-.5),Math.abs(J-.5))*2>1-z.shellRatio?.1:0,j=H*(.35+ct)*(.55+D.peelRatio),yt=Math.max(0,.35-z.infillRatio)*.22;h[L]=Ui.clamp(tt+q+j+yt,0,1)}return h}function uA({stlStats:s,bolts:e,forces:i,material:r,settings:l}){const c=i.reduce((ct,B)=>ct+B.magnitude,0),d=fv(s,l),h=dv(r,l),m=hv(i,l),p=d.maxDim,v=d.minDim,g=h.xyTensile*d.effectiveAreaRatio,S=h.zTensile*d.effectiveAreaRatio,M=Math.max(1,e.length*.65),T=v*d.midDim,R=Math.max(T*d.effectiveAreaRatio,1),y=c*p/Math.max(d.wallThickness*d.midDim*M*7.5,1),_=c/R,I=Math.max(y,_),z=c*m.peelRatio/Math.max(R*.55,1),D=c*m.shearRatio/Math.max(R*.75,1),H=c/Math.max(e.length*d.wallThickness*Math.max(l.nozzleDiameter*4,1),1),L=Math.max(.1,g/Math.max(I,.1)),U=Math.max(.1,S/Math.max(z+D*.45,.1)),V=Math.max(.1,h.xyTensile*.78/Math.max(H,.1)),A=Math.min(L,U,V),w=c*p/Math.max(h.xyFlexural*650*M*d.wallThickness,1),N=Math.max(1,h.xyFlexural*d.wallThickness*d.midDim*(.35+l.infill/120)/Math.max(p/45,1)),J=N/Math.max(c,1),tt=Td(Math.min(A,J)),rt=[["bulk bending/tension",L],["layer delamination",U],["bolt bearing/crush",V],["buckling",J]].sort((ct,B)=>ct[1]-B[1])[0];return{safetyFactor:A,bulkSafetyFactor:L,layerSafetyFactor:U,bearingSafetyFactor:V,bucklingSafetyFactor:J,maxStress:I,layerPeelStress:z,layerShearStress:D,effectiveStrength:g,zStrength:S,wallThickness:d.wallThickness,shellRatio:d.shellRatio,controllingMode:rt[0],displacement:w,bucklingLoad:N,overallRisk:tt,summary:`The controlling print-specific risk is ${rt[0]} with an estimated safety factor of ${rt[1].toFixed(2)}. This screening model accounts for shell thickness, infill efficiency, layer adhesion, build orientation, and load direction, but it is not a certified solver.`,failureModes:[{name:"Bolt-zone stress concentration",severity:Td(V),location:`${e[0]?.label??"B1"} and nearby load paths`,description:"Printed plastic can crush or split around fixed constraints because load enters through a small shell area before reaching the infill.",recommendation:"Increase boss diameter, add washers or heat-set inserts, add fillets, and keep at least 4-6 walls around mounting holes."},{name:"Layer delamination",severity:Td(U),location:`${l.orientation} print orientation`,description:"Forces with a component along the build axis load the weaker layer bonds instead of continuous extrusion roads.",recommendation:"Rotate the print so main tensile loads run in the XY plane, lower layer height, improve temperature tuning, or use an enclosure."},{name:"Sparse infill shear lag",severity:l.infill<30?"high":l.infill<50?"medium":"low",location:"Between outer walls and internal infill",description:"The outer shell carries most local stress while infill contributes less efficiently, especially near point loads.",recommendation:"Increase wall count first, then raise infill density or use a stronger infill pattern around load paths."}],printRecommendations:[`Target wall thickness is ${d.wallThickness.toFixed(2)} mm; increase walls if bolt or force areas are small.`,`Estimated Z strength is ${S.toFixed(1)} MPa versus ${g.toFixed(1)} MPa in-plane, so orientation matters.`,"For safety-critical parts, validate with real material coupons and a solver that supports anisotropic FDM material properties."]}}function fA({stlData:s,stressWeights:e,showStress:i,bolts:r,forces:l,mode:c,onPickPoint:d}){const h=ue.useRef(null),m=ue.useRef(null),p=ue.useRef(null),v=ue.useRef(null),g=ue.useRef(null),S=ue.useRef(null),M=ue.useRef(null),T=ue.useRef({isDown:!1,moved:!1,x:0,y:0}),R=ue.useRef({x:.3,y:.5}),y=ue.useRef(3);ue.useEffect(()=>{const L=h.current;if(!L)return;const U=Math.max(L.clientWidth,1),V=Math.max(L.clientHeight,1),A=new Kb({antialias:!0,alpha:!0}),w=new iM,N=new fi(45,U/V,.001,1e3),J=new Z0(16774624,1.2),tt=new Z0(13691135,.5);A.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),A.setSize(U,V),N.position.set(0,0,y.current),J.position.set(2,4,3),tt.position.set(-3,-1,-2),w.add(new fM(16777215,.45),J,tt),L.appendChild(A.domElement),p.current=A,m.current=w,v.current=N;const rt=()=>{M.current=requestAnimationFrame(rt),A.render(w,N)},ct=()=>{const B=Math.max(L.clientWidth,1),q=Math.max(L.clientHeight,1);A.setSize(B,q),N.aspect=B/q,N.updateProjectionMatrix()};return rt(),window.addEventListener("resize",ct),()=>{cancelAnimationFrame(M.current),window.removeEventListener("resize",ct),g.current&&Ed(g.current),A.dispose(),A.forceContextLoss(),L.contains(A.domElement)&&L.removeChild(A.domElement)}},[]),ue.useEffect(()=>{const L=m.current;if(!L||!s)return;g.current&&(L.remove(g.current),Ed(g.current),g.current=null);const U=new yi;U.setAttribute("position",new $n(s.positions.slice(),3)),U.setAttribute("normal",new $n(s.normals.slice(),3)),s.normals?.length||U.computeVertexNormals(),U.computeBoundingBox();const V=U.boundingBox,A=new $,w=new $;V.getCenter(A),V.getSize(w);const N=Math.max(w.x,w.y,w.z);if(!Number.isFinite(N)||N<=0)throw new Error("Model has invalid dimensions.");const J=s.positions.length/3,tt=new Float32Array(J*3);for(let q=0;q<J;q+=1)tt.set(M_,q*3);U.translate(-A.x,-A.y,-A.z),U.setAttribute("color",new $n(tt,3));const rt=new Dh({vertexColors:!0,shininess:55,specular:new be(3355443)}),ct=new Hn(U,rt),B=new xr;ct.scale.setScalar(1.6/N),ct.rotation.set(R.current.x,R.current.y,0),ct.userData.originalCenter=A,ct.add(B),L.add(ct),g.current=ct,S.current=B,y.current=3,v.current&&(v.current.position.z=y.current)},[s]),ue.useEffect(()=>{const L=g.current?.geometry,U=L?.attributes?.color?.array;if(!L||!U)return;const V=U.length/3;for(let A=0;A<V;A+=1){const w=i&&e?aA(e[A]??0):M_;U.set(w,A*3)}L.attributes.color.needsUpdate=!0},[i,e]),ue.useEffect(()=>{const L=g.current,U=S.current;if(!L||!U)return;U.children.forEach(Ed),U.clear();const V=L.userData.originalCenter;r.forEach(A=>{const w=R_(A.origPos,V);U.add(sA(w,A.localNorm??A.worldNorm))}),l.forEach(A=>{const w=R_(A.origPos,V),N=.18+Math.log10(Math.max(A.magnitude,1))*.06;U.add(rA(new $(...A.dir),w,N,14704688))})},[r,l]);const _=ue.useCallback(L=>{const U=g.current,V=p.current,A=v.current,w=h.current;if(!U||!V||!A||!w)return;const N=w.getBoundingClientRect(),J=new Ae((L.clientX-N.left)/N.width*2-1,-((L.clientY-N.top)/N.height)*2+1),tt=new hM;tt.setFromCamera(J,A);const[rt]=tt.intersectObject(U,!1);if(!rt?.face)return;const B=U.worldToLocal(rt.point.clone()).clone().add(U.userData.originalCenter),q=new oe().getNormalMatrix(U.matrixWorld),j=rt.face.normal.clone().applyMatrix3(q).normalize(),yt=rt.face.normal.clone().normalize();d?.({worldPos:rt.point.clone(),origPos:B,worldNorm:j,localNorm:yt,screenX:L.clientX,screenY:L.clientY})},[d]),I=L=>{T.current={isDown:!0,moved:!1,x:L.clientX,y:L.clientY}},z=L=>{if(!T.current.isDown||!g.current)return;const U=L.clientX-T.current.x,V=L.clientY-T.current.y;(Math.abs(U)>3||Math.abs(V)>3)&&(T.current.moved=!0),R.current.y+=U*.008,R.current.x+=V*.008,g.current.rotation.set(R.current.x,R.current.y,0),T.current.x=L.clientX,T.current.y=L.clientY},D=L=>{T.current.isDown&&!T.current.moved&&c!=="view"&&_(L),T.current.isDown=!1},H=L=>{L.preventDefault(),y.current=Ui.clamp(y.current+L.deltaY*.005,1,10),v.current&&(v.current.position.z=y.current)};return React.createElement("div",{ref:h,style:{width:"100%",height:"100%",cursor:c==="view"?"grab":"crosshair"},onMouseDown:I,onMouseMove:z,onMouseUp:D,onMouseLeave:()=>{T.current.isDown=!1},onWheel:H})}function dA({screenPos:s,onConfirm:e,onCancel:i}){const[r,l]=ue.useState(100),[c,d]=ue.useState(3),[h,m]=ue.useState([0,-1,0]),[p,v]=ue.useState(!1),g=p?h:T_[c].vec;return React.createElement("div",{style:{position:"fixed",left:Math.min(s.x+10,window.innerWidth-260),top:Math.min(s.y-20,window.innerHeight-300),width:240,background:"#111115",border:"1px solid #2e2e38",borderRadius:6,padding:16,zIndex:1e3,boxShadow:"0 8px 32px #00000088"}},React.createElement("div",{style:{fontSize:10,letterSpacing:"0.15em",color:"#e06030",textTransform:"uppercase",marginBottom:12}},"Add Force"),React.createElement("div",{style:{fontSize:9,color:"#555",marginBottom:8,letterSpacing:"0.1em"}},"MAGNITUDE"),React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:14}},React.createElement("input",{type:"range",min:1,max:2e3,value:r,onChange:S=>l(Number(S.target.value)),style:{flex:1}}),React.createElement("span",{style:{fontSize:12,color:"#e06030",minWidth:55}},r," N")),React.createElement("div",{style:{fontSize:9,color:"#555",marginBottom:8,letterSpacing:"0.1em"}},"DIRECTION"),React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:10}},T_.map((S,M)=>React.createElement("button",{key:S.label,onClick:()=>{d(M),v(!1)},style:{padding:"5px 4px",fontSize:9,background:!p&&c===M?"#1e1008":"#0f0f12",border:`1px solid ${!p&&c===M?"#e06030":"#222"}`,color:!p&&c===M?"#e06030":"#555",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},S.label))),React.createElement("div",{style:{display:"flex",gap:4,marginBottom:14}},["x","y","z"].map((S,M)=>React.createElement("div",{key:S,style:{flex:1}},React.createElement("div",{style:{fontSize:8,color:"#444",marginBottom:3,letterSpacing:"0.1em"}},S.toUpperCase()),React.createElement("input",{type:"number",step:"0.1",value:g[M],onChange:T=>{const R=[...h];R[M]=Number(T.target.value),m(R),v(!0)},style:{width:"100%",background:"#0a0a0e",border:"1px solid #222",color:"#c8c0b8",padding:"4px 6px",fontSize:11,borderRadius:3,fontFamily:"inherit"}})))),React.createElement("div",{style:{display:"flex",gap:8}},React.createElement("button",{onClick:()=>e({magnitude:r,dir:Lh(g).toArray()}),style:{flex:1,padding:"8px",background:"#e06030",color:"#0a0a0c",fontSize:10,letterSpacing:"0.12em",border:"none",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},"Add Force"),React.createElement("button",{onClick:i,"aria-label":"Cancel force",style:{padding:"8px 12px",background:"transparent",color:"#555",fontSize:10,border:"1px solid #222",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},"X")))}function hA({analysisProvider:s}){const[e,i]=ue.useState(null),[r,l]=ue.useState(null),[c,d]=ue.useState(null),[h,m]=ue.useState(null),[p,v]=ue.useState("view"),[g,S]=ue.useState([]),[M,T]=ue.useState([]),[R,y]=ue.useState(null),[_,I]=ue.useState({material:"pla",infill:20,layerHeight:.2,wallCount:3,nozzleDiameter:.4,lineWidth:.45,orientation:"flat",layerAdhesion:"normal",enclosure:!1}),[z,D]=ue.useState(!1),[H,L]=ue.useState(null),[U,V]=ue.useState(null),[A,w]=ue.useState(!0),[N,J]=ue.useState("setup"),[tt,rt]=ue.useState(!1),ct=ue.useRef(null),B=Md.find(X=>X.id===_.material)??Md[0],q=!!(e&&c&&g.length>0&&M.length>0);ue.useEffect(()=>{document.getElementById("static-status")?.remove()},[]);const j=ue.useMemo(()=>c?`${c.triangles.toLocaleString()} triangles | ${c.dims.x.toFixed(1)} x ${c.dims.y.toFixed(1)} x ${c.dims.z.toFixed(1)} mm`:"No mesh loaded",[c]),yt=ue.useCallback(async X=>{if(!X)return;const pt=X.name.toLowerCase(),Y=pt.endsWith(".stl"),mt=pt.endsWith(".step")||pt.endsWith(".stp");if(!Y&&!mt){m("Unsupported file type. Use STL, STEP, or STP."),setTimeout(()=>m(null),3e3);return}l(X),L(null),V(null),S([]),T([]),y(null),m(mt?"Reading STEP file...":"Parsing STL...");try{const ft=await X.arrayBuffer(),Ut=mt?await nA(ft,m):$b(ft),Dt=iA(Ut);i(Ut),d(Dt),J("constraints")}catch(ft){m(ft instanceof Error?ft.message:"File parsing failed."),setTimeout(()=>m(null),5e3);return}m(null)},[]),St=ue.useCallback(({worldPos:X,origPos:pt,worldNorm:Y,localNorm:mt,screenX:ft,screenY:Ut})=>{p==="bolt"?S(Dt=>[...Dt,{id:crypto.randomUUID(),worldPos:X,origPos:pt,worldNorm:Y,localNorm:mt,label:`B${Dt.length+1}`}]):p==="force"&&y({worldPos:X,origPos:pt,worldNorm:Y,localNorm:mt,screenX:ft,screenY:Ut})},[p]),P=({magnitude:X,dir:pt})=>{R&&(T(Y=>[...Y,{id:crypto.randomUUID(),worldPos:R.worldPos,origPos:R.origPos,worldNorm:R.worldNorm,localNorm:R.localNorm,dir:pt,magnitude:X,label:`F${Y.length+1}`}]),y(null))},et=async()=>{if(q){D(!0),J("results");try{const X={stlData:e,stlStats:c,bolts:g,forces:M,material:B,settings:_},pt=s?await s(X):uA(X),Y=cA(X);L(pt),V(Y),w(!0)}catch(X){L({error:X instanceof Error?X.message:"Analysis failed."})}finally{D(!1)}}};return React.createElement("div",{style:{minHeight:"100vh",background:"#09090b",color:"#e8e4dc",fontFamily:"'DM Mono','Fira Code','Courier New',monospace",display:"flex",flexDirection:"column"}},React.createElement("style",null,`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-track{background:#111}
        ::-webkit-scrollbar-thumb{background:#2e2e38}
        input[type=range]{-webkit-appearance:none;height:2px;background:#1e1e24;border-radius:2px;outline:none;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#e06030;cursor:pointer}
        input[type=number],select{background:#111115;color:#e8e4dc;border:1px solid #2a2a32;padding:6px 10px;border-radius:3px;font-family:inherit;font-size:11px;outline:none;width:100%}
        input[type=number]:focus,select:focus{border-color:#e06030}
        button:disabled{cursor:not-allowed}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .card{animation:fadeIn 0.35s ease forwards}
      `),React.createElement("div",{style:{borderBottom:"1px solid #1a1a20",padding:"10px 20px",display:"flex",alignItems:"center",gap:14,background:"#0c0c0f",flexShrink:0}},React.createElement("div",{style:{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.14em",color:"#e06030"}},"STRESSFORM"),React.createElement("div",{style:{width:1,height:18,background:"#222"}}),React.createElement("div",{style:{fontSize:9,color:"#444",letterSpacing:"0.15em"}},j),React.createElement("div",{style:{marginLeft:"auto",display:"flex",gap:2}},["setup","constraints","settings","results"].map(X=>React.createElement("button",{key:X,onClick:()=>J(X),style:{background:"none",border:"none",borderBottom:`1px solid ${N===X?"#e06030":"transparent"}`,color:N===X?"#e06030":"#444",fontFamily:"inherit",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",padding:"6px 12px"}},X)))),React.createElement("div",{style:{flex:1,display:"flex",overflow:"hidden"}},React.createElement("div",{style:{flex:"0 0 55%",position:"relative",borderRight:"1px solid #1a1a20",background:"#07070a"}},React.createElement("div",{style:{position:"absolute",top:12,left:12,zIndex:20,color:"#e06030",fontSize:10,letterSpacing:"0.16em",textTransform:"uppercase",pointerEvents:"none"}},"Stressform Ready"),e?React.createElement(React.Fragment,null,React.createElement(fA,{stlData:e,stressWeights:U,showStress:A,bolts:g,forces:M,mode:p,onPickPoint:St}),React.createElement("div",{style:{position:"absolute",top:12,left:12,display:"flex",gap:6}},[{value:"view",label:"Orbit"},{value:"bolt",label:"Bolt"},{value:"force",label:"Force"}].map(X=>React.createElement("button",{key:X.value,onClick:()=>v(X.value),style:{padding:"5px 10px",fontSize:10,background:p===X.value?"#1a1008":"#0f0f12",border:`1px solid ${p===X.value?"#e06030":"#1e1e24"}`,color:p===X.value?"#e06030":"#555",cursor:"pointer",borderRadius:3,fontFamily:"inherit",letterSpacing:"0.08em"}},X.label))),U&&React.createElement("button",{onClick:()=>w(X=>!X),style:{position:"absolute",top:12,right:12,padding:"5px 10px",fontSize:9,background:A?"#1a1008":"#0f0f12",border:`1px solid ${A?"#e06030":"#1e1e24"}`,color:A?"#e06030":"#555",cursor:"pointer",borderRadius:3,fontFamily:"inherit",letterSpacing:"0.1em"}},A?"STRESS MAP":"DEFAULT"),React.createElement("div",{style:{position:"absolute",bottom:12,left:12,display:"flex",gap:8}},React.createElement("span",{style:{fontSize:9,background:"#001a1a",border:"1px solid #00e5ff22",color:"#00e5ff",padding:"3px 8px",borderRadius:2,letterSpacing:"0.1em"}},g.length," bolt",g.length===1?"":"s"),React.createElement("span",{style:{fontSize:9,background:"#1a0e00",border:"1px solid #e0603022",color:"#e06030",padding:"3px 8px",borderRadius:2,letterSpacing:"0.1em"}},M.length," force",M.length===1?"":"s")),React.createElement("div",{style:{position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",fontSize:9,color:"#333",pointerEvents:"none"}},p==="view"&&"drag to rotate | scroll to zoom",p==="bolt"&&"click mesh to place bolt constraint",p==="force"&&"click mesh to place force vector")):React.createElement("div",{onDrop:X=>{X.preventDefault(),rt(!1),yt(X.dataTransfer.files[0])},onDragOver:X=>{X.preventDefault(),rt(!0)},onDragLeave:()=>rt(!1),onClick:()=>ct.current?.click(),style:{width:"calc(100% - 32px)",height:"calc(100% - 32px)",margin:16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:`2px dashed ${tt?"#e06030":"#1e1e24"}`,borderRadius:4,cursor:"pointer",background:tt?"#1a0e08":"transparent"}},React.createElement("div",{style:{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.22em",color:"#333"}},"DROP STL / STEP FILE"),React.createElement("div",{style:{fontSize:9,color:"#2a2a2a",marginTop:6,letterSpacing:"0.1em"}},"or click to browse"),React.createElement("div",{style:{fontSize:8,color:"#222",marginTop:3,letterSpacing:"0.08em"}},".stl | .step | .stp"),React.createElement("input",{ref:ct,type:"file",accept:".stl,.step,.stp",style:{display:"none"},onChange:X=>yt(X.target.files?.[0])})),R&&React.createElement(dA,{screenPos:{x:R.screenX,y:R.screenY},onConfirm:P,onCancel:()=>y(null)}),h&&React.createElement("div",{style:{position:"absolute",inset:0,background:"#07070acc",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:50}},React.createElement("div",{style:{fontSize:10,color:"#888",letterSpacing:"0.15em"}},h))),React.createElement("div",{style:{flex:"0 0 45%",overflowY:"auto",background:"#09090b"}},N==="setup"&&React.createElement(xc,null,React.createElement(C_,null,"WORKFLOW"),[["01","Upload STL or STEP","Drop a supported file onto the viewer or click to browse."],["02","Place bolt constraints","Switch to Bolt mode and click mesh surfaces."],["03","Apply force vectors","Switch to Force mode and click mesh surfaces."],["04","Configure print settings","Set material, infill, layer height, and wall count."],["05","Run analysis","Generate a screening estimate and stress visualization."]].map(([X,pt,Y])=>React.createElement(pA,{key:X,number:X,title:pt,description:Y})),!e&&React.createElement(w_,{onClick:()=>ct.current?.click()},"Upload STL / STEP to Begin")),N==="constraints"&&React.createElement(xc,null,React.createElement(D_,{title:"Bolt Constraints",accent:"#00e5ff",modeName:"bolt",mode:p,setMode:v,empty:"No bolt constraints placed yet."},g.map(X=>React.createElement(U_,{key:X.id,color:"#00e5ff",title:X.label,detail:`(${X.origPos.x.toFixed(1)}, ${X.origPos.y.toFixed(1)}, ${X.origPos.z.toFixed(1)}) mm`,onRemove:()=>S(pt=>pt.filter(Y=>Y.id!==X.id))}))),React.createElement(D_,{title:"Force Vectors",accent:"#e06030",modeName:"force",mode:p,setMode:v,empty:"No forces applied yet."},M.map(X=>React.createElement(U_,{key:X.id,color:"#e06030",title:`${X.label} - ${X.magnitude} N`,detail:`dir (${X.dir.join(", ")}) at (${X.origPos.x.toFixed(1)}, ${X.origPos.y.toFixed(1)}, ${X.origPos.z.toFixed(1)}) mm`,onRemove:()=>T(pt=>pt.filter(Y=>Y.id!==X.id))}))),q&&React.createElement(pv,{onClick:()=>J("settings")},"Configure Print Settings")),N==="settings"&&React.createElement(xc,null,React.createElement(C_,null,"PRINT SETTINGS"),React.createElement(Ac,null,"Material"),React.createElement("select",{value:_.material,onChange:X=>I(pt=>({...pt,material:X.target.value}))},Md.map(X=>React.createElement("option",{key:X.id,value:X.id},X.label," - ",X.tensile," MPa tensile"))),React.createElement("div",{style:{display:"flex",gap:8,marginTop:8,marginBottom:18}},[["Tensile",`${B.tensile} MPa`],["Flexural",`${B.flexural} MPa`],["Density",`${B.density} g/cm3`]].map(([X,pt])=>React.createElement(mA,{key:X,label:X,value:pt}))),[{key:"infill",label:"Infill Density",min:5,max:100,step:5,unit:"%"},{key:"layerHeight",label:"Layer Height",min:.1,max:.4,step:.05,unit:"mm"},{key:"wallCount",label:"Wall Perimeters",min:1,max:8,step:1,unit:""},{key:"nozzleDiameter",label:"Nozzle Diameter",min:.25,max:.8,step:.05,unit:"mm"},{key:"lineWidth",label:"Line Width",min:.3,max:1,step:.05,unit:"mm"}].map(X=>React.createElement(gA,{key:X.key,item:X,value:_[X.key],onChange:pt=>I(Y=>({...Y,[X.key]:pt}))})),React.createElement(Ac,null,"Print Orientation"),React.createElement("div",{style:{display:"flex",gap:5,marginBottom:20}},[["flat","Flat (XY)"],["upright","Upright (Z)"],["angled","45 deg Angled"]].map(([X,pt])=>React.createElement("button",{key:X,onClick:()=>I(Y=>({...Y,orientation:X})),style:{flex:1,padding:"7px 4px",fontSize:9,background:_.orientation===X?"#1e1008":"#0e0e11",border:`1px solid ${_.orientation===X?"#e06030":"#1a1a20"}`,color:_.orientation===X?"#e06030":"#444",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},pt))),React.createElement(Ac,null,"Layer Bond Quality"),React.createElement("div",{style:{display:"flex",gap:5,marginBottom:14}},dh.map(X=>React.createElement("button",{key:X.id,onClick:()=>I(pt=>({...pt,layerAdhesion:X.id})),style:{flex:1,padding:"7px 4px",fontSize:9,background:_.layerAdhesion===X.id?"#1e1008":"#0e0e11",border:`1px solid ${_.layerAdhesion===X.id?"#e06030":"#1a1a20"}`,color:_.layerAdhesion===X.id?"#e06030":"#444",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},X.label))),React.createElement("label",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:20,fontSize:9,letterSpacing:"0.12em",color:"#777",textTransform:"uppercase",cursor:"pointer"}},React.createElement("input",{type:"checkbox",checked:_.enclosure,onChange:X=>I(pt=>({...pt,enclosure:X.target.checked})),style:{width:13,height:13}}),"Heated enclosure / well controlled cooling"),React.createElement(_A,{bolts:g,forces:M}),React.createElement(w_,{onClick:et,disabled:!q||z},z?"Analyzing...":"Run FEA Estimate")),N==="results"&&React.createElement(xc,null,z&&React.createElement(L_,{title:"RUNNING ANALYSIS",detail:"Computing load paths and stress distribution..."}),!z&&!H&&React.createElement(L_,{title:"No results yet",detail:"Run an analysis after placing constraints and forces."}),!z&&H?.error&&React.createElement(vA,null,H.error),!z&&H&&!H.error&&React.createElement(xA,{results:H,onEdit:()=>J("constraints")})))))}function xc({children:s}){return React.createElement("div",{style:{padding:22}},s)}function C_({children:s}){return React.createElement("div",{style:{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,letterSpacing:"0.2em",color:"#333",marginBottom:18}},s)}function Ac({children:s}){return React.createElement("label",{style:{fontSize:9,letterSpacing:"0.14em",color:"#444",textTransform:"uppercase",display:"block",marginBottom:7}},s)}function pA({number:s,title:e,description:i}){return React.createElement("div",{style:{display:"flex",gap:14,marginBottom:14,padding:"12px 14px",background:"#0e0e11",border:"1px solid #1a1a20",borderRadius:4}},React.createElement("div",{style:{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1e1e24",minWidth:28}},s),React.createElement("div",null,React.createElement("div",{style:{fontSize:10,letterSpacing:"0.08em",color:"#b0a898",marginBottom:3}},e),React.createElement("div",{style:{fontSize:9,color:"#444",lineHeight:1.7}},i)))}function w_({children:s,disabled:e=!1,onClick:i}){return React.createElement("button",{onClick:i,disabled:e,style:{marginTop:4,width:"100%",padding:"12px",background:e?"#1a1a20":"#e06030",color:e?"#333":"#0a0a0c",fontSize:10,letterSpacing:"0.15em",border:"none",cursor:e?"not-allowed":"pointer",borderRadius:3,fontFamily:"inherit",textTransform:"uppercase"}},s)}function pv({children:s,onClick:e}){return React.createElement("button",{onClick:e,style:{marginTop:20,width:"100%",padding:"10px",background:"transparent",border:"1px solid #e06030",color:"#e06030",fontSize:10,letterSpacing:"0.15em",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},s)}function D_({title:s,accent:e,modeName:i,mode:r,setMode:l,empty:c,children:d}){const h=Array.isArray(d)?d.length:0;return React.createElement("div",{style:{marginBottom:24}},React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}},React.createElement("div",{style:{fontSize:9,letterSpacing:"0.15em",color:`${e}88`,textTransform:"uppercase"}},s),React.createElement("button",{onClick:()=>l(m=>m===i?"view":i),style:{padding:"4px 10px",fontSize:9,letterSpacing:"0.1em",background:r===i?"#1a0e00":"transparent",border:`1px solid ${r===i?e:"#222"}`,color:r===i?e:"#444",cursor:"pointer",borderRadius:3,fontFamily:"inherit"}},r===i?"Placing...":`Place ${i}`)),h===0?React.createElement("div",{style:{fontSize:9,color:"#2a2a2a",padding:"12px 14px",border:"1px dashed #1a1a20",borderRadius:3,textAlign:"center"}},c):d)}function U_({color:s,title:e,detail:i,onRemove:r}){return React.createElement("div",{className:"card",style:{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#0e0e11",border:`1px solid ${s}18`,borderRadius:3,marginBottom:6}},React.createElement("div",{style:{width:8,height:8,borderRadius:2,background:s,flexShrink:0}}),React.createElement("div",{style:{flex:1}},React.createElement("div",{style:{fontSize:10,color:s}},e),React.createElement("div",{style:{fontSize:8,color:"#444",marginTop:2}},i)),React.createElement("button",{onClick:r,"aria-label":`Remove ${e}`,style:{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:14,padding:"0 4px"}},"X"))}function mA({label:s,value:e}){return React.createElement("div",{style:{flex:1,background:"#0e0e11",border:"1px solid #1a1a20",borderRadius:3,padding:"6px 8px"}},React.createElement("div",{style:{fontSize:7,color:"#333",letterSpacing:"0.1em",marginBottom:2}},s),React.createElement("div",{style:{fontSize:10,color:"#777"}},e))}function gA({item:s,value:e,onChange:i}){return React.createElement("div",{style:{marginBottom:16}},React.createElement("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:7}},React.createElement(Ac,null,s.label),React.createElement("span",{style:{fontSize:11,color:"#e06030"}},e,s.unit)),React.createElement("input",{type:"range",min:s.min,max:s.max,step:s.step,value:e,onChange:r=>i(Number(r.target.value))}))}function _A({bolts:s,forces:e}){return React.createElement("div",{style:{background:"#0e0e11",border:"1px solid #1a1a20",borderRadius:4,padding:"10px 14px",marginBottom:16,fontSize:9,color:"#444",lineHeight:2}},React.createElement("div",{style:{color:"#333",marginBottom:4,letterSpacing:"0.1em"}},"ANALYSIS INPUTS"),React.createElement("div",null,s.length," bolt constraint",s.length===1?"":"s"," | ",e.length," force vector",e.length===1?"":"s"),s.length===0&&React.createElement("div",{style:{color:"#e0303066"}},"No bolt constraints. Go to Constraints tab."),e.length===0&&React.createElement("div",{style:{color:"#e0303066"}},"No forces applied. Go to Constraints tab."))}function L_({title:s,detail:e}){return React.createElement("div",{style:{textAlign:"center",padding:"60px 0"}},React.createElement("div",{style:{fontSize:10,color:"#444",letterSpacing:"0.15em"}},s),React.createElement("div",{style:{fontSize:9,color:"#2a2a2a",marginTop:8}},e))}function vA({children:s}){return React.createElement("div",{style:{padding:14,background:"#1a0808",border:"1px solid #e0303044",borderRadius:4,color:"#e06060",fontSize:10}},s)}function xA({results:s,onEdit:e}){const i=_c[s.overallRisk]??_c.medium,r=[{label:"Worst Safety Factor",value:s.safetyFactor?.toFixed(2)??"n/a",unit:"x",warn:s.safetyFactor<1.5},{label:"Layer Safety",value:s.layerSafetyFactor?.toFixed(2)??"n/a",unit:"x",warn:s.layerSafetyFactor<1.5},{label:"Bolt Bearing",value:s.bearingSafetyFactor?.toFixed(2)??"n/a",unit:"x",warn:s.bearingSafetyFactor<1.5},{label:"Buckling Safety",value:s.bucklingSafetyFactor?.toFixed(2)??"n/a",unit:"x",warn:s.bucklingSafetyFactor<1.5},{label:"Max Stress",value:s.maxStress?.toFixed(1)??"n/a",unit:"MPa"},{label:"Z Strength",value:s.zStrength?.toFixed(1)??"n/a",unit:"MPa"}];return React.createElement("div",null,React.createElement("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:18}},r.map(l=>React.createElement("div",{key:l.label,className:"card",style:{background:"#0e0e11",border:`1px solid ${l.warn?"#e0603033":"#1a1a20"}`,borderRadius:4,padding:"10px 12px"}},React.createElement("div",{style:{fontSize:8,letterSpacing:"0.12em",color:"#333",textTransform:"uppercase",marginBottom:5}},l.label),React.createElement("div",{style:{fontSize:20,fontFamily:"'Bebas Neue',sans-serif",color:l.warn?"#e06030":"#b0a898",letterSpacing:"0.05em"}},l.value," ",React.createElement("span",{style:{fontSize:11,color:"#444"}},l.unit))))),React.createElement("div",{className:"card",style:{background:i.bg,border:`1px solid ${i.color}28`,borderLeft:`3px solid ${i.color}`,borderRadius:"0 4px 4px 0",padding:"12px 14px",marginBottom:18}},React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}},React.createElement("span",{style:{fontSize:8,letterSpacing:"0.14em",color:"#444",textTransform:"uppercase"}},"Overall Assessment"),React.createElement("span",{style:{fontSize:9,padding:"2px 8px",borderRadius:2,letterSpacing:"0.1em",textTransform:"uppercase",background:i.bg,color:i.color,border:`1px solid ${i.color}44`}},s.overallRisk?.toUpperCase())),React.createElement("div",{style:{fontSize:10,color:"#777",lineHeight:1.75}},s.summary)),React.createElement("div",{className:"card",style:{background:"#0e0e11",border:"1px solid #1a1a20",borderRadius:4,padding:"12px 14px",marginBottom:18}},React.createElement("div",{style:{fontSize:8,letterSpacing:"0.15em",color:"#333",textTransform:"uppercase",marginBottom:10}},"FDM Material Model"),[["Controlling mode",s.controllingMode],["Effective in-plane strength",`${s.effectiveStrength?.toFixed(1)??"n/a"} MPa`],["Estimated Z strength",`${s.zStrength?.toFixed(1)??"n/a"} MPa`],["Wall thickness",`${s.wallThickness?.toFixed(2)??"n/a"} mm`],["Shell contribution",`${((s.shellRatio??0)*100).toFixed(0)}%`],["Layer peel stress",`${s.layerPeelStress?.toFixed(2)??"n/a"} MPa`]].map(([l,c])=>React.createElement("div",{key:l,style:{display:"flex",justifyContent:"space-between",gap:12,fontSize:9,color:"#555",lineHeight:1.9}},React.createElement("span",null,l),React.createElement("span",{style:{color:"#b0a898",textAlign:"right"}},c)))),React.createElement("div",{style:{marginBottom:18}},React.createElement("div",{style:{fontSize:8,letterSpacing:"0.15em",color:"#333",textTransform:"uppercase",marginBottom:10}},"Failure Modes"),(s.failureModes??[]).map((l,c)=>{const d=_c[l.severity]??_c.medium;return React.createElement("div",{key:`${l.name}-${c}`,className:"card",style:{background:d.bg,borderLeft:`3px solid ${d.color}`,border:`1px solid ${d.color}1a`,borderRadius:"0 4px 4px 0",padding:"11px 13px",marginBottom:7}},React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}},React.createElement("span",{style:{fontSize:11,color:"#c0b8b0"}},l.name),React.createElement("span",{style:{fontSize:8,padding:"1px 7px",borderRadius:2,letterSpacing:"0.1em",textTransform:"uppercase",background:d.bg,color:d.color,border:`1px solid ${d.color}44`}},l.severity)),React.createElement("div",{style:{fontSize:8,color:"#44444a",letterSpacing:"0.08em",marginBottom:5}},l.location),React.createElement("div",{style:{fontSize:9,color:"#555",lineHeight:1.65,marginBottom:7}},l.description),React.createElement("div",{style:{fontSize:9,color:"#907050",lineHeight:1.65,borderTop:"1px solid #1e1e24",paddingTop:7}},l.recommendation))})),s.printRecommendations?.length>0&&React.createElement("div",{className:"card",style:{background:"#0e0e11",border:"1px solid #1a1a20",borderRadius:4,padding:"12px 14px",marginBottom:14}},React.createElement("div",{style:{fontSize:8,letterSpacing:"0.15em",color:"#333",textTransform:"uppercase",marginBottom:10}},"Print Recommendations"),s.printRecommendations.map((l,c)=>React.createElement("div",{key:l,style:{display:"flex",gap:8,marginBottom:7,fontSize:9,color:"#555",lineHeight:1.65}},React.createElement("span",{style:{color:"#e06030",minWidth:12}},c+1,"."),React.createElement("span",null,l)))),React.createElement(pv,{onClick:e},"Edit Constraints"))}class SA extends ue.Component{constructor(e){super(e),this.state={error:null}}static getDerivedStateFromError(e){return{error:e}}componentDidCatch(e,i){console.error("Stressform startup error",e,i)}render(){return this.state.error?React.createElement("div",{style:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#09090b",color:"#e06060",font:"13px Courier New, monospace",padding:24,whiteSpace:"pre-wrap"}},`Stressform failed to start:

${this.state.error?.stack||this.state.error?.message||String(this.state.error)}`):this.props.children}}try{RS.createRoot(document.getElementById("root")).render(React.createElement(SA,null,React.createElement(hA,null)))}catch(s){throw document.getElementById("root").innerHTML=`
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#e06060;font:12px Courier New,monospace;padding:24px;white-space:pre-wrap">
      Stressform failed to start:
${s instanceof Error?s.message:String(s)}
    </div>
  `,s}
