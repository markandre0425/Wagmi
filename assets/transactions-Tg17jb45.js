import{a as p,i as s,b as f}from"./index-BeJ45y70.js";import"./index-donpy0xh.js";import{c as a}from"./index-Cor1_4Mh.js";import"./index-xqqHJEYm.js";import"./http-suEy5Onp.js";import"./W3MFrameProviderSingleton-DP4Pkyw8.js";import"./index-DtDWBCPw.js";import"./index-nibyPLVP.js";import"./class-map-siut4Tqp.js";import"./index-Cm7CYPub.js";import"./if-defined-DU7iu4yL.js";import"./index-CrOdLcLi.js";import"./index-BNvHpBqy.js";import"./index-DSoXicRu.js";const d=p`
  :host > wui-flex:first-child {
    height: 500px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  :host > wui-flex:first-child::-webkit-scrollbar {
    display: none;
  }
`;var u=function(o,i,e,r){var n=arguments.length,t=n<3?i:r===null?r=Object.getOwnPropertyDescriptor(i,e):r,l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(o,i,e,r);else for(var c=o.length-1;c>=0;c--)(l=o[c])&&(t=(n<3?l(t):n>3?l(i,e,t):l(i,e))||t);return n>3&&t&&Object.defineProperty(i,e,t),t};let m=class extends s{render(){return f`
      <wui-flex flexDirection="column" .padding=${["0","3","3","3"]} gap="3">
        <w3m-activity-list page="activity"></w3m-activity-list>
      </wui-flex>
    `}};m.styles=d;m=u([a("w3m-transactions-view")],m);export{m as W3mTransactionsView};
