import{a as p,i as s,b as f}from"./index-BeJ45y70.js";import"./index-DahmWcIk.js";import{c as a}from"./index-C7l3ZR2N.js";import"./index-w9uaPSoA.js";import"./http-suEy5Onp.js";import"./W3MFrameProviderSingleton-Dz2PlAdx.js";import"./index-EBm-l0i6.js";import"./index-nibyPLVP.js";import"./class-map-siut4Tqp.js";import"./index-DIoUDobu.js";import"./if-defined-DU7iu4yL.js";import"./index-kmZE9kHf.js";import"./index-DtqGDqEH.js";import"./index-JfGlesb8.js";const d=p`
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
