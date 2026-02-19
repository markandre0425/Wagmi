import{i as m,b as f}from"./index-BeJ45y70.js";import{n as h}from"./class-map-siut4Tqp.js";import{c as l}from"./index-C7l3ZR2N.js";import{d as c}from"./index-DahmWcIk.js";const p=c`
  :host {
    display: block;
    background: linear-gradient(
      90deg,
      ${({tokens:e})=>e.theme.foregroundPrimary} 0%,
      ${({tokens:e})=>e.theme.foregroundSecondary} 50%,
      ${({tokens:e})=>e.theme.foregroundPrimary} 100%
    );
    background-size: 200% 100%;
    animation: shimmer 2s linear infinite;
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  :host([data-rounded='true']) {
    border-radius: ${({borderRadius:e})=>e[16]};
  }

  @keyframes shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
`;var n=function(e,o,i,d){var s=arguments.length,t=s<3?o:d===null?d=Object.getOwnPropertyDescriptor(o,i):d,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(e,o,i,d);else for(var u=e.length-1;u>=0;u--)(a=e[u])&&(t=(s<3?a(t):s>3?a(o,i,t):a(o,i))||t);return s>3&&t&&Object.defineProperty(o,i,t),t};let r=class extends m{constructor(){super(...arguments),this.width="",this.height="",this.variant="default",this.rounded=!1}render(){return this.style.cssText=`
      width: ${this.width};
      height: ${this.height};
    `,this.dataset.rounded=this.rounded?"true":"false",f`<slot></slot>`}};r.styles=[p];n([h()],r.prototype,"width",void 0);n([h()],r.prototype,"height",void 0);n([h()],r.prototype,"variant",void 0);n([h({type:Boolean})],r.prototype,"rounded",void 0);r=n([l("wui-shimmer")],r);
