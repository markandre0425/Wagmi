import{w as k,i as W,b as v}from"./index-BeJ45y70.js";import{n as y}from"./class-map-siut4Tqp.js";import{c as I}from"./index-C7l3ZR2N.js";import"./index-DtqGDqEH.js";import{Q as M}from"./browser-Du_7q3n2.js";import{d as O,r as N}from"./index-DahmWcIk.js";const Q=.1,_=2.5,$=7;function x(t,n,d){return t===n?!1:(t-n<0?n-t:t-n)<=d+Q}function A(t,n){const d=Array.prototype.slice.call(M.create(t,{errorCorrectionLevel:n}).modules.data,0),l=Math.sqrt(d.length);return d.reduce((h,f,p)=>(p%l===0?h.push([f]):h[h.length-1].push(f))&&h,[])}const q={generate({uri:t,size:n,logoSize:d,padding:l=8,dotColor:h="var(--apkt-colors-black)"}){const p=[],u=A(t,"Q"),s=(n-2*l)/u.length,E=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];E.forEach(({x:i,y:e})=>{const a=(u.length-$)*s*i+l,r=(u.length-$)*s*e+l,c=.45;for(let o=0;o<E.length;o+=1){const m=s*($-o*2);p.push(k`
            <rect
              fill=${o===2?"var(--apkt-colors-black)":"var(--apkt-colors-white)"}
              width=${o===0?m-10:m}
              rx= ${o===0?(m-10)*c:m*c}
              ry= ${o===0?(m-10)*c:m*c}
              stroke=${h}
              stroke-width=${o===0?10:0}
              height=${o===0?m-10:m}
              x= ${o===0?r+s*o+10/2:r+s*o}
              y= ${o===0?a+s*o+10/2:a+s*o}
            />
          `)}});const R=Math.floor((d+25)/s),S=u.length/2-R/2,z=u.length/2+R/2-1,C=[];u.forEach((i,e)=>{i.forEach((a,r)=>{if(u[e][r]&&!(e<$&&r<$||e>u.length-($+1)&&r<$||e<$&&r>u.length-($+1))&&!(e>S&&e<z&&r>S&&r<z)){const c=e*s+s/2+l,o=r*s+s/2+l;C.push([c,o])}})});const b={};return C.forEach(([i,e])=>{b[i]?b[i]?.push(e):b[i]=[e]}),Object.entries(b).map(([i,e])=>{const a=e.filter(r=>e.every(c=>!x(r,c,s)));return[Number(i),a]}).forEach(([i,e])=>{e.forEach(a=>{p.push(k`<circle cx=${i} cy=${a} fill=${h} r=${s/_} />`)})}),Object.entries(b).filter(([i,e])=>e.length>1).map(([i,e])=>{const a=e.filter(r=>e.some(c=>x(r,c,s)));return[Number(i),a]}).map(([i,e])=>{e.sort((r,c)=>r<c?-1:1);const a=[];for(const r of e){const c=a.find(o=>o.some(m=>x(r,m,s)));c?c.push(r):a.push([r])}return[i,a.map(r=>[r[0],r[r.length-1]])]}).forEach(([i,e])=>{e.forEach(([a,r])=>{p.push(k`
              <line
                x1=${i}
                x2=${i}
                y1=${a}
                y2=${r}
                stroke=${h}
                stroke-width=${s/(_/2)}
                stroke-linecap="round"
              />
            `)})}),p}},P=O`
  :host {
    position: relative;
    user-select: none;
    display: block;
    overflow: hidden;
    aspect-ratio: 1 / 1;
    width: 100%;
    height: 100%;
    background-color: ${({colors:t})=>t.white};
    border: 1px solid ${({tokens:t})=>t.theme.borderPrimary};
  }

  :host {
    border-radius: ${({borderRadius:t})=>t[4]};
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :host([data-clear='true']) > wui-icon {
    display: none;
  }

  svg:first-child,
  wui-image,
  wui-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translateY(-50%) translateX(-50%);
    background-color: ${({tokens:t})=>t.theme.backgroundPrimary};
    box-shadow: inset 0 0 0 4px ${({tokens:t})=>t.theme.backgroundPrimary};
    border-radius: ${({borderRadius:t})=>t[6]};
  }

  wui-image {
    width: 25%;
    height: 25%;
    border-radius: ${({borderRadius:t})=>t[2]};
  }

  wui-icon {
    width: 100%;
    height: 100%;
    color: #3396ff !important;
    transform: translateY(-50%) translateX(-50%) scale(0.25);
  }

  wui-icon > svg {
    width: inherit;
    height: inherit;
  }
`;var w=function(t,n,d,l){var h=arguments.length,f=h<3?n:l===null?l=Object.getOwnPropertyDescriptor(n,d):l,p;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")f=Reflect.decorate(t,n,d,l);else for(var u=t.length-1;u>=0;u--)(p=t[u])&&(f=(h<3?p(f):h>3?p(n,d,f):p(n,d))||f);return h>3&&f&&Object.defineProperty(n,d,f),f};let g=class extends W{constructor(){super(...arguments),this.uri="",this.size=500,this.theme="dark",this.imageSrc=void 0,this.alt=void 0,this.arenaClear=void 0,this.farcaster=void 0}render(){return this.dataset.theme=this.theme,this.dataset.clear=String(this.arenaClear),v`<wui-flex
      alignItems="center"
      justifyContent="center"
      class="wui-qr-code"
      direction="column"
      gap="4"
      width="100%"
      style="height: 100%"
    >
      ${this.templateVisual()} ${this.templateSvg()}
    </wui-flex>`}templateSvg(){return k`
      <svg viewBox="0 0 ${this.size} ${this.size}" width="100%" height="100%">
        ${q.generate({uri:this.uri,size:this.size,logoSize:this.arenaClear?0:this.size/4})}
      </svg>
    `}templateVisual(){return this.imageSrc?v`<wui-image src=${this.imageSrc} alt=${this.alt??"logo"}></wui-image>`:this.farcaster?v`<wui-icon
        class="farcaster"
        size="inherit"
        color="inherit"
        name="farcaster"
      ></wui-icon>`:v`<wui-icon size="inherit" color="inherit" name="walletConnect"></wui-icon>`}};g.styles=[N,P];w([y()],g.prototype,"uri",void 0);w([y({type:Number})],g.prototype,"size",void 0);w([y()],g.prototype,"theme",void 0);w([y()],g.prototype,"imageSrc",void 0);w([y()],g.prototype,"alt",void 0);w([y({type:Boolean})],g.prototype,"arenaClear",void 0);w([y({type:Boolean})],g.prototype,"farcaster",void 0);g=w([I("wui-qr-code")],g);
