import{a as m,i as f,b as d}from"./index-BeJ45y70.js";import{n as p}from"./class-map-siut4Tqp.js";import{o as c}from"./if-defined-DU7iu4yL.js";import{c as b}from"./index-Cor1_4Mh.js";import{r as h}from"./index-donpy0xh.js";import"./index-BB5pdao8.js";const v=m`
  :host {
    position: relative;
    display: inline-block;
    width: 100%;
  }
`;var o=function(l,r,i,a){var s=arguments.length,e=s<3?r:a===null?a=Object.getOwnPropertyDescriptor(r,i):a,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")e=Reflect.decorate(l,r,i,a);else for(var u=l.length-1;u>=0;u--)(n=l[u])&&(e=(s<3?n(e):s>3?n(r,i,e):n(r,i))||e);return s>3&&e&&Object.defineProperty(r,i,e),e};let t=class extends f{constructor(){super(...arguments),this.disabled=!1}render(){return d`
      <wui-input-text
        type="email"
        placeholder="Email"
        icon="mail"
        size="lg"
        .disabled=${this.disabled}
        .value=${this.value}
        data-testid="wui-email-input"
        tabIdx=${c(this.tabIdx)}
      ></wui-input-text>
      ${this.templateError()}
    `}templateError(){return this.errorMessage?d`<wui-text variant="sm-regular" color="error">${this.errorMessage}</wui-text>`:null}};t.styles=[h,v];o([p()],t.prototype,"errorMessage",void 0);o([p({type:Boolean})],t.prototype,"disabled",void 0);o([p()],t.prototype,"value",void 0);o([p()],t.prototype,"tabIdx",void 0);t=o([b("wui-email-input")],t);
