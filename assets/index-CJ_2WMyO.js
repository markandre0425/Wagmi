import{i as d,b as u}from"./index-BeJ45y70.js";import{n as p}from"./class-map-siut4Tqp.js";import{c as m}from"./index-Cor1_4Mh.js";import{d as f,r as h}from"./index-donpy0xh.js";const g=f`
  :host {
    position: relative;
    display: flex;
    width: 100%;
    height: 1px;
    background-color: ${({tokens:t})=>t.theme.borderPrimary};
    justify-content: center;
    align-items: center;
  }

  :host > wui-text {
    position: absolute;
    padding: 0px 8px;
    transition: background-color ${({durations:t})=>t.lg}
      ${({easings:t})=>t["ease-out-power-2"]};
    will-change: background-color;
  }

  :host([data-bg-color='primary']) > wui-text {
    background-color: ${({tokens:t})=>t.theme.backgroundPrimary};
  }

  :host([data-bg-color='secondary']) > wui-text {
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
  }
`;var c=function(t,r,o,n){var a=arguments.length,e=a<3?r:n===null?n=Object.getOwnPropertyDescriptor(r,o):n,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")e=Reflect.decorate(t,r,o,n);else for(var l=t.length-1;l>=0;l--)(s=t[l])&&(e=(a<3?s(e):a>3?s(r,o,e):s(r,o))||e);return a>3&&e&&Object.defineProperty(r,o,e),e};let i=class extends d{constructor(){super(...arguments),this.text="",this.bgColor="primary"}render(){return this.dataset.bgColor=this.bgColor,u`${this.template()}`}template(){return this.text?u`<wui-text variant="md-regular" color="secondary">${this.text}</wui-text>`:null}};i.styles=[h,g];c([p()],i.prototype,"text",void 0);c([p()],i.prototype,"bgColor",void 0);i=c([m("wui-separator")],i);
